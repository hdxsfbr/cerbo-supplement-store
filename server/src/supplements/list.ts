// The patient's supplement list and order requests — shared by the provider routes (chart tab)
// and the portal (My Supplements). Pure reads; writes live in the routes.

import type { Queryable } from '../db/client.js';
import { checkoutUrl } from '../orders/load.js';

export interface ListRow {
  id: number;
  supplement_id: number;
  name: string;
  sku: string | null;
  sig: string | null;
  status: 'active' | 'discontinued';
  added_by: 'provider' | 'patient';
  created_at: string;
  /** Most recent order this list row was placed on, if any. */
  latest_order: {
    id: number;
    status: 'draft' | 'awaiting_payment' | 'paid';
    sent_at: string | null;
    paid_at: string | null;
    checkout_url: string | null;
  } | null;
}

export async function loadPatientSupplements(
  sql: Queryable,
  patientId: number,
  publicWebOrigin: string,
): Promise<ListRow[]> {
  const rows = await sql<
    {
      id: number;
      supplement_id: number;
      name: string;
      sku: string | null;
      sig: string | null;
      status: 'active' | 'discontinued';
      added_by: 'provider' | 'patient';
      created_at: string;
      order_id: number | null;
      order_status: 'draft' | 'awaiting_payment' | 'paid' | null;
      sent_at: string | null;
      paid_at: string | null;
      checkout_token: string | null;
    }[]
  >`
    SELECT ps.id, ps.supplement_id, s.name, s.sku, ps.sig, ps.status, ps.added_by, ps.created_at,
           o.id AS order_id, o.status AS order_status, o.sent_at, o.paid_at, o.checkout_token
    FROM patient_supplements ps
    JOIN supplements s ON s.id = ps.supplement_id
    LEFT JOIN LATERAL (
      SELECT o.id, o.status, o.sent_at, o.paid_at, o.checkout_token
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.patient_supplement_id = ps.id
      ORDER BY o.id DESC LIMIT 1
    ) o ON true
    WHERE ps.patient_id = ${patientId}
    ORDER BY (ps.status = 'active') DESC, ps.created_at DESC, ps.id DESC`;
  return rows.map(({ order_id, order_status, sent_at, paid_at, checkout_token, ...r }) => ({
    ...r,
    latest_order:
      order_id && order_status
        ? {
            id: order_id,
            status: order_status,
            sent_at,
            paid_at,
            checkout_url:
              order_status === 'awaiting_payment' && checkout_token
                ? checkoutUrl(publicWebOrigin, checkout_token)
                : null,
          }
        : null,
  }));
}

export interface RequestRow {
  id: number;
  patient_id: number;
  patient_name: string;
  status: 'requested' | 'fulfilled' | 'declined';
  note: string | null;
  decline_note: string | null;
  order_id: number | null;
  created_at: string;
  resolved_at: string | null;
  items: { patient_supplement_id: number; name: string; sig: string | null }[];
}

export async function loadRequests(
  sql: Queryable,
  where: { patient_id: number } | { provider_id: number },
): Promise<RequestRow[]> {
  const base = sql`
    SELECT r.id, r.patient_id, p.name AS patient_name, r.status, r.note, r.decline_note,
           r.order_id, r.created_at, r.resolved_at
    FROM order_requests r JOIN patients p ON p.id = r.patient_id`;
  const rows =
    'patient_id' in where
      ? await sql<Omit<RequestRow, 'items'>[]>`${base} WHERE r.patient_id = ${where.patient_id}
          ORDER BY r.created_at DESC, r.id DESC`
      : await sql<Omit<RequestRow, 'items'>[]>`${base} WHERE r.provider_id = ${where.provider_id}
          ORDER BY (r.status = 'requested') DESC, r.created_at DESC, r.id DESC`;
  if (rows.length === 0) return [];
  const items = await sql<
    { request_id: number; patient_supplement_id: number; name: string; sig: string | null }[]
  >`
    SELECT ri.request_id, ri.patient_supplement_id, s.name, ps.sig
    FROM order_request_items ri
    JOIN patient_supplements ps ON ps.id = ri.patient_supplement_id
    JOIN supplements s ON s.id = ps.supplement_id
    WHERE ri.request_id IN ${sql(rows.map((r) => r.id))}
    ORDER BY ri.request_id, ps.id`;
  return rows.map((r) => ({
    ...r,
    items: items.filter((i) => i.request_id === r.id).map(({ request_id: _r, ...i }) => i),
  }));
}

/** The patient-facing shape of a request (no patient fields: the portal already knows who it is). */
export type PortalRequest = Omit<RequestRow, 'patient_id' | 'patient_name'>;
export function toPortalRequest(r: RequestRow): PortalRequest {
  const { patient_id: _patientId, patient_name: _patientName, ...rest } = r;
  void _patientId;
  void _patientName;
  return rest;
}
