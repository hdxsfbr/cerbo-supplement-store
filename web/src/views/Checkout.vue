<script setup lang="ts">
// Patient checkout (T020) — the patient-portal surface (constitution VI). Loads the order via its
// capability token, lets the patient pay once, and renders a receipt instead of a Pay button once
// the order is paid (spec.md Edge Cases: already-paid orders show a receipt, not a Pay button).
import '../styles/portal.css';
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import { formatCents } from '../money';
import type { CheckoutView } from '../types';

const props = defineProps<{ token: string }>();

const loading = ref(true);
const paying = ref(false);
const errorMessage = ref<string | null>(null);
const order = ref<CheckoutView | null>(null);

const isPaid = computed(() => order.value?.paid === true);
const isDraft = computed(() => order.value?.status === 'draft');

function idempotencyKeyStorageKey(token: string): string {
  return `cerbo-store.pay-key.${token}`;
}

// Generated once per checkout token and persisted in sessionStorage so a refresh or a
// double-click re-sends the SAME key — that is what makes the server-side replay handling safe
// (contracts/api.md: "Replays return the original result, 200").
function getOrCreateIdempotencyKey(token: string): string {
  const storageKey = idempotencyKeyStorageKey(token);
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const fresh = newIdempotencyKey();
  sessionStorage.setItem(storageKey, fresh);
  return fresh;
}

// crypto.randomUUID only exists in secure contexts (https or localhost); a demo served over
// plain http on a LAN/Tailscale address needs the getRandomValues fallback.
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function clearIdempotencyKey(token: string): void {
  sessionStorage.removeItem(idempotencyKeyStorageKey(token));
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function loadOrder(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    order.value = await api.checkout(props.token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      errorMessage.value = 'This payment link is not valid.';
    } else {
      errorMessage.value = err instanceof Error ? err.message : 'Something went wrong.';
    }
  } finally {
    loading.value = false;
  }
}

async function pay(): Promise<void> {
  if (!order.value || paying.value) return;
  paying.value = true;
  errorMessage.value = null;
  const key = getOrCreateIdempotencyKey(props.token);
  try {
    const result = await api.pay(props.token, key);
    order.value = result;
    clearIdempotencyKey(props.token);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_paid') {
      // Someone else (or an earlier attempt with a different key) already paid this order —
      // reload the receipt rather than treating this as a failure.
      await loadOrder();
      clearIdempotencyKey(props.token);
    } else {
      errorMessage.value = err instanceof Error ? err.message : 'Payment failed. Please try again.';
    }
  } finally {
    paying.value = false;
  }
}

onMounted(loadOrder);
</script>

<template>
  <div class="portal-card">
    <template v-if="loading">
      <p class="portal-muted">Loading your order…</p>
    </template>

    <template v-else-if="errorMessage && !order">
      <div class="portal-header">
        <p class="portal-header__practice">Cerbo</p>
        <h1 class="portal-header__title">Supplement order</h1>
      </div>
      <p class="portal-status portal-status--error">{{ errorMessage }}</p>
    </template>

    <template v-else-if="order">
      <div class="portal-header">
        <p class="portal-header__practice">{{ order.provider.name }}</p>
        <h1 class="portal-header__title">Supplement order</h1>
        <p class="portal-meta">For {{ order.patient.name }} &middot; Order #{{ order.id }}</p>
      </div>

      <p v-if="errorMessage" class="portal-status portal-status--error">{{ errorMessage }}</p>

      <p v-if="isPaid" class="portal-status portal-status--paid">Paid — thank you</p>
      <p v-else-if="isDraft" class="portal-status portal-status--info">
        This order isn't ready for payment yet.
      </p>

      <table class="portal-items">
        <thead>
          <tr>
            <th>Item</th>
            <th class="portal-items__num">Qty</th>
            <th class="portal-items__num">Unit price</th>
            <th class="portal-items__num">Line total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in order.items" :key="item.name + item.sku">
            <td>
              <div class="portal-items__name">{{ item.name }}</div>
              <div v-if="item.sku" class="portal-items__sku">{{ item.sku }}</div>
            </td>
            <td class="portal-items__num">{{ item.quantity }}</td>
            <td class="portal-items__num">{{ formatCents(item.unit_price_cents) }}</td>
            <td class="portal-items__num">{{ formatCents(item.line_total_cents) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="portal-total">
        <span>Total</span>
        <span class="portal-total__amount">{{ formatCents(order.total_cents) }}</span>
      </div>

      <div v-if="isPaid && order.payment" class="portal-receipt">
        <dl>
          <dt>Paid</dt>
          <dd>{{ formatDate(order.paid_at) }}</dd>
          <dt>Amount</dt>
          <dd>{{ formatCents(order.payment.amount_cents) }}</dd>
          <dt>Reference</dt>
          <dd>{{ order.payment.gateway_ref ?? order.payment.idempotency_key }}</dd>
        </dl>
      </div>

      <button
        v-else-if="!isDraft"
        type="button"
        class="portal-btn portal-btn--primary"
        :disabled="paying"
        @click="pay"
      >
        {{ paying ? 'Processing…' : `Pay ${formatCents(order.total_cents)}` }}
      </button>

      <p class="portal-footer">Payment is simulated in this demo (no card is charged).</p>
    </template>
  </div>
</template>
