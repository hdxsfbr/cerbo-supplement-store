// US2 integration: patient pays, split recorded (T019). Contract invariants 1–4 and the
// adversarial DB checks from quickstart scenario 3. Real Postgres, real triggers.

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

async function sentOrder(
  items: { supplement_id: number; quantity: number; unit_price_cents: number }[],
) {
  const created = await api(ctx.app, 'POST', '/api/orders', {
    provider: WELBY,
    body: { patient_id: 1 },
  });
  await api(ctx.app, 'PUT', `/api/orders/${created.body.id}/items`, {
    provider: WELBY,
    body: { items },
  });
  const sent = await api(ctx.app, 'POST', `/api/orders/${created.body.id}/send`, {
    provider: WELBY,
  });
  expect(sent.status).toBe(200);
  const token = sent.body.checkout_url.split('/pay/')[1] as string;
  return { id: created.body.id as number, token, total: sent.body.total_cents as number };
}

async function sqlCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
}

describe('patient checkout view', () => {
  it('GET /api/checkout/:token shows items and prices only — never COGS, margin or fee', async () => {
    const { token } = await sentOrder([{ supplement_id: 1, quantity: 2, unit_price_cents: 3200 }]);
    const res = await api(ctx.app, 'GET', `/api/checkout/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'awaiting_payment',
      paid: false,
      provider: { name: 'Dr. Marcus Welby' },
      patient: { name: 'Zeus King' },
      total_cents: 6400,
    });
    expect(res.body.items[0]).toEqual({
      name: 'Omega-3 Fish Oil 1000 mg (120 softgels)',
      sku: 'OMG-1000-120',
      quantity: 2,
      unit_price_cents: 3200,
      sig: null,
      line_total_cents: 6400,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/cogs|margin|fee|split/);
  });

  it('unknown / malformed token → 404', async () => {
    expect(
      (await api(ctx.app, 'GET', '/api/checkout/00000000000000000000000000000000')).status,
    ).toBe(404);
    expect((await api(ctx.app, 'GET', '/api/checkout/nope')).status).toBe(404);
  });

  it('paying a draft (unsent) order → 409 order_not_payable', async () => {
    const created = await api(ctx.app, 'POST', '/api/orders', {
      provider: WELBY,
      body: { patient_id: 1 },
    });
    const [row] = await ctx.sql<{ checkout_token: string }[]>`
      SELECT checkout_token FROM orders WHERE id = ${created.body.id}`;
    const res = await api(ctx.app, 'POST', `/api/checkout/${row!.checkout_token}/pay`, {
      body: { idempotency_key: 'draft-attempt-0001' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('order_not_payable');
  });
});

describe('pay → payment + ledger in one transaction (FR-004, FR-005, FR-009)', () => {
  let order: { id: number; token: string; total: number };
  const KEY = 'ck_zeus_0001_abcdef';

  it('records payment, marks paid, writes exactly three ledger entries that sum to the total', async () => {
    // 2 × 3200 + 1 × 300 = 6700 ; COGS 2 × 1850 + 400 = 4100 ; fee 50.25 → 50 ; margin 2550
    order = await sentOrder([
      { supplement_id: 1, quantity: 2, unit_price_cents: 3200 },
      { supplement_id: 2, quantity: 1, unit_price_cents: 300 },
    ]);
    const res = await api(ctx.app, 'POST', `/api/checkout/${order.token}/pay`, {
      body: { idempotency_key: KEY },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paid: true, status: 'paid', total_cents: 6700 });
    expect(res.body.payment).toMatchObject({ idempotency_key: KEY, amount_cents: 6700 });
    expect(res.body.payment.gateway_ref).toMatch(/^fake_pi_[0-9a-f]{24}$/);
    expect(res.body.paid_at).toBeTruthy();

    const ledger = await ctx.sql<{ entry_type: string; amount_cents: number; memo: string }[]>`
      SELECT entry_type, amount_cents, memo FROM ledger_entries WHERE order_id = ${order.id} ORDER BY entry_type`;
    expect(ledger.map((e) => [e.entry_type, e.amount_cents])).toEqual([
      ['cogs', 4100],
      ['platform_fee', 50],
      ['provider_margin', 2550],
    ]);
    expect(ledger.reduce((s, e) => s + e.amount_cents, 0)).toBe(6700); // contract invariant 1
    expect(ledger.find((e) => e.entry_type === 'platform_fee')!.memo).toBe(
      '75 bps of 6700¢ = 50.25¢ → 50¢ (half-up)',
    );

    const payments = await ctx.sql`SELECT id FROM payments WHERE order_id = ${order.id}`;
    expect(payments).toHaveLength(1);
  });

  it('replay with the same idempotency key → 200, same payment, still one payment row + 3 entries', async () => {
    const first = await api(ctx.app, 'GET', `/api/checkout/${order.token}`);
    const replay = await api(ctx.app, 'POST', `/api/checkout/${order.token}/pay`, {
      body: { idempotency_key: KEY },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body).toEqual(first.body);
    const [counts] = await ctx.sql<{ payments: number; entries: number }[]>`
      SELECT (SELECT count(*)::int FROM payments WHERE order_id = ${order.id}) AS payments,
             (SELECT count(*)::int FROM ledger_entries WHERE order_id = ${order.id}) AS entries`;
    expect(counts).toEqual({ payments: 1, entries: 3 });
  });

  it('a different key on a paid order → 409 already_paid (contract invariant 3)', async () => {
    const res = await api(ctx.app, 'POST', `/api/checkout/${order.token}/pay`, {
      body: { idempotency_key: 'ck_zeus_0002_different' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_paid');
  });

  it('GET /api/checkout/:token after payment → receipt shape', async () => {
    const res = await api(ctx.app, 'GET', `/api/checkout/${order.token}`);
    expect(res.body.paid).toBe(true);
    expect(res.body.payment.amount_cents).toBe(6700);
  });

  it('GET /api/orders/:id/ledger exposes every cent + the fee computation (FR-006)', async () => {
    const res = await api(ctx.app, 'GET', `/api/orders/${order.id}/ledger`, { provider: WELBY });
    expect(res.status).toBe(200);
    expect(
      res.body.entries.map((e: { entry_type: string; amount_cents: number }) => [
        e.entry_type,
        e.amount_cents,
      ]),
    ).toEqual([
      ['cogs', 4100],
      ['provider_margin', 2550],
      ['platform_fee', 50],
    ]);
    expect(res.body.sum_cents).toBe(6700);
    expect(res.body.total_cents).toBe(6700);
    expect(res.body.fee_computation).toEqual({
      total_cents: 6700,
      fee_bps: 75,
      exact: '50.25',
      rounding: 'half-up',
      fee_cents: 50,
    });
    expect(res.body.payment.idempotency_key).toBe(KEY);
    expect(res.body.items).toHaveLength(2);
  });

  it('ledger of an unpaid order → 409 order_not_paid; other provider → 404', async () => {
    const unpaid = await sentOrder([{ supplement_id: 3, quantity: 1, unit_price_cents: 1900 }]);
    const res = await api(ctx.app, 'GET', `/api/orders/${unpaid.id}/ledger`, { provider: WELBY });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('order_not_paid');
    const other = await api(ctx.app, 'GET', `/api/orders/${order.id}/ledger`, {
      provider: ANDERSON,
    });
    expect(other.status).toBe(404);
  });

  it('an idempotency key cannot be reused for a different order', async () => {
    const another = await sentOrder([{ supplement_id: 4, quantity: 1, unit_price_cents: 4500 }]);
    const res = await api(ctx.app, 'POST', `/api/checkout/${another.token}/pay`, {
      body: { idempotency_key: KEY },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
    const [row] = await ctx.sql<
      { status: string }[]
    >`SELECT status FROM orders WHERE id = ${another.id}`;
    expect(row!.status).toBe('awaiting_payment'); // nothing half-written
  });
});

describe('adversarial totals (spec US2 scenario 4, SC-001)', () => {
  it.each([
    ['one-cent order → fee 0', [{ supplement_id: 2, quantity: 1, unit_price_cents: 1 }], 1, 0],
    [
      'exact half-cent fee rounds up: 200¢ → 2¢',
      [{ supplement_id: 2, quantity: 1, unit_price_cents: 200 }],
      200,
      2,
    ],
    ['$1.34 → 1.005¢ → 1¢', [{ supplement_id: 2, quantity: 1, unit_price_cents: 134 }], 134, 1],
    [
      'multi-item, below-COGS line (negative margin)',
      [
        { supplement_id: 5, quantity: 3, unit_price_cents: 1000 },
        { supplement_id: 2, quantity: 1, unit_price_cents: 850 },
      ],
      3850,
      29,
    ],
  ])('%s', async (_label, items, total, fee) => {
    const o = await sentOrder(items);
    expect(o.total).toBe(total);
    const res = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `ck_adv_${o.id}_xxxxxxxx` },
    });
    expect(res.status).toBe(200);
    const ledger = await api(ctx.app, 'GET', `/api/orders/${o.id}/ledger`, { provider: WELBY });
    expect(ledger.body.sum_cents).toBe(total);
    expect(ledger.body.fee_computation.fee_cents).toBe(fee);
  });
});

describe('the database, not the app, is the last line of defence (quickstart scenario 3)', () => {
  let paidId: number;
  let paymentId: number;

  beforeAll(async () => {
    const o = await sentOrder([{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]);
    const res = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `ck_db_${o.id}_xxxxxxxx` },
    });
    paidId = o.id;
    paymentId = res.body.payment.id;
  });

  it('UPDATE / DELETE / TRUNCATE on ledger_entries are rejected (CB001)', async () => {
    expect(
      await sqlCode(
        () => ctx.sql`UPDATE ledger_entries SET amount_cents = 0 WHERE order_id = ${paidId}`,
      ),
    ).toBe('CB001');
    expect(
      await sqlCode(() => ctx.sql`DELETE FROM ledger_entries WHERE order_id = ${paidId}`),
    ).toBe('CB001');
    expect(await sqlCode(() => ctx.sql`TRUNCATE ledger_entries`)).toBe('CB001');
  });

  it('a 4th ledger entry on a paid order is rejected', async () => {
    const code = await sqlCode(
      () =>
        ctx.sql`INSERT INTO ledger_entries (order_id, payment_id, entry_type, amount_cents) VALUES (${paidId}, ${paymentId}, 'platform_fee', 0)`,
    );
    expect(code).toBe('23505'); // UNIQUE (order_id, entry_type); the deferred trigger would catch a novel type too
  });

  it('TRUNCATE on order_items / orders / payments is refused (HDX-87)', async () => {
    expect(await sqlCode(() => ctx.sql`TRUNCATE order_items`)).toBe('CB003');
    expect(await sqlCode(() => ctx.sql`TRUNCATE orders CASCADE`)).toBe('CB003');
    expect(await sqlCode(() => ctx.sql`TRUNCATE payments CASCADE`)).toBe('CB003');
    const [row] = await ctx.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM order_items WHERE order_id = ${paidId}`;
    expect(row!.n).toBe(1); // the paid order's lines are still there
  });

  it('a paid order and its items are immutable (CB003)', async () => {
    expect(
      await sqlCode(() => ctx.sql`UPDATE orders SET total_cents = 1 WHERE id = ${paidId}`),
    ).toBe('CB003');
    expect(
      await sqlCode(() => ctx.sql`UPDATE orders SET status = 'draft' WHERE id = ${paidId}`),
    ).toBe('CB003');
    expect(await sqlCode(() => ctx.sql`DELETE FROM order_items WHERE order_id = ${paidId}`)).toBe(
      'CB003',
    );
    expect(await sqlCode(() => ctx.sql`DELETE FROM orders WHERE id = ${paidId}`)).toBe('CB003');
  });

  it('a hand-rolled transaction with a mismatched sum is rolled back at COMMIT (CB002)', async () => {
    const o = await sentOrder([{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]); // total 3200, cogs 1850, fee 24, margin 1326
    const code = await sqlCode(() =>
      ctx.sql.begin(async (tx) => {
        const [p] = await tx<
          { id: number }[]
        >`INSERT INTO payments (order_id, idempotency_key, amount_cents) VALUES (${o.id}, ${'ck_bad_sum_' + o.id}, 3200) RETURNING id`;
        await tx`UPDATE orders SET status = 'paid' WHERE id = ${o.id}`;
        await tx`INSERT INTO ledger_entries (order_id, payment_id, entry_type, amount_cents) VALUES
          (${o.id}, ${p!.id}, 'cogs', 1850), (${o.id}, ${p!.id}, 'provider_margin', 1327), (${o.id}, ${p!.id}, 'platform_fee', 24)`;
      }),
    );
    expect(code).toBe('CB002');
    const [row] = await ctx.sql<{ status: string; n: number }[]>`
      SELECT status, (SELECT count(*)::int FROM ledger_entries WHERE order_id = ${o.id}) AS n FROM orders WHERE id = ${o.id}`;
    expect(row).toEqual({ status: 'awaiting_payment', n: 0 }); // nothing persisted
  });

  it('sum right but fee policy wrong → still rejected (CB002)', async () => {
    const o = await sentOrder([{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]);
    const code = await sqlCode(() =>
      ctx.sql.begin(async (tx) => {
        const [p] = await tx<
          { id: number }[]
        >`INSERT INTO payments (order_id, idempotency_key, amount_cents) VALUES (${o.id}, ${'ck_bad_fee_' + o.id}, 3200) RETURNING id`;
        await tx`UPDATE orders SET status = 'paid' WHERE id = ${o.id}`;
        await tx`INSERT INTO ledger_entries (order_id, payment_id, entry_type, amount_cents) VALUES
          (${o.id}, ${p!.id}, 'cogs', 1850), (${o.id}, ${p!.id}, 'provider_margin', 1325), (${o.id}, ${p!.id}, 'platform_fee', 25)`;
      }),
    );
    expect(code).toBe('CB002');
  });

  it('marking an order paid without a payment/ledger is rejected (CB002)', async () => {
    const o = await sentOrder([{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]);
    expect(await sqlCode(() => ctx.sql`UPDATE orders SET status = 'paid' WHERE id = ${o.id}`)).toBe(
      'CB002',
    );
  });

  it('payment amount ≠ frozen total is rejected (CB002)', async () => {
    const o = await sentOrder([{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]);
    const code = await sqlCode(() =>
      ctx.sql.begin(async (tx) => {
        const [p] = await tx<
          { id: number }[]
        >`INSERT INTO payments (order_id, idempotency_key, amount_cents) VALUES (${o.id}, ${'ck_bad_amt_' + o.id}, 3199) RETURNING id`;
        await tx`UPDATE orders SET status = 'paid' WHERE id = ${o.id}`;
        await tx`INSERT INTO ledger_entries (order_id, payment_id, entry_type, amount_cents) VALUES
          (${o.id}, ${p!.id}, 'cogs', 1850), (${o.id}, ${p!.id}, 'provider_margin', 1326), (${o.id}, ${p!.id}, 'platform_fee', 24)`;
      }),
    );
    expect(code).toBe('CB002');
  });
});

describe('payment gateway seam failures (HDX-88)', () => {
  it('a decline → 402 payment_declined; nothing written, order still payable, one gateway call', async () => {
    const o = await sentOrder([{ supplement_id: 6, quantity: 2, unit_price_cents: 2400 }]);
    ctx.gateway.calls = [];
    ctx.gateway.mode = 'decline';
    const res = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `gw_decl_${o.id}_xxxxxx` },
    });
    ctx.gateway.mode = 'succeed';
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('payment_declined');
    expect(ctx.gateway.calls).toHaveLength(1);
    expect(ctx.gateway.calls[0]).toMatchObject({ orderId: o.id, amountCents: 4800 });
    const [row] = await ctx.sql<{ status: string; payments: number; entries: number }[]>`
      SELECT status, (SELECT count(*)::int FROM payments WHERE order_id = ${o.id}) AS payments,
             (SELECT count(*)::int FROM ledger_entries WHERE order_id = ${o.id}) AS entries
      FROM orders WHERE id = ${o.id}`;
    expect(row).toEqual({ status: 'awaiting_payment', payments: 0, entries: 0 });

    // Retrying after the decline (same key) charges again and succeeds.
    const retry = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `gw_decl_${o.id}_xxxxxx` },
    });
    expect(retry.status).toBe(200);
    expect(ctx.gateway.calls).toHaveLength(2);
  });

  it('a gateway outage → 502 payment_gateway_error; nothing written', async () => {
    const o = await sentOrder([{ supplement_id: 6, quantity: 1, unit_price_cents: 2400 }]);
    ctx.gateway.mode = 'outage';
    const res = await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
      body: { idempotency_key: `gw_out_${o.id}_xxxxxxx` },
    });
    ctx.gateway.mode = 'succeed';
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('payment_gateway_error');
    expect(await ctx.sql`SELECT id FROM payments WHERE order_id = ${o.id}`).toHaveLength(0);
  });

  it('replay (same key) and conflicting key (different) make ZERO additional gateway calls', async () => {
    const o = await sentOrder([{ supplement_id: 6, quantity: 1, unit_price_cents: 2400 }]);
    const key = `gw_once_${o.id}_xxxxxx`;
    ctx.gateway.calls = [];
    expect(
      (
        await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
          body: { idempotency_key: key },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
          body: { idempotency_key: key },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
          body: { idempotency_key: key + 'b' },
        })
      ).status,
    ).toBe(409);
    expect(ctx.gateway.calls).toHaveLength(1); // the fake "charged" exactly once
  });
});

