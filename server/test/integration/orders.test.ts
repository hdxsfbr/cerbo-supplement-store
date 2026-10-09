// US1 integration: provider assembles an order (T013). Real Postgres, real triggers.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, PUBLIC_WEB_ORIGIN, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.teardown();
});

// Seed facts (003_seed.sql): provider 1 = Welby (patients 1–3), provider 2 = Anderson (4–6);
// supplement 1 = Omega-3 (cogs 1850, price 3200), 2 = Vitamin D3 (cogs 400, price 850).
const WELBY = 1;
const ANDERSON = 2;

describe('catalog & patients (T011)', () => {
  it('GET /api/supplements lists the seeded catalog with cost basis and defaults', async () => {
    const res = await api(ctx.app, 'GET', '/api/supplements', { provider: WELBY });
    expect(res.status).toBe(200);
    expect(res.body.supplements).toHaveLength(8);
    const omega = res.body.supplements.find((s: { sku: string }) => s.sku === 'OMG-1000-120');
    expect(omega).toMatchObject({
      unit_cogs_cents: 1850,
      default_price_cents: 3200,
      inventory_count: 120,
    });
  });

  it('GET /api/patients is scoped to the acting provider; default provider is the first seeded', async () => {
    const welby = await api(ctx.app, 'GET', '/api/patients', { provider: WELBY });
    expect(welby.body.provider.name).toBe('Dr. Marcus Welby');
    expect(welby.body.patients.map((p: { name: string }) => p.name)).toEqual([
      'Demeter W Harvest',
      'Hera Elaine Queen',
      'Zeus King',
    ]);
    const anderson = await api(ctx.app, 'GET', '/api/patients', { provider: ANDERSON });
    expect(anderson.body.patients).toHaveLength(3);
    const noHeader = await api(ctx.app, 'GET', '/api/patients');
    expect(noHeader.body.provider.id).toBe(WELBY);
  });

  it('unknown acting provider → 401 unknown_provider', async () => {
    const res = await api(ctx.app, 'GET', '/api/patients', { provider: 999 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unknown_provider');
  });
});

describe('order assembly → send (T012)', () => {
  let orderId: number;

  it('POST /api/orders creates a draft for the provider’s own patient', async () => {
    const res = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 1 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      patient: { id: 1, name: 'Zeus King' },
      items: [],
      total_cents: 0,
      checkout_url: null,
      split: { total_cents: 0, cogs_cents: 0, fee_cents: 0, margin_cents: 0, fee_bps: 75 },
    });
    orderId = res.body.id;
  });

  it('POST /api/orders for another provider’s patient → 404', async () => {
    const res = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 4 },
    });
    expect(res.status).toBe(404);
  });

  it('PUT items snapshots COGS from the catalog and returns a live split preview', async () => {
    const res = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: {
        items: [
          { supplement_id: 1, quantity: 2, unit_price_cents: 3200 },
          { supplement_id: 2, quantity: 1, unit_price_cents: 300 }, // below COGS (400)
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      supplement_id: 1,
      quantity: 2,
      unit_cogs_cents: 1850,
      unit_price_cents: 3200,
      line_total_cents: 6400,
      below_cogs: false,
    });
    expect(res.body.items[1]).toMatchObject({
      unit_cogs_cents: 400,
      unit_price_cents: 300,
      below_cogs: true,
    });
    // total 6700; cogs 4100; fee floor((6700*75+5000)/10000)=floor(50.75)=50 ; margin 2550
    expect(res.body.split).toMatchObject({
      total_cents: 6700,
      cogs_cents: 4100,
      fee_cents: 50,
      margin_cents: 2550,
    });
    expect(res.body.total_cents).toBe(6700);
    expect(res.body.split.memos.platform_fee).toBe('75 bps of 6700¢ = 50.25¢ → 50¢ (half-up)');
  });

  it('PUT items persists an optional patient sig per line and omits it when absent', async () => {
    const res = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: {
        items: [
          { supplement_id: 1, quantity: 2, unit_price_cents: 3200, sig: 'Take 2 softgels daily' },
          { supplement_id: 2, quantity: 1, unit_price_cents: 300 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.items[0].sig).toBe('Take 2 softgels daily');
    expect(res.body.items[1].sig).toBeNull();
    const again = await api(ctx.app, 'GET', `/api/orders/${orderId}`, { provider: WELBY });
    expect(again.body.items[0].sig).toBe('Take 2 softgels daily');
    const tooLong = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: {
        items: [{ supplement_id: 1, quantity: 1, unit_price_cents: 1, sig: 'x'.repeat(501) }],
      },
    });
    expect(tooLong.status).toBe(400);
  });

  it('the COGS snapshot is immune to later catalog changes (FR-002)', async () => {
    await ctx.sql`UPDATE supplements SET unit_cogs_cents = 9999 WHERE id = 1`;
    const res = await api(ctx.app, 'GET', `/api/orders/${orderId}`, { provider: WELBY });
    expect(res.body.items[0].unit_cogs_cents).toBe(1850);
    expect(res.body.split.cogs_cents).toBe(4100);
    await ctx.sql`UPDATE supplements SET unit_cogs_cents = 1850 WHERE id = 1`;
  });

  it('rejects malformed lines: duplicate supplement, zero quantity, fractional cents', async () => {
    const dup = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: {
        items: [
          { supplement_id: 1, quantity: 1, unit_price_cents: 1 },
          { supplement_id: 1, quantity: 1, unit_price_cents: 1 },
        ],
      },
    });
    expect(dup.status).toBe(400);
    const zero = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 1, quantity: 0, unit_price_cents: 1 }] },
    });
    expect(zero.status).toBe(400);
    const frac = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 1, quantity: 1, unit_price_cents: 10.5 }] },
    });
    expect(frac.status).toBe(400);
    expect(frac.body.error.code).toBe('validation_error');
  });

  it('another provider cannot see or edit the order', async () => {
    const get = await api(ctx.app, 'GET', `/api/orders/${orderId}`, { provider: ANDERSON });
    expect(get.status).toBe(404);
    const put = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: ANDERSON,
      body: { items: [] },
    });
    expect(put.status).toBe(404);
  });

  it('sending an empty order → 422 order_empty', async () => {
    const empty = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 2 },
    });
    const res = await api(ctx.app, 'POST', `/api/orders/${empty.body.id}/send`, {
      provider: WELBY,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('order_empty');
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it('POST send → awaiting_payment, total frozen, checkout_url issued, notifier called', async () => {
    const res = await api(ctx.app, 'POST', `/api/orders/${orderId}/send`, { provider: WELBY });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_payment');
    expect(res.body.total_cents).toBe(6700);
    expect(res.body.sent_at).toBeTruthy();
    expect(res.body.checkout_url).toMatch(new RegExp(`^${PUBLIC_WEB_ORIGIN}/pay/[0-9a-f]{32}$`));
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]).toMatchObject({ orderId, checkoutUrl: res.body.checkout_url });
    const [row] = await ctx.sql<{ total_cents: number; status: string }[]>`
      SELECT total_cents, status FROM orders WHERE id = ${orderId}`;
    expect(row).toEqual({ total_cents: 6700, status: 'awaiting_payment' });
  });

  it('mutating a sent order → 409 order_locked (contract invariant 4)', async () => {
    const put = await api(ctx.app, 'PUT', `/api/orders/${orderId}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 3, quantity: 1, unit_price_cents: 100 }] },
    });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('order_locked');
    const again = await api(ctx.app, 'POST', `/api/orders/${orderId}/send`, { provider: WELBY });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('order_locked');
    // and the lines are untouched
    const get = await api(ctx.app, 'GET', `/api/orders/${orderId}`, { provider: WELBY });
    expect(get.body.items).toHaveLength(2);
    expect(get.body.total_cents).toBe(6700);
  });

  it('send still succeeds (200, notified:false) when the notifier throws; order is payable (HDX-89)', async () => {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 3 },
    });
    await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: WELBY,
      body: { items: [{ supplement_id: 4, quantity: 1, unit_price_cents: 4500 }] },
    });
    ctx.notifier.failNext = true;
    const res = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
      provider: WELBY,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_payment');
    expect(res.body.notified).toBe(false);
    expect(res.body.checkout_url).toMatch(/\/pay\/[0-9a-f]{32}$/);
    // The link works and the order is locked exactly as a normally-sent order would be.
    const token = res.body.checkout_url.split('/pay/')[1];
    expect((await api(ctx.app, 'GET', `/api/checkout/${token}`)).status).toBe(200);
    const again = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
      provider: WELBY,
    });
    expect(again.status).toBe(409);
    // A normal send reports notified:true
    expect(ctx.notifier.sent.at(-1)?.orderId).not.toBe(created.body.id);
  });

  it('GET /api/orders lists the provider’s orders newest first with totals', async () => {
    const res = await api(ctx.app, 'GET', '/api/orders', { provider: WELBY });
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(3);
    expect(res.body.orders[0]).toMatchObject({
      status: 'awaiting_payment',
      item_count: 1,
      total_cents: 4500,
    });
    expect(res.body.orders[1]).toMatchObject({ status: 'draft', item_count: 0, total_cents: 0 });
    expect(res.body.orders[2]).toMatchObject({
      id: orderId,
      status: 'awaiting_payment',
      patient_name: 'Zeus King',
      item_count: 2,
      total_cents: 6700,
    });
    const other = await api(ctx.app, 'GET', '/api/orders', { provider: ANDERSON });
    expect(other.body.orders).toHaveLength(0);
  });
});
