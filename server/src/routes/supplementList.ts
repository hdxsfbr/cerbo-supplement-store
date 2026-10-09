// Provider side of the patient's supplement list (chart → Supplements tab) and of patient
// order requests. Lists are clinical (no money); orders are started from them via POST /api/orders.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, parse, publicOrigin, requireProvider } from '../app.js';
import { HttpError, notFound } from '../errors.js';
import { portalUrl } from '../orders/load.js';
import { loadPatientSupplements, loadRequests } from '../supplements/list.js';

const addBody = z.object({
  supplement_id: z.number().int().positive(),
  sig: z.string().trim().max(500).nullable().optional(),
});
const patchBody = z
  .object({
    sig: z.string().trim().max(500).nullable().optional(),
    status: z.enum(['active', 'discontinued']).optional(),
  })
  .refine((b) => b.sig !== undefined || b.status !== undefined, { message: 'nothing to update' });
const declineBody = z.object({ note: z.string().trim().max(500).nullable().optional() });

export async function supplementListRoutes(app: FastifyInstance): Promise<void> {
  const { sql, notifier } = app.deps;

  async function ownPatient(providerId: number, patientId: number) {
    const [p] = await sql<
      { id: number; name: string; email: string | null; portal_token: string }[]
    >`
      SELECT id, name, email, portal_token FROM patients WHERE id = ${patientId} AND provider_id = ${providerId}`;
    if (!p) throw notFound('Patient');
    return p;
  }

  // GET /api/patients/:id/supplements — the list plus this patient's requests (the tab payload)
  app.get<{ Params: { id: string } }>('/api/patients/:id/supplements', async (req) => {
    const provider = await requireProvider(req);
    const patient = await ownPatient(provider.id, idParam(req.params.id, 'patient id'));
    const origin = publicOrigin(req);
    const [supplements, requests] = await Promise.all([
      loadPatientSupplements(sql, patient.id, origin),
      loadRequests(sql, { patient_id: patient.id }),
    ]);
    return { supplements, requests };
  });

  // POST /api/patients/:id/supplements — add a catalog supplement to the list (409 if active)
  app.post<{ Params: { id: string } }>('/api/patients/:id/supplements', async (req, reply) => {
    const provider = await requireProvider(req);
    const patient = await ownPatient(provider.id, idParam(req.params.id, 'patient id'));
    const body = parse(addBody, req.body);
    const [sup] = await sql<
      { id: number }[]
    >`SELECT id FROM supplements WHERE id = ${body.supplement_id}`;
    if (!sup) throw notFound('Supplement');
    const [dup] = await sql<{ id: number }[]>`
      SELECT id FROM patient_supplements
      WHERE patient_id = ${patient.id} AND supplement_id = ${sup.id} AND status = 'active'`;
    if (dup)
      throw new HttpError(
        409,
        'already_listed',
        'This supplement is already on the patient’s list',
      );
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO patient_supplements (patient_id, supplement_id, sig, added_by)
      VALUES (${patient.id}, ${sup.id}, ${body.sig ? body.sig : null}, 'provider') RETURNING id`;
    const rows = await loadPatientSupplements(sql, patient.id, publicOrigin(req));
    return reply.status(201).send(rows.find((r) => r.id === row!.id));
  });

  // PATCH /api/patient-supplements/:id — edit the sig or discontinue / reactivate
  app.patch<{ Params: { id: string } }>('/api/patient-supplements/:id', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id);
    const body = parse(patchBody, req.body);
    const [row] = await sql<{ id: number; patient_id: number; supplement_id: number }[]>`
      SELECT ps.id, ps.patient_id, ps.supplement_id FROM patient_supplements ps
      JOIN patients p ON p.id = ps.patient_id
      WHERE ps.id = ${id} AND p.provider_id = ${provider.id}`;
    if (!row) throw notFound('List entry');
    if (body.status === 'active') {
      const [dup] = await sql<{ id: number }[]>`
        SELECT id FROM patient_supplements
        WHERE patient_id = ${row.patient_id} AND supplement_id = ${row.supplement_id}
          AND status = 'active' AND id <> ${id}`;
      if (dup)
        throw new HttpError(
          409,
          'already_listed',
          'An active entry for this supplement already exists',
        );
    }
    await sql`
      UPDATE patient_supplements SET
        sig = ${body.sig === undefined ? sql`sig` : body.sig ? body.sig : null},
        status = ${body.status ?? sql`status`},
        discontinued_at = ${
          body.status === 'discontinued'
            ? sql`now()`
            : body.status === 'active'
              ? null
              : sql`discontinued_at`
        }
      WHERE id = ${id}`;
    const rows = await loadPatientSupplements(sql, row.patient_id, publicOrigin(req));
    return rows.find((r) => r.id === id);
  });

  // GET /api/requests — the provider's requests, open first (badge + inbox)
  app.get('/api/requests', async (req) => {
    const provider = await requireProvider(req);
    return { requests: await loadRequests(sql, { provider_id: provider.id }) };
  });

  // POST /api/requests/:id/decline — close a request without an order; patient gets a message
  app.post<{ Params: { id: string } }>('/api/requests/:id/decline', async (req) => {
    const provider = await requireProvider(req);
    const id = idParam(req.params.id, 'request id');
    const body = parse(declineBody, req.body ?? {});
    const [r] = await sql<{ id: number; patient_id: number }[]>`
      SELECT id, patient_id FROM order_requests
      WHERE id = ${id} AND provider_id = ${provider.id} AND status = 'requested'`;
    if (!r) throw notFound('Open request');
    await sql`
      UPDATE order_requests SET status = 'declined', decline_note = ${body.note ? body.note : null},
        resolved_at = now()
      WHERE id = ${id}`;
    const patient = await ownPatient(provider.id, r.patient_id);
    try {
      await notifier.requestDeclined({
        patient: { id: patient.id, name: patient.name, email: patient.email },
        providerName: provider.name,
        note: body.note ?? null,
        portalUrl: portalUrl(publicOrigin(req), patient.portal_token),
      });
    } catch (err) {
      req.log.error({ err, requestId: id }, 'notifier failed after decline');
    }
    const requests = await loadRequests(sql, { patient_id: r.patient_id });
    return requests.find((x) => x.id === id);
  });
}
