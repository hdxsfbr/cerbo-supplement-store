// US3 integration (T022): dashboard aggregates reconcile with per-order ledgers (SC-004,
// contract invariant 5); inventory edits persist and sales move stock.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, type TestContext } from './helpers.js';
import { dashboardPaidOrders, dashboardTotals } from '../../src/routes/dashboard.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.teardown();
});

const WELBY = 1;
const ANDERSON = 2;

async function paidOrder(
  provider: number,
  patient_id: number,
  items: { supplement_id: number; quantity: number; unit_price_cents: number }[],
) {
  const created = await api(ctx.app, 'POST', '/api/orders', { provider, body: { patient_id } });
  await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, { provider, body: { items } });
  const sent = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, { provider });
  const token = sent.body.checkout_url.split('/pay/')[1] as string;
  const paid = await api(ctx.app, 'POST', `/api/checkout/${token}/pay`, {
    body: { idempotency_key: `dash_${created.body.id}_xxxxxxxx` },
  });
  expect(paid.status).toBe(200);
  return created.body.id as number;
}

describe('dashboard summary (T022)', () => {
  it('empty dashboard is all zeros', async () => {
    const res = await api(ctx.app, 'GET', '/api/dashboard/summary', { provider: WELBY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      orders_paid: 0,
      gross_cents: 0,
      cogs_cents: 0,
      margin_cents: 0,
      fees_cents: 0,
      paid_orders: [],
    });
    const inv = await api(ctx.app, 'GET', '/api/inventory', { provider: WELBY });
    expect(inv.body.inventory).toHaveLength(8);
  });

  it('aggregates equal the sum over each paid order’s ledger (contract invariant 5)', async () => {
    const ids = [
      await paidOrder(WELBY, 1, [
        { supplement_id: 1, quantity: 2, unit_price_cents: 3200 },
        { supplement_id: 2, quantity: 1, unit_price_cents: 300 },
      ]),
      await paidOrder(WELBY, 2, [{ supplement_id: 2, quantity: 1, unit_price_cents: 200 }]), // half-cent fee case
      await paidOrder(WELBY, 3, [{ supplement_id: 5, quantity: 3, unit_price_cents: 1000 }]), // below COGS
    ];
    // an unpaid order and another provider's paid order must not leak in
    await api(ctx.app, 'POST', '/api/orders', { provider: WELBY, body: { patient_id: 1 } });
    await paidOrder(ANDERSON, 4, [{ supplement_id: 4, quantity: 1, unit_price_cents: 4500 }]);

    const expected = { gross: 0, cogs: 0, margin: 0, fees: 0 };
    for (const id of ids) {
      const ledger = await api(ctx.app, 'GET', `/api/orders/${id}/ledger`, { provider: WELBY });
      expected.gross += ledger.body.total_cents;
      for (const e of ledger.body.entries) {
        if (e.entry_type === 'cogs') expected.cogs += e.amount_cents;
        if (e.entry_type === 'provider_margin') expected.margin += e.amount_cents;
        if (e.entry_type === 'platform_fee') expected.fees += e.amount_cents;
      }
    }

    const res = await api(ctx.app, 'GET', '/api/dashboard/summary', { provider: WELBY });
    expect(res.body.orders_paid).toBe(3);
    expect(res.body.gross_cents).toBe(expected.gross);
    expect(res.body.cogs_cents).toBe(expected.cogs);
    expect(res.body.margin_cents).toBe(expected.margin);
    expect(res.body.fees_cents).toBe(expected.fees);
    expect(res.body.cogs_cents + res.body.margin_cents + res.body.fees_cents).toBe(
      res.body.gross_cents,
    );
    // sanity on absolute numbers: 6700 + 200 + 3000 = 9900 gross; fees 50 + 2 + 23 = 75
    expect(res.body.gross_cents).toBe(9900);
    expect(res.body.fees_cents).toBe(75);

    expect(res.body.paid_orders.map((o: { id: number }) => o.id).sort()).toEqual([...ids].sort());
    for (const row of res.body.paid_orders) {
      expect(row.cogs_cents + row.margin_cents + row.fee_cents).toBe(row.total_cents);
    }

    const anderson = await api(ctx.app, 'GET', '/api/dashboard/summary', { provider: ANDERSON });
    expect(anderson.body).toMatchObject({ orders_paid: 1, gross_cents: 4500 });
  });

  it('inventory reflects sales (units_sold, decremented counts) and flags low/negative stock', async () => {
    const res = await api(ctx.app, 'GET', '/api/inventory', { provider: WELBY });
    const omega = res.body.inventory.find((s: { sku: string }) => s.sku === 'OMG-1000-120');
    expect(omega).toMatchObject({
      units_sold: 2,
      units_sold_mine: 2,
      inventory_count: 118,
      low: false,
      negative: false,
    });
    // the other provider sees the shared stock and practice-wide sales, but 0 sold by them
    const anderson = await api(ctx.app, 'GET', '/api/inventory', { provider: ANDERSON });
    const omegaA = anderson.body.inventory.find((s: { sku: string }) => s.sku === 'OMG-1000-120');
    expect(omegaA).toMatchObject({ units_sold: 2, units_sold_mine: 0, inventory_count: 118 });
    const adrenal = res.body.inventory.find((s: { sku: string }) => s.sku === 'ADR-SUP-120'); // seeded at 20
    expect(adrenal).toMatchObject({ inventory_count: 20, low: true, negative: false });
  });
});

