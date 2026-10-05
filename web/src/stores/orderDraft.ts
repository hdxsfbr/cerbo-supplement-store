// Order draft store: the provider's working order. Lines are edited locally for an instant
// preview (money.ts mirror), then persisted with PUT /items; the server's response (with the
// authoritative split + memos) replaces the local view. Sending locks the order.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, ApiError } from '../api';
import { previewSplit } from '../money';
import type { OrderLineInput, OrderView, Supplement } from '../types';

export interface DraftLine extends OrderLineInput {
  name: string;
  sku: string | null;
  unit_cogs_cents: number; // catalog COGS at the time the line was added (server re-snapshots)
}

export const useOrderDraftStore = defineStore('orderDraft', () => {
  const order = ref<OrderView | null>(null);
  const lines = ref<DraftLine[]>([]);
  const saving = ref(false);
  const sending = ref(false);
  const error = ref<string | null>(null);
  const dirty = ref(false);

  const locked = computed(() => order.value !== null && order.value.status !== 'draft');

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
    }));
    dirty.value = false;
  }

  function reset(): void {
    order.value = null;
    lines.value = [];
    error.value = null;
    dirty.value = false;
  }

  async function start(patientId: number): Promise<OrderView> {
    error.value = null;
    const view = await api.createOrder(patientId);
    hydrate(view);
    return view;
  }

  async function load(orderId: number): Promise<OrderView> {
    error.value = null;
    const view = await api.getOrder(orderId);
    hydrate(view);
    return view;
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
      });
    }
    dirty.value = true;
  }

  function removeLine(supplementId: number): void {
    if (locked.value) return;
    lines.value = lines.value.filter((l) => l.supplement_id !== supplementId);
    dirty.value = true;
  }

  function touch(): void {
    dirty.value = true;
  }

  /** Persist the lines. Safe to call repeatedly; the last call wins. */
  async function save(): Promise<void> {
    if (!order.value || locked.value || !dirty.value) return;
    saving.value = true;
    error.value = null;
    try {
      const payload = lines.value
        .filter(
          (l) => l.quantity > 0 && Number.isInteger(l.unit_price_cents) && l.unit_price_cents >= 0,
        )
        .map(({ supplement_id, quantity, unit_price_cents }) => ({
          supplement_id,
          quantity,
          unit_price_cents,
        }));
      const view = await api.putItems(order.value.id, payload);
      // Keep local edits made while the request was in flight.
      if (!dirty.value) hydrate(view);
      else order.value = view;
      dirty.value = false;
    } catch (err) {
      error.value = describe(err);
      if (err instanceof ApiError && err.code === 'order_locked' && order.value) {
        await load(order.value.id);
      }
    } finally {
      saving.value = false;
    }
  }

  async function send(): Promise<OrderView | null> {
    if (!order.value) return null;
    sending.value = true;
    error.value = null;
    try {
      if (dirty.value) {
        dirty.value = true;
        await save();
        if (error.value) return null;
      }
      const view = await api.sendOrder(order.value.id);
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
    preview,
    start,
    load,
    reset,
    addLine,
    removeLine,
    touch,
    save,
    send,
  };
});

function describe(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code})`;
  return (err as Error).message ?? String(err);
}
