// HDX-96: sending an order notifies the patient the way Cerbo would (portal message + email
// nudge) and the patient portal shows messages + invoices. HDX-97: card details on payments.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, PUBLIC_WEB_ORIGIN, type TestContext } from './helpers.js';
import { composeNotifications } from '../../src/seams/notifier.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.teardown();
});

const WELBY = 1;

async function portalTokenFor(patientId: number): Promise<string> {
  const [row] = await ctx.sql<
    { portal_token: string }[]
  >`SELECT portal_token FROM patients WHERE id = ${patientId}`;
  return row!.portal_token;
}

describe('notifications on send (HDX-96)', () => {
  let orderId: number;

  it('writes a portal message and an email nudge; the send response lists them', async () => {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 1 },
    });
    orderId = created.body.id;
    await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 1, quantity: 2, unit_price_cents: 3200 }] },
    });
    const sent = await api(ctx.app, 'POST', `/api/orders/${orderId}/send`, { provider: WELBY });
    expect(sent.status).toBe(200);
    expect(sent.body.notified).toBe(true);
    expect(sent.body.portal_url).toMatch(new RegExp(`^${PUBLIC_WEB_ORIGIN}/portal/[0-9a-f]{32}$`));

    const n = sent.body.notifications;
    expect(n.map((x: { channel: string }) => x.channel)).toEqual(['portal_message', 'email']);
    expect(n[0]).toMatchObject({
      subject: 'Supplement order #' + orderId + ' from Dr. Marcus Welby — $64.00 due',
      link: sent.body.checkout_url,
      recipient: null,
    });
    expect(n[1]).toMatchObject({ recipient: 'zeus@olympus.example', link: sent.body.portal_url });
    expect(n[1].body).toMatch(/^Hi Zeus, you have a new secure message/);

    // Also visible on a plain GET of the order
    const got = await api(ctx.app, 'GET', `/api/orders/${orderId}`, { provider: WELBY });
    expect(got.body.notifications).toHaveLength(2);
  });

  it('composeNotifications is pure and pins the copy', () => {
    const [portal, email] = composeNotifications({
      orderId: 9,
      patient: { id: 1, name: 'Hera Elaine Queen', email: 'hera@x' },
      providerName: 'Dr. A',
      amountCents: 1234,
      checkoutUrl: 'http://w/pay/t',
      portalUrl: 'http://w/portal/p',
    });
    expect(portal).toMatchObject({
      channel: 'portal_message',
      subject: 'Supplement order #9 from Dr. A — $12.34 due',
      link: 'http://w/pay/t',
    });
    expect(email).toMatchObject({
      channel: 'email',
      recipient: 'hera@x',
      link: 'http://w/portal/p',
    });
    expect(email!.body).toMatch(/^Hi Hera,/);
  });

  it('a patient without an email gets the portal message only', async () => {
    await ctx.sql`UPDATE patients SET email = NULL WHERE id = 2`;
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 2 },
    });
    await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 2, quantity: 1, unit_price_cents: 850 }] },
    });
    const sent = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
      provider: WELBY,
    });
    expect(sent.body.notifications.map((x: { channel: string }) => x.channel)).toEqual([
      'portal_message',
    ]);
  });

  it('GET /api/portal/:token shows the patient’s messages and invoices; paying updates the invoice', async () => {
    const token = await portalTokenFor(1);
    const before = await api(ctx.app, 'GET', `/api/portal/${token}`);
    expect(before.status).toBe(200);
    expect(before.body.patient.name).toBe('Zeus King');
    expect(before.body.provider.name).toBe('Dr. Marcus Welby');
    expect(before.body.messages).toHaveLength(1);
    expect(before.body.messages[0]).toMatchObject({
      order_id: orderId,
      order_status: 'awaiting_payment',
    });
    expect(before.body.invoices).toHaveLength(1);
    expect(before.body.invoices[0]).toMatchObject({
      id: orderId,
      status: 'awaiting_payment',
      total_cents: 6400,
      item_count: 1,
    });
    expect(before.body.balance_due_cents).toBe(6400);
    expect(before.body.invoices[0].items).toHaveLength(1);
    expect(before.body.invoices[0].items[0]).toMatchObject({ quantity: 2, line_total_cents: 6400 });
    expect(before.body.invoices[0].card).toBeNull();
    expect(before.body.payment_method).toBeNull();
    expect(JSON.stringify(before.body)).not.toMatch(/cogs|margin|fee/);

    const checkoutToken = before.body.invoices[0].checkout_url.split('/pay/')[1];
    const pay = await api(ctx.app, 'POST', `/api/checkout/${checkoutToken}/pay`, {
      body: { idempotency_key: `portal_${orderId}_xxxxxxx` },
    });
    expect(pay.status).toBe(200);
    expect(pay.body.portal_url).toBe(
      before.body.invoices[0].checkout_url.replace(/\/pay\/.*/, `/portal/${token}`),
    );

    const after = await api(ctx.app, 'GET', `/api/portal/${token}`);
    expect(after.body.invoices[0]).toMatchObject({ id: orderId, status: 'paid' });
    expect(after.body.messages[0].order_status).toBe('paid');
    expect(after.body.balance_due_cents).toBe(0);
  });

  it('POST /api/portal/session exchanges a patient id for that patient’s portal token', async () => {
    const res = await api(ctx.app, 'POST', '/api/portal/session', { body: { patient_id: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe(await portalTokenFor(1));
    expect(res.body.patient).toMatchObject({ id: 1, name: 'Zeus King' });
    expect(res.body.provider.name).toBe('Dr. Marcus Welby');
    const missing = await api(ctx.app, 'POST', '/api/portal/session', {
      body: { patient_id: 999 },
    });
    expect(missing.status).toBe(404);
    const bad = await api(ctx.app, 'POST', '/api/portal/session', { body: { patient_id: 'x' } });
    expect(bad.status).toBe(400);
  });

  it('another patient’s portal does not show this patient’s data; bad token → 404', async () => {
    const other = await api(ctx.app, 'GET', `/api/portal/${await portalTokenFor(4)}`);
    expect(other.body.messages).toHaveLength(0);
    expect(other.body.invoices).toHaveLength(0);
    expect((await api(ctx.app, 'GET', '/api/portal/nope')).status).toBe(404);
    expect((await api(ctx.app, 'GET', '/api/portal/00000000000000000000000000000000')).status).toBe(
      404,
    );
  });
});

describe('card payment method (HDX-97)', () => {
  async function sent(
    items: { supplement_id: number; quantity: number; unit_price_cents: number }[],
  ) {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 3 },
    });
    await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: WELBY,
      body: { items },
    });
    const s = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
      provider: WELBY,
    });
    return {
      id: created.body.id as number,
      token: s.body.checkout_url.split('/pay/')[1] as string,
    };
  }

  it('a declined test card → 402, nothing written; a good card then succeeds and stores brand/last4', async () => {
    const o = await sent([{ supplement_id: 3, quantity: 1, unit_price_cents: 1900 }]);
    const key = `card_${o.id}_xxxxxxxx`;
    const declined = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: {
        idempotency_key: key,
        payment_method: { token: 'fake_tok_visa_0002_declined', brand: 'visa', last4: '0002' },
      },
    });
    expect(declined.status).toBe(402);
    expect(declined.body.error.message).toMatch(/declined/i);
    expect(await ctx.sql`SELECT id FROM payments WHERE order_id = ${o.id}`).toHaveLength(0);

    const ok = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: {
        idempotency_key: key,
        payment_method: { token: 'fake_tok_visa_4242_ok', brand: 'visa', last4: '4242' },
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.payment).toMatchObject({ card_brand: 'visa', card_last4: '4242' });
    const receipt = await api(ctx.app, 'GET', `/api/checkout/${o.token}`);
    expect(receipt.body.payment).toMatchObject({ card_brand: 'visa', card_last4: '4242' });
  });

  it('a processing-error test card → 502; a malformed token → 402 invalid', async () => {
    const o = await sent([{ supplement_id: 3, quantity: 1, unit_price_cents: 1900 }]);
    const err = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: {
        idempotency_key: `cerr_${o.id}_xxxxxxx`,
        payment_method: { token: 'fake_tok_visa_0119_error', brand: 'visa', last4: '0119' },
      },
    });
    expect(err.status).toBe(502);
    const bad = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: {
        idempotency_key: `cbad_${o.id}_xxxxxxx`,
        payment_method: { token: 'tok_not_ours_123', brand: 'visa', last4: '1111' },
      },
    });
    expect(bad.status).toBe(402);
    const [row] = await ctx.sql<{ status: string }[]>`SELECT status FROM orders WHERE id = ${o.id}`;
    expect(row!.status).toBe('awaiting_payment');
  });

  it('rejects a malformed payment_method (400) and still accepts no payment_method at all', async () => {
    const o = await sent([{ supplement_id: 3, quantity: 1, unit_price_cents: 1900 }]);
    const bad = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: {
        idempotency_key: `pm_${o.id}_xxxxxxxxx`,
        payment_method: { token: 'x', brand: '', last4: '12' },
      },
    });
    expect(bad.status).toBe(400);
    const none = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `pm_${o.id}_xxxxxxxxx` },
    });
    expect(none.status).toBe(200);
    expect(none.body.payment).toMatchObject({ card_brand: null, card_last4: null });
  });
});

