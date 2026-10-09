<script setup lang="ts">
// Patient checkout (T020, HDX-97) — the patient-portal surface (constitution VI). Loads the order
// via its capability token, takes card details through a fake tokenizer (the number never leaves
// the browser), pays once, and shows a receipt afterwards.
import '../styles/portal.css';
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import {
  TEST_CARDS,
  brandLabel,
  cardNumberValid,
  cvcValid,
  detectBrand,
  expiryValid,
  formatCardNumber,
  formatExpiry,
  tokenize,
  zipValid,
} from '../card';
import { formatCents } from '../money';
import { useLoginStore } from '../stores/login';
import type { CheckoutView } from '../types';

const props = defineProps<{ token: string }>();

const loading = ref(true);
const paying = ref(false);
const errorMessage = ref<string | null>(null);
const order = ref<CheckoutView | null>(null);

const isPaid = computed(() => order.value?.paid === true);
const isDraft = computed(() => order.value?.status === 'draft');
// A patient signed in through the demo login came from the Cerbo-style portal; send them back there.
const login = useLoginStore();
const portalPath = computed(() =>
  login.isPatient
    ? '/experimental-portal'
    : (order.value?.portal_url.replace(/^https?:\/\/[^/]+/, '') ?? null),
);

// ── Card form ────────────────────────────────────────────────────────────────────────────
const name = ref('');
const number = ref('');
const expiry = ref('');
const cvc = ref('');
const zip = ref('');
const touched = ref<Record<string, boolean>>({});

const brand = computed(() => detectBrand(number.value));
const errors = computed(() => ({
  name: name.value.trim().length >= 2 ? null : 'Name as it appears on the card',
  number: cardNumberValid(number.value) ? null : 'Enter a valid card number',
  expiry: expiryValid(expiry.value) ? null : 'MM/YY, not expired',
  cvc: cvcValid(cvc.value, brand.value) ? null : brand.value === 'amex' ? '4 digits' : '3 digits',
  zip: zipValid(zip.value) ? null : '5-digit ZIP',
}));
const formValid = computed(() => Object.values(errors.value).every((e) => e === null));
const show = (field: string) =>
  touched.value[field] && errors.value[field as keyof typeof errors.value];

function onNumber(e: Event): void {
  number.value = formatCardNumber((e.target as HTMLInputElement).value);
}
function onExpiry(e: Event): void {
  expiry.value = formatExpiry((e.target as HTMLInputElement).value);
}
function onCvc(e: Event): void {
  cvc.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
}
function useTestCard(n: string): void {
  number.value = n;
  if (!name.value) name.value = order.value?.patient.name ?? '';
  if (!expiry.value) expiry.value = '12/29';
  if (!cvc.value) cvc.value = '123';
  if (!zip.value) zip.value = '94105';
}

// ── Idempotency key: once per token, kept across refresh/double-click ──────────────────
function storageKey(token: string): string {
  return `cerbo-store.pay-key.${token}`;
}
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function getOrCreateIdempotencyKey(token: string): string {
  const existing = sessionStorage.getItem(storageKey(token));
  if (existing) return existing;
  const fresh = newIdempotencyKey();
  sessionStorage.setItem(storageKey(token), fresh);
  return fresh;
}

async function loadOrder(): Promise<void> {
  loading.value = true;
  errorMessage.value = null;
  try {
    order.value = await api.checkout(props.token);
  } catch (err) {
    errorMessage.value =
      err instanceof ApiError && err.status === 404
        ? 'This payment link is not valid.'
        : err instanceof Error
          ? err.message
          : 'Something went wrong.';
  } finally {
    loading.value = false;
  }
}