describe('consistent snapshot (HDX-86)', () => {
  it('a payment committed between the totals read and the paid-orders read is invisible to both', async () => {
    // Set up a sent-but-unpaid order; we will pay it from OUTSIDE the read transaction mid-way.
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: ANDERSON,
      body: { patient_id: 5 },
    });
    await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
      provider: ANDERSON,
      body: { items: [{ supplement_id: 3, quantity: 1, unit_price_cents: 1900 }] },
    });
    const sent = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
      provider: ANDERSON,
    });
    const token = sent.body.checkout_url.split('/pay/')[1] as string;

    const before = await dashboardTotals(ctx.sql, ANDERSON);

    const seen = await ctx.sql.begin('isolation level repeatable read read only', async (tx) => {
      const totals = await dashboardTotals(tx, ANDERSON); // establishes the snapshot
      // Commit a payment on another connection while this transaction is open.
      const paid = await api(ctx.app, 'POST', `/api/checkout/${token}/pay`, {
        body: { idempotency_key: `snap_${created.body.id}_xxxxxxx` },
      });
      expect(paid.status).toBe(200);
      const rows = await dashboardPaidOrders(tx, ANDERSON);
      return { totals, rows };
    });

    // Inside the snapshot: both reads agree with each other and with the pre-payment state.
    expect(seen.totals).toEqual(before);
    expect(seen.rows.map((r) => r.id)).not.toContain(created.body.id);
    expect(seen.rows.reduce((s, r) => s + r.total_cents, 0)).toBe(seen.totals.gross_cents);

    // After the snapshot: the route sees the new payment in both places at once.
    const after = await api(ctx.app, 'GET', '/api/dashboard/summary', { provider: ANDERSON });
    expect(after.body.orders_paid).toBe(before.orders_paid + 1);
    expect(after.body.paid_orders.map((o: { id: number }) => o.id)).toContain(created.body.id);
    expect(
      after.body.paid_orders.reduce(
        (s: number, o: { total_cents: number }) => s + o.total_cents,
        0,
      ),
    ).toBe(after.body.gross_cents);
  });
});

describe('inventory PATCH (FR-008)', () => {
  it('sets an absolute count and persists', async () => {
    const res = await api(ctx.app, 'PATCH', '/api/supplements/1/inventory', {
      provider: WELBY,
      body: { inventory_count: 5 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, inventory_count: 5 });
    const list = await api(ctx.app, 'GET', '/api/supplements', { provider: WELBY });
    expect(list.body.supplements.find((s: { id: number }) => s.id === 1).inventory_count).toBe(5);
  });

  it('a sale can take stock below zero; the dashboard flags it', async () => {
    await paidOrder(WELBY, 1, [{ supplement_id: 1, quantity: 6, unit_price_cents: 3200 }]);
    const res = await api(ctx.app, 'GET', '/api/inventory', { provider: WELBY });
    const omega = res.body.inventory.find((s: { id: number }) => s.id === 1);
    expect(omega).toMatchObject({ inventory_count: -1, negative: true, low: false });
  });

  it('rejects non-integers and unknown supplements', async () => {
    expect(
      (
        await api(ctx.app, 'PATCH', '/api/supplements/1/inventory', {
          provider: WELBY,
          body: { inventory_count: 1.5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(ctx.app, 'PATCH', '/api/supplements/999/inventory', {
          provider: WELBY,
          body: { inventory_count: 1 },
        })
      ).status,
    ).toBe(404);
  });
});