describe('backfill of pre-005 orders (migration 006)', () => {
  it('an awaiting-payment order without a portal message gets one with the same copy', async () => {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 3 },
    });
    await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 2, quantity: 1, unit_price_cents: 850 }] },
    });
    await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, { provider: WELBY });
    await ctx.sql`DELETE FROM notifications WHERE order_id = ${created.body.id}`; // pretend it predates 005
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(
      new URL('../../src/db/migrations/006_backfill_portal_messages.sql', import.meta.url),
      'utf8',
    );
    await ctx.sql.unsafe(body);
    const rows = await ctx.sql<{ subject: string; link: string | null }[]>`
      SELECT subject, link FROM notifications WHERE order_id = ${created.body.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      subject: `Supplement order #${created.body.id} from Dr. Marcus Welby — $8.50 due`,
      link: null,
    });
    // portal still exposes a way to pay it
    const portal = await api(ctx.app, 'GET', `/api/portal/${await portalTokenFor(3)}`);
    const msg = portal.body.messages.find(
      (m: { order_id: number }) => m.order_id === created.body.id,
    );
    expect(msg.link).toBeNull();
    expect(
      portal.body.invoices.find((i: { id: number }) => i.id === created.body.id).checkout_url,
    ).toMatch(/\/pay\//);
  });
});