describe('concurrency', () => {
  it('5 simultaneous pays with the same key → all 200, one payment row, one charge', async () => {
    const o = await sentOrder([{ supplement_id: 6, quantity: 1, unit_price_cents: 2400 }]);
    const key = `ck_race_same_${o.id}_xx`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, { body: { idempotency_key: key } }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.payment.id)).size).toBe(1);
    const rows = await ctx.sql`SELECT id FROM payments WHERE order_id = ${o.id}`;
    expect(rows).toHaveLength(1);
    expect(ctx.gateway.calls.filter((c) => c.orderId === o.id)).toHaveLength(1); // charged once
  });

  it('5 simultaneous pays with different keys → exactly one 200, the rest 409 already_paid', async () => {
    const o = await sentOrder([{ supplement_id: 6, quantity: 1, unit_price_cents: 2400 }]);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api(ctx.app, 'POST', `/api/checkout/${o.token}/pay`, {
          body: { idempotency_key: `ck_race_diff_${o.id}_${i}` },
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'already_paid'),
    ).toBe(true);
    const [counts] = await ctx.sql<{ payments: number; entries: number }[]>`
      SELECT (SELECT count(*)::int FROM payments WHERE order_id = ${o.id}) AS payments,
             (SELECT count(*)::int FROM ledger_entries WHERE order_id = ${o.id}) AS entries`;
    expect(counts).toEqual({ payments: 1, entries: 3 });
    expect(ctx.gateway.calls.filter((c) => c.orderId === o.id)).toHaveLength(1); // losers never reach the gateway
  });
});