async function pay(): Promise<void> {
  touched.value = { name: true, number: true, expiry: true, cvc: true, zip: true };
  if (!order.value || paying.value || !formValid.value) return;
  paying.value = true;
  errorMessage.value = null;
  const key = getOrCreateIdempotencyKey(props.token);
  try {
    order.value = await api.pay(props.token, key, tokenize(number.value));
    sessionStorage.removeItem(storageKey(props.token));
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_paid') {
      await loadOrder();
      sessionStorage.removeItem(storageKey(props.token));
    } else if (err instanceof ApiError && err.code === 'payment_declined') {
      errorMessage.value = 'Your card was declined. Please try a different card.';
    } else if (err instanceof ApiError && err.code === 'payment_gateway_error') {
      errorMessage.value = 'We could not reach the payment provider. Please try again in a moment.';
    } else {
      errorMessage.value = err instanceof Error ? err.message : 'Payment failed. Please try again.';
    }
  } finally {
    paying.value = false;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

onMounted(loadOrder);
</script>

<template>
  <div class="portal-card">
    <RouterLink v-if="portalPath" :to="portalPath" class="portal-link portal-back"
      >← Back to portal</RouterLink
    >

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
        <p class="portal-meta">For {{ order.patient.name }} · Order #{{ order.id }}</p>
      </div>

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
              <div v-if="item.sig" class="portal-items__sku">{{ item.sig }}</div>
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
          <dt v-if="order.payment.card_last4">Card</dt>
          <dd v-if="order.payment.card_last4">
            {{ brandLabel(order.payment.card_brand) }} ending {{ order.payment.card_last4 }}
          </dd>
          <dt>Reference</dt>
          <dd>{{ order.payment.gateway_ref ?? order.payment.idempotency_key }}</dd>
        </dl>
      </div>

      <form v-else-if="!isDraft" class="portal-form" novalidate @submit.prevent="pay">
        <p class="portal-form__title">Pay with card</p>
        <p v-if="errorMessage" class="portal-status portal-status--error">{{ errorMessage }}</p>

        <div class="portal-field">
          <label for="cc-name">Name on card</label>
          <input
            id="cc-name"
            v-model="name"
            autocomplete="cc-name"
            :aria-invalid="!!show('name')"
            @blur="touched.name = true"
          />
          <span v-if="show('name')" class="portal-field__error">{{ errors.name }}</span>
        </div>

        <div class="portal-field">
          <label for="cc-number">Card number</label>
          <input
            id="cc-number"
            :value="number"
            inputmode="numeric"
            autocomplete="cc-number"
            placeholder="1234 5678 9012 3456"
            :aria-invalid="!!show('number')"
            @input="onNumber"
            @blur="touched.number = true"
          />
          <span v-if="show('number')" class="portal-field__error">{{ errors.number }}</span>
          <span v-else-if="brand !== 'unknown'" class="portal-card-brand">{{
            brandLabel(brand)
          }}</span>
        </div>

        <div class="portal-row">
          <div class="portal-field">
            <label for="cc-exp">Expiry</label>
            <input
              id="cc-exp"
              :value="expiry"
              inputmode="numeric"
              autocomplete="cc-exp"
              placeholder="MM/YY"
              :aria-invalid="!!show('expiry')"
              @input="onExpiry"
              @blur="touched.expiry = true"
            />
            <span v-if="show('expiry')" class="portal-field__error">{{ errors.expiry }}</span>
          </div>
          <div class="portal-field">
            <label for="cc-cvc">CVC</label>
            <input
              id="cc-cvc"
              :value="cvc"
              inputmode="numeric"
              autocomplete="cc-csc"
              placeholder="123"
              :aria-invalid="!!show('cvc')"
              @input="onCvc"
              @blur="touched.cvc = true"
            />
            <span v-if="show('cvc')" class="portal-field__error">{{ errors.cvc }}</span>
          </div>
          <div class="portal-field">
            <label for="cc-zip">ZIP</label>
            <input
              id="cc-zip"
              v-model="zip"
              inputmode="numeric"
              autocomplete="postal-code"
              placeholder="94105"
              :aria-invalid="!!show('zip')"
              @blur="touched.zip = true"
            />
            <span v-if="show('zip')" class="portal-field__error">{{ errors.zip }}</span>
          </div>
        </div>

        <button type="submit" class="portal-btn portal-btn--primary" :disabled="paying">
          {{ paying ? 'Processing…' : `Pay ${formatCents(order.total_cents)}` }}
        </button>
        <p class="portal-secure">
          🔒 Your card details are encrypted and never stored by the practice.
        </p>

        <p class="portal-testcards">
          Test cards:
          <button
            v-for="c in TEST_CARDS"
            :key="c.number"
            type="button"
            @click="useTestCard(c.number)"
          >
            {{ c.number }} ({{ c.label }})
          </button>
        </p>
      </form>

      <p class="portal-footer">Payment is simulated in this demo (no card is charged).</p>
    </template>
  </div>
</template>
