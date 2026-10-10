// Deterministic tests for the autosave consistency model (HDX-84, HDX-85) against the real
// Pinia store with a mocked API whose responses we release by hand.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { OrderView, Supplement } from '../src/types';

const putItems = vi.fn();
const sendOrder = vi.fn();
const createOrder = vi.fn();
const getOrder = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    putItems: (...a: unknown[]) => putItems(...a),
    sendOrder: (...a: unknown[]) => sendOrder(...a),
    createOrder: (...a: unknown[]) => createOrder(...a),
    getOrder: (...a: unknown[]) => getOrder(...a),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { useOrderDraftStore } from '../src/stores/orderDraft';

const omega: Supplement = {
  id: 1,
  name: 'Omega-3',
  sku: 'OMG',
  unit_cogs_cents: 1850,
  default_price_cents: 3200,
};

function view(
  id: number,
  items: { supplement_id: number; quantity: number; unit_price_cents: number }[],
  status: OrderView['status'] = 'draft',
): OrderView {
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0);
  return {
    id,
    status,
    provider: { id: 1, name: 'Dr' },
    patient: { id: 1, name: 'Zeus', email: null },
    items: items.map((i, n) => ({
      id: n + 1,
      ...i,
      name: 'Omega-3',
      sku: 'OMG',
      unit_cogs_cents: 1850,
      line_total_cents: i.quantity * i.unit_price_cents,
      line_cogs_cents: i.quantity * 1850,
      below_cogs: i.unit_price_cents < 1850,
    })),
    total_cents: total,
    split: {
      total_cents: total,
      cogs_cents: 0,
      fee_cents: 0,
      margin_cents: 0,
      fee_bps: 75,
      memos: { cogs: '', provider_margin: '', platform_fee: '' },
    },
    checkout_url: status === 'draft' ? null : 'http://x/pay/t',
    sent_at: null,
    paid_at: null,
    created_at: '',
  };
}

