// DECISIONS #17: the patient's supplement LIST (clinical) is separate from supplement ORDERS
// (transactions). Providers add to the list and start orders from it; patients self-report
// supplements and request orders, which the provider prices and sends (or declines).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.teardown();
});

const WELBY = 1;
const ANDERSON = 2;
const ZEUS = 1; // Welby's patient
const HERA = 2; // Welby's patient

async function portalTokenFor(patientId: number): Promise<string> {
  const [row] = await ctx.sql<
    { portal_token: string }[]
  >`SELECT portal_token FROM patients WHERE id = ${patientId}`;
  return row!.portal_token;
}

describe('provider: supplement list → order', () => {
  let magnesiumRow: number;
  let omegaRow: number;

  it('adds catalog supplements to the patient’s list with a sig; duplicates are 409', async () => {
    const a = await api(ctx.app, 'POST', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
      body: { supplement_id: 3, sig: 'Take 2 capsules at bedtime' },
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      supplement_id: 3,
      sig: 'Take 2 capsules at bedtime',
      status: 'active',
      added_by: 'provider',
      latest_order: null,
    });
    magnesiumRow = a.body.id;

    const b = await api(ctx.app, 'POST', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
      body: { supplement_id: 1 },
    });
    expect(b.status).toBe(201);
    omegaRow = b.body.id;

    const dup = await api(ctx.app, 'POST', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
      body: { supplement_id: 3 },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_listed');

    const list = await api(ctx.app, 'GET', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
    });
    expect(list.status).toBe(200);
    expect(list.body.supplements.map((r: { supplement_id: number }) => r.supplement_id)).toEqual([
      1, 3,
    ]);
    expect(list.body.requests).toEqual([]);
    expect(JSON.stringify(list.body)).not.toMatch(/cogs|margin|fee|price/);
  });

  it('another provider cannot see or add to this patient’s list', async () => {
    const get = await api(ctx.app, 'GET', `/api/patients/${ZEUS}/supplements`, {
      provider: ANDERSON,
    });
    expect(get.status).toBe(404);
    const post = await api(ctx.app, 'POST', `/api/patients/${ZEUS}/supplements`, {
      provider: ANDERSON,
      body: { supplement_id: 2 },
    });
    expect(post.status).toBe(404);
  });

  it('creates an order pre-filled from selected list rows: default price, list sig, back-link', async () => {
    const res = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: ZEUS, patient_supplement_ids: [magnesiumRow, omegaRow] },
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.items).toHaveLength(2);
    const mag = res.body.items.find((i: { supplement_id: number }) => i.supplement_id === 3);
    expect(mag).toMatchObject({
      quantity: 1,
      unit_price_cents: 1900,
      unit_cogs_cents: 950,
      sig: 'Take 2 capsules at bedtime',
      patient_supplement_id: magnesiumRow,
    });

    // The list now points at the draft; a row from another patient’s list is refused.
    const list = await api(ctx.app, 'GET', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
    });
    const row = list.body.supplements.find((r: { id: number }) => r.id === magnesiumRow);
    expect(row.latest_order).toMatchObject({ id: res.body.id, status: 'draft' });

    const bad = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: HERA, patient_supplement_ids: [magnesiumRow] },
    });
    expect(bad.status).toBe(400);
  });

  it('PUT items keeps the list link per line; a discontinued row cannot seed a new order', async () => {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: ZEUS, patient_supplement_ids: [omegaRow] },
    });
    const put = await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: WELBY,
      body: {
        items: [
          {
            supplement_id: 1,
            quantity: 2,
            unit_price_cents: 3000,
            patient_supplement_id: omegaRow,
          },
          { supplement_id: 2, quantity: 1, unit_price_cents: 850 }, // ad-hoc line, no list row
        ],
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.items[0].patient_supplement_id).toBe(omegaRow);
    expect(put.body.items[1].patient_supplement_id).toBeNull();

    const off = await api(ctx.app, 'PATCH', `/api/patient-supplements/${omegaRow}`, {
      provider: WELBY,
      body: { status: 'discontinued' },
    });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('discontinued');
    const again = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: ZEUS, patient_supplement_ids: [omegaRow] },
    });
    expect(again.status).toBe(400);
    const on = await api(ctx.app, 'PATCH', `/api/patient-supplements/${omegaRow}`, {
      provider: WELBY,
      body: { status: 'active', sig: '2 softgels with breakfast' },
    });
    expect(on.body).toMatchObject({ status: 'active', sig: '2 softgels with breakfast' });
  });
});

