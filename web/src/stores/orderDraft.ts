// Order draft store: the provider's working order. Lines are edited locally for an instant
// preview (money.ts mirror), then persisted with PUT /items; the server's response (with the
// authoritative split + memos) is the snapshot of record. Sending locks the order.
//
// Consistency model (HDX-84): every local edit bumps `revision`. Saves are serialised through a
// promise chain and each save captures the revision it is persisting; on success only that
// revision is marked saved, so edits made while a PUT was in flight stay dirty and trigger the
// next save. `send()` flushes until savedRevision === revision before freezing the order.
// Responses for a different order (user switched/reset mid-request) are ignored.
//
// Validity (HDX-85): a line can carry `price_valid: false` while its input holds unparseable
// text. Invalid lines are never dropped or substituted — autosave simply waits, and Send is
// blocked (`canSend`) until every line is valid again.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, ApiError } from '../api';
import { previewSplit } from '../money';
import type { OrderLineInput, OrderView, Supplement } from '../types';

export interface DraftLine extends OrderLineInput {
  name: string;
  sku: string | null;
  unit_cogs_cents: number; // catalog COGS at the time the line was added (server re-snapshots)
  /** false while the price field holds text that does not parse to integer cents */
  price_valid: boolean;
}

export const useOrderDraftStore = defineStore('orderDraft', () => {
  const order = ref<OrderView | null>(null);
  const lines = ref<DraftLine[]>([]);
  const saving = ref(false);
  const sending = ref(false);
  const error = ref<string | null>(null);

  const revision = ref(0);
  const savedRevision = ref(0);
  const dirty = computed(() => revision.value !== savedRevision.value);

  const locked = computed(() => order.value !== null && order.value.status !== 'draft');
  const invalidLineCount = computed(() => lines.value.filter((l) => !l.price_valid).length);
  const allValid = computed(() => invalidLineCount.value === 0);
  const canSend = computed(
    () =>
      order.value !== null &&
      !locked.value &&
      lines.value.length > 0 &&
      allValid.value &&
      !sending.value,
  );

  /** Instant local preview; the server's `order.split` is authoritative once saved. */
  const preview = computed(() => previewSplit(lines.value));

  function hydrate(view: OrderView): void {
    order.value = view;
    lines.value = view.items.map((i) => ({
      supplement_id: i.supplement_id,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      name: i.name,
      sku: i.sku,
      unit_cogs_cents: i.unit_cogs_cents,
      price_valid: true,
      ...(i.sig ? { sig: i.sig } : {}),
    }));
    savedRevision.value = revision.value;
  }

  function reset(): void {
    order.value = null;
    lines.value = [];
    error.value = null;
    revision.value += 1; // any in-flight response now belongs to a stale revision/order
    savedRevision.value = revision.value;
  }

  async function start(patientId: number): Promise<OrderView> {
    error.value = null;
    const view = await api.createOrder(patientId);
    revision.value += 1;
    hydrate(view);
    return view;
  }

  async function load(orderId: number): Promise<OrderView> {
    error.value = null;
    const view = await api.getOrder(orderId);
    revision.value += 1;
    hydrate(view);
    return view;
  }

  function touch(): void {
    revision.value += 1;
  }

  function addLine(s: Supplement): void {
    if (locked.value) return;
    const existing = lines.value.find((l) => l.supplement_id === s.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      lines.value.push({
        supplement_id: s.id,
        quantity: 1,
        unit_price_cents: s.default_price_cents, // pre-fill (DECISIONS #6); overridable per line
        name: s.name,
        sku: s.sku,
        unit_cogs_cents: s.unit_cogs_cents,
        price_valid: true,
      });
    }
    touch();
  }

  function removeLine(supplementId: number): void {
    if (locked.value) return;
    lines.value = lines.value.filter((l) => l.supplement_id !== supplementId);
    touch();
  }

  function setPrice(supplementId: number, cents: number): void {
    const line = lines.value.find((l) => l.supplement_id === supplementId);
    if (!line || locked.value) return;
    line.unit_price_cents = cents;
    line.price_valid = true;
    touch();
  }

  function setPriceValidity(supplementId: number, valid: boolean): void {
    const line = lines.value.find((l) => l.supplement_id === supplementId);
    if (!line || line.price_valid === valid) return;
    line.price_valid = valid;
    touch();
  }

  /** Patient directions for a line; empty/whitespace clears it. */
  function setSig(supplementId: number, sig: string): void {
    const line = lines.value.find((l) => l.supplement_id === supplementId);
    if (!line || locked.value) return;
    const t = sig.trim();
    if ((line.sig ?? '') === t) return;
    if (t) line.sig = t;
    else delete line.sig;
    touch();
  }

  function setQuantity(supplementId: number, quantity: number): void {
    const line = lines.value.find((l) => l.supplement_id === supplementId);
    if (!line || locked.value) return;
    line.quantity = quantity;
    touch();
  }

  // ── Serialised persistence ───────────────────────────────────────────────────────────────
  let chain: Promise<void> = Promise.resolve();

  async function persistOnce(): Promise<void> {
    if (!order.value || locked.value || !dirty.value) return;
    if (!allValid.value) return; // wait for the user to fix the field; never drop or substitute
    const orderId = order.value.id;
    const rev = revision.value;
    saving.value = true;
    error.value = null;
    try {
      const payload = lines.value.map(({ supplement_id, quantity, unit_price_cents, sig }) => ({
        supplement_id,
        quantity,
        unit_price_cents,
        ...(sig ? { sig } : {}), // omitted when empty so the wire shape is unchanged for plain lines
      }));
      const view = await api.putItems(orderId, payload);
      if (order.value?.id !== orderId) return; // user switched orders; stale response
      if (revision.value === rev) {
        hydrate(view); // nothing changed meanwhile → take the server snapshot wholesale
      } else {
        order.value = view; // keep newer local edits; they are still dirty and will save next
        savedRevision.value = Math.max(savedRevision.value, rev);
      }
    } catch (err) {
      if (order.value?.id !== orderId) return;
      error.value = describe(err);
      if (err instanceof ApiError && err.code === 'order_locked') await load(orderId);
    } finally {
      saving.value = false;
    }
  }

  /** Persist the current lines. Calls are serialised; a call made during a save runs after it. */
  function save(): Promise<void> {
    chain = chain.then(persistOnce, persistOnce);
    return chain;
  }

  /** Keep saving until nothing is dirty (or an error / invalid line stops progress). */
  async function flush(): Promise<void> {
    for (let i = 0; i < 10 && dirty.value && allValid.value && !error.value; i++) {
      await save();
    }
  }

  async function send(): Promise<OrderView | null> {
    if (!order.value || !canSend.value) return null;
    const orderId = order.value.id;
    sending.value = true;
    error.value = null;
    try {
      await flush();
      if (error.value) return null;
      if (dirty.value) {
        error.value =
          'Unsaved changes could not be persisted; fix the highlighted fields and retry';
        return null;
      }
      const view = await api.sendOrder(orderId);
      if (order.value?.id !== orderId) return null;
      revision.value += 1;
      hydrate(view);
      return view;
    } catch (err) {
      error.value = describe(err);
      return null;
    } finally {
      sending.value = false;
    }
  }

  return {
    order,
    lines,
    saving,
    sending,
    error,
    dirty,
    locked,
    allValid,
    invalidLineCount,
    canSend,
    preview,
    revision,
    savedRevision,
    start,
    load,
    reset,
    addLine,
    removeLine,
    setPrice,
    setPriceValidity,
    setSig,
    setQuantity,
    touch,
    save,
    flush,
    send,
  };
});

function describe(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code})`;
  return (err as Error).message ?? String(err);
}