/** A promise we can resolve from the outside. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setActivePinia(createPinia());
  putItems.mockReset();
  sendOrder.mockReset();
  createOrder.mockReset();
  getOrder.mockReset();
});

describe('autosave revisions (HDX-84)', () => {
  it('an edit made during an in-flight save stays dirty and is persisted by the next save', async () => {
    const store = useOrderDraftStore();
    createOrder.mockResolvedValue(view(7, []));
    await store.start(1);
    store.addLine(omega);
    store.setPrice(1, 100);

    const first = deferred<OrderView>();
    putItems.mockReturnValueOnce(first.promise);
    const save1 = store.save();
    await tick();
    expect(putItems).toHaveBeenCalledTimes(1);
    expect(putItems.mock.calls[0][1]).toEqual([
      { supplement_id: 1, quantity: 1, unit_price_cents: 100 },
    ]);

    store.setPrice(1, 200); // edit while the PUT is in flight
    first.resolve(view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 100 }]));
    await save1;

    expect(store.lines[0]!.unit_price_cents).toBe(200); // local edit preserved
    expect(store.dirty).toBe(true); // and NOT marked saved

    putItems.mockResolvedValueOnce(
      view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 200 }]),
    );
    await store.save();
    expect(putItems).toHaveBeenCalledTimes(2);
    expect(putItems.mock.calls[1][1]).toEqual([
      { supplement_id: 1, quantity: 1, unit_price_cents: 200 },
    ]);
    expect(store.dirty).toBe(false);
  });

  it('overlapping save() calls are serialised, never concurrent', async () => {
    const store = useOrderDraftStore();
    createOrder.mockResolvedValue(view(7, []));
    await store.start(1);
    store.addLine(omega);

    const first = deferred<OrderView>();
    putItems.mockReturnValueOnce(first.promise);
    const a = store.save();
    await tick(); // first PUT is now in flight with price 3200
    store.setPrice(1, 999);
    const b = store.save();
    await tick();
    expect(putItems).toHaveBeenCalledTimes(1); // second save is queued behind the first
    first.resolve(view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]));
    putItems.mockResolvedValueOnce(
      view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 999 }]),
    );
    await Promise.all([a, b]);
    expect(putItems).toHaveBeenCalledTimes(2);
    expect(store.dirty).toBe(false);
    expect(store.order!.items[0]!.unit_price_cents).toBe(999);
  });

  it('send() flushes pending edits before freezing, so checkout carries the last confirmed price', async () => {
    const store = useOrderDraftStore();
    createOrder.mockResolvedValue(view(7, []));
    await store.start(1);
    store.addLine(omega);

    const first = deferred<OrderView>();
    putItems.mockReturnValueOnce(first.promise);
    const save1 = store.save();
    await tick(); // first PUT in flight with price 3200
    store.setPrice(1, 250); // edit during save
    const sendPromise = store.send(); // user clicks Send while the first PUT is in flight
    await tick();
    expect(sendOrder).not.toHaveBeenCalled();

    first.resolve(view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]));
    putItems.mockResolvedValueOnce(
      view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 250 }]),
    );
    sendOrder.mockImplementation(async (id: number) =>
      view(id, [{ supplement_id: 1, quantity: 1, unit_price_cents: 250 }], 'awaiting_payment'),
    );
    await save1;
    const sent = await sendPromise;

    expect(putItems).toHaveBeenCalledTimes(2);
    expect(putItems.mock.calls[1][1]).toEqual([
      { supplement_id: 1, quantity: 1, unit_price_cents: 250 },
    ]);
    expect(sendOrder).toHaveBeenCalledTimes(1);
    expect(sent?.status).toBe('awaiting_payment');
    expect(sent?.items[0]?.unit_price_cents).toBe(250);
    expect(store.locked).toBe(true);
  });

  it('a stale response for a previous order is ignored after switching orders', async () => {
    const store = useOrderDraftStore();
    createOrder.mockResolvedValue(view(7, []));
    await store.start(1);
    store.addLine(omega);
    const first = deferred<OrderView>();
    putItems.mockReturnValueOnce(first.promise);
    const save1 = store.save();
    await tick();

    getOrder.mockResolvedValue(view(8, [{ supplement_id: 1, quantity: 3, unit_price_cents: 111 }]));
    await store.load(8); // user navigates to another order mid-save
    first.resolve(view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]));
    await save1;

    expect(store.order!.id).toBe(8);
    expect(store.lines[0]).toMatchObject({ quantity: 3, unit_price_cents: 111 });
    expect(store.dirty).toBe(false);
  });
});

describe('price validity (HDX-85)', () => {
  it('an invalid price blocks autosave and send without dropping or substituting the line', async () => {
    const store = useOrderDraftStore();
    createOrder.mockResolvedValue(view(7, []));
    await store.start(1);
    store.addLine(omega);
    putItems.mockResolvedValueOnce(
      view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 3200 }]),
    );
    await store.save();
    expect(store.canSend).toBe(true);

    store.setPriceValidity(1, false); // user typed "abc"
    expect(store.canSend).toBe(false);
    expect(store.invalidLineCount).toBe(1);
    await store.save();
    expect(putItems).toHaveBeenCalledTimes(1); // nothing sent while invalid
    expect(store.lines).toHaveLength(1); // line not dropped
    expect(store.lines[0]!.unit_price_cents).toBe(3200); // last valid value untouched
    expect(await store.send()).toBeNull();
    expect(sendOrder).not.toHaveBeenCalled();

    store.setPrice(1, 0); // a valid zero price is allowed
    expect(store.canSend).toBe(true);
    putItems.mockResolvedValueOnce(
      view(7, [{ supplement_id: 1, quantity: 1, unit_price_cents: 0 }]),
    );
    await store.save();
    expect(putItems.mock.calls[1][1]).toEqual([
      { supplement_id: 1, quantity: 1, unit_price_cents: 0 },
    ]);
  });
});