describe('patient: self-reported list + order requests', () => {
  let token: string;
  let curcuminRow: number;
  let requestId: number;

  beforeAll(async () => {
    token = await portalTokenFor(ZEUS);
  });

  it('the portal shows the list and a names-only catalog; the patient can add to the list', async () => {
    const view = await api(ctx.app, 'GET', `/api/portal/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.supplements.length).toBeGreaterThanOrEqual(2);
    expect(view.body.catalog[0]).toEqual({
      id: expect.any(Number),
      name: expect.any(String),
      sku: expect.any(String),
    });
    expect(JSON.stringify(view.body.catalog)).not.toMatch(/cents|cogs|price/);

    const add = await api(ctx.app, 'POST', `/api/portal/${token}/supplements`, {
      body: { supplement_id: 5, sig: 'One with lunch' },
    });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ supplement_id: 5, added_by: 'patient', status: 'active' });
    curcuminRow = add.body.id;

    // The provider sees the self-reported row too.
    const list = await api(ctx.app, 'GET', `/api/patients/${ZEUS}/supplements`, {
      provider: WELBY,
    });
    expect(list.body.supplements.find((r: { id: number }) => r.id === curcuminRow).added_by).toBe(
      'patient',
    );
  });

  it('a request is not an order: it records the rows asked for and reaches the provider', async () => {
    const res = await api(ctx.app, 'POST', `/api/portal/${token}/requests`, {
      body: { patient_supplement_ids: [curcuminRow], note: 'Running low' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'requested',
      note: 'Running low',
      order_id: null,
      items: [{ patient_supplement_id: curcuminRow }],
    });
    expect(res.body.patient_name).toBeUndefined();
    requestId = res.body.id;

    const dup = await api(ctx.app, 'POST', `/api/portal/${token}/requests`, {
      body: { patient_supplement_ids: [curcuminRow] },
    });
    expect(dup.status).toBe(409);

    const inbox = await api(ctx.app, 'GET', '/api/requests', { provider: WELBY });
    expect(inbox.body.requests[0]).toMatchObject({
      id: requestId,
      patient_name: 'Zeus King',
      status: 'requested',
    });
    const other = await api(ctx.app, 'GET', '/api/requests', { provider: ANDERSON });
    expect(other.body.requests).toEqual([]);
    const orders = await api(ctx.app, 'GET', '/api/orders', { provider: WELBY });
    expect(orders.body.orders.every((o: { status: string }) => o.status !== 'requested')).toBe(
      true,
    );
  });

  it('fulfilling: the provider starts an order from the request, prices it, sends it → fulfilled', async () => {
    const wrong = await api(ctx.app, 'POST', '/api/orders', {
      provider: ANDERSON,
      body: { patient_id: ZEUS, request_id: requestId },
    });
    expect(wrong.status).toBe(404);

    const order = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: ZEUS, request_id: requestId },
    });
    expect(order.status).toBe(201);
    expect(order.body.items).toHaveLength(1);
    expect(order.body.items[0]).toMatchObject({
      supplement_id: 5,
      sig: 'One with lunch',
      patient_supplement_id: curcuminRow,
      unit_price_cents: 3800,
    });

    const mid = await api(ctx.app, 'GET', '/api/requests', { provider: WELBY });
    expect(mid.body.requests[0]).toMatchObject({ status: 'requested', order_id: order.body.id });

    await api(ctx.app, 'PUT', `/api/orders/${order.body.id}/items`, {
      provider: WELBY,
      body: {
        items: [
          {
            supplement_id: 5,
            quantity: 1,
            unit_price_cents: 3500, // provider sets the price, not the patient
            sig: 'One with lunch',
            patient_supplement_id: curcuminRow,
          },
        ],
      },
    });
    const sent = await api(ctx.app, 'POST', `/api/orders/${order.body.id}/send`, {
      provider: WELBY,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.total_cents).toBe(3500);

    const after = await api(ctx.app, 'GET', `/api/portal/${token}`);
    const req = after.body.requests.find((r: { id: number }) => r.id === requestId);
    expect(req).toMatchObject({ status: 'fulfilled', order_id: order.body.id });
    expect(req.resolved_at).not.toBeNull();
    const row = after.body.supplements.find((r: { id: number }) => r.id === curcuminRow);
    expect(row.latest_order).toMatchObject({ id: order.body.id, status: 'awaiting_payment' });
    expect(row.latest_order.checkout_url).toContain('/pay/');
    expect(after.body.balance_due_cents).toBeGreaterThanOrEqual(3500);
  });

  it('declining: closes the request and messages the patient; a second decline is 404', async () => {
    const hera = await portalTokenFor(HERA);
    const added = await api(ctx.app, 'POST', `/api/portal/${hera}/supplements`, {
      body: { supplement_id: 2 },
    });
    const r = await api(ctx.app, 'POST', `/api/portal/${hera}/requests`, {
      body: { patient_supplement_ids: [added.body.id] },
    });
    expect(r.status).toBe(201);

    const declined = await api(ctx.app, 'POST', `/api/requests/${r.body.id}/decline`, {
      provider: WELBY,
      body: { note: 'Let’s talk at your next visit first.' },
    });
    expect(declined.status).toBe(200);
    expect(declined.body).toMatchObject({
      status: 'declined',
      decline_note: 'Let’s talk at your next visit first.',
    });
    expect(ctx.notifier.declined).toHaveLength(1);
    expect(ctx.notifier.declined[0]!.patient.id).toBe(HERA);

    const portal = await api(ctx.app, 'GET', `/api/portal/${hera}`);
    expect(portal.body.messages[0]).toMatchObject({
      order_id: null,
      subject: 'About your supplement request',
    });
    expect(portal.body.messages[0].body).toContain('Let’s talk at your next visit first.');

    const again = await api(ctx.app, 'POST', `/api/requests/${r.body.id}/decline`, {
      provider: WELBY,
      body: {},
    });
    expect(again.status).toBe(404);
  });
});
