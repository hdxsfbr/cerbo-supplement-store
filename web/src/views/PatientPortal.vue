<script setup lang="ts">
// Patient portal (HDX-96): the patient-facing surface where Cerbo's secure messages and bills
// live. Opened from the email nudge; shows messages + invoices; "Pay now" goes to checkout.
import '../styles/portal.css';
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import { formatCents } from '../money';
import type { PortalView } from '../types';

const props = defineProps<{ token: string }>();
const data = ref<PortalView | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    data.value = await api.portal(props.token);
  } catch (err) {
    error.value =
      err instanceof ApiError && err.status === 404
        ? 'This portal link is not valid.'
        : (err as Error).message;
  }
});

const firstName = computed(() => data.value?.patient.name.split(' ')[0] ?? '');

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function payPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}
/** Messages backfilled by migration 006 carry no link; use the invoice's checkout URL instead. */
function messageLink(m: { link: string | null; order_id: number | null }): string | null {
  if (m.link) return m.link;
  const inv = data.value?.invoices.find((i) => i.id === m.order_id);
  return inv ? inv.checkout_url : null;
}
</script>

<template>
  <div class="portal-card">
    <div class="portal-header">
      <p class="portal-header__practice">{{ data?.provider.name ?? 'Patient portal' }}</p>
      <h1 class="portal-header__title">
        <template v-if="data">Welcome, {{ firstName }}</template>
        <template v-else>Patient portal</template>
      </h1>
      <p v-if="data" class="portal-meta">{{ data.patient.email ?? '' }}</p>
    </div>

    <p v-if="error" class="portal-status portal-status--error">{{ error }}</p>

    <template v-if="data">
      <div class="portal-balance">
        <span>Balance due</span>
        <span class="portal-balance__amount">{{ formatCents(data.balance_due_cents) }}</span>
      </div>

      <section class="portal-section">
        <h2 class="portal-section__title">Messages</h2>
        <p v-if="data.messages.length === 0" class="portal-muted">No messages yet.</p>
        <article v-for="m in data.messages" :key="m.id" class="portal-message">
          <p class="portal-message__subject">{{ m.subject }}</p>
          <p class="portal-message__meta">{{ data.provider.name }} · {{ fmtDate(m.created_at) }}</p>
          <p class="portal-message__body">{{ m.body }}</p>
          <RouterLink
            v-if="messageLink(m) && m.order_status === 'awaiting_payment'"
            :to="payPath(messageLink(m)!)"
            class="portal-btn portal-btn--primary"
            >Review and pay</RouterLink
          >
          <span v-else-if="m.order_status === 'paid'" class="portal-badge portal-badge--paid"
            >Paid</span
          >
        </article>
      </section>

      <section class="portal-section">
        <h2 class="portal-section__title">Supplement orders</h2>
        <p v-if="data.invoices.length === 0" class="portal-muted">No orders yet.</p>
        <table v-else class="portal-invoices">
          <thead>
            <tr>
              <th>Date</th>
              <th>Order</th>
              <th class="portal-invoices__num">Items</th>
              <th class="portal-invoices__num">Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in data.invoices" :key="inv.id">
              <td>{{ fmtDate(inv.sent_at) }}</td>
              <td>#{{ inv.id }}</td>
              <td class="portal-invoices__num">{{ inv.item_count }}</td>
              <td class="portal-invoices__num">{{ formatCents(inv.total_cents) }}</td>
              <td>
                <span v-if="inv.status === 'paid'" class="portal-badge portal-badge--paid"
                  >Paid</span
                >
                <span v-else class="portal-badge portal-badge--due">Due</span>
              </td>
              <td>
                <RouterLink :to="payPath(inv.checkout_url)" class="portal-link">
                  {{ inv.status === 'paid' ? 'Receipt' : 'Pay now' }}
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <p class="portal-footer">
      Demo environment: messages are shown here instead of being emailed, and no card is charged.
    </p>
  </div>
</template>
