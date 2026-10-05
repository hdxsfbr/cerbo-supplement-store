<script setup lang="ts">
// US2 — cent-by-cent audit of a paid order (T021, FR-006). Cerbo billing-block idiom: dated
// ledger rows, charges in red, bold balance line. Everything shown comes from ledger_entries
// (the system of record), not from a recomputation.
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import CerboPanel from '../components/CerboPanel.vue';
import { api, ApiError } from '../api';
import { formatBps, formatCents, marginPercentBps } from '../money';
import type { LedgerView } from '../types';

const props = defineProps<{ orderId: number }>();

const ledger = ref<LedgerView | null>(null);
const error = ref<string | null>(null);
const notPaid = ref(false);

async function load(): Promise<void> {
  error.value = null;
  notPaid.value = false;
  ledger.value = null;
  try {
    ledger.value = await api.ledger(props.orderId);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'order_not_paid') notPaid.value = true;
    else error.value = (err as Error).message;
  }
}
onMounted(load);
watch(() => props.orderId, load);

const labels: Record<string, string> = {
  cogs: 'Cost of goods (COGS)',
  provider_margin: 'Provider margin',
  platform_fee: 'Platform fee (75 bps)',
};

const balanced = computed(
  () => ledger.value !== null && ledger.value.sum_cents === ledger.value.total_cents,
);
const marginEntry = computed(
  () => ledger.value?.entries.find((e) => e.entry_type === 'provider_margin') ?? null,
);
const marginBps = computed(() =>
  ledger.value && marginEntry.value
    ? marginPercentBps(ledger.value.total_cents, marginEntry.value.amount_cents)
    : null,
);

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <div class="audit">
    <div class="audit__crumbs">
      <RouterLink :to="`/orders/${orderId}`" class="cerbo-link">← Order #{{ orderId }}</RouterLink>
      <RouterLink to="/dashboard" class="cerbo-link">Reporting</RouterLink>
    </div>

    <CerboPanel v-if="notPaid" title="Order Audit" color="gray">
      <p>Order #{{ orderId }} has not been paid yet, so there is no ledger to audit.</p>
    </CerboPanel>
    <CerboPanel v-else-if="error" title="Order Audit" color="gray">
      <p class="audit__error">{{ error }}</p>
    </CerboPanel>

    <div v-else-if="ledger" class="audit__grid">
      <CerboPanel
        :title="`Billing (Order #${ledger.order_id} · ${ledger.patient.name})`"
        color="amber"
        :footer="`Payment ${ledger.payment.gateway_ref ?? ledger.payment.id} · key ${ledger.payment.idempotency_key} · ${fmtDateTime(ledger.payment.created_at)}`"
      >
        <div class="cerbo-balance">
          {{ balanced ? 'BALANCED' : 'OUT OF BALANCE' }}: {{ formatCents(ledger.sum_cents) }} of
          {{ formatCents(ledger.total_cents) }}
          {{ balanced ? '✓' : '✗' }}
        </div>

        <table class="cerbo-table audit__ledger">
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Computation (memo)</th>
              <th class="cerbo-table__num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ fmtDate(ledger.paid_at) }}</td>
              <td><strong>Credit / Payment (+)</strong></td>
              <td class="cerbo-muted">
                patient paid sticker price · {{ ledger.payment.gateway_ref }}
              </td>
              <td class="cerbo-table__num cerbo-money cerbo-money--credit">
                ({{ formatCents(ledger.payment.amount_cents) }})
              </td>
            </tr>
            <tr v-for="e in ledger.entries" :key="e.id">
              <td>{{ fmtDate(e.created_at) }}</td>
              <td>
                <strong v-if="e.entry_type === 'provider_margin'">{{
                  labels[e.entry_type]
                }}</strong>
                <template v-else>{{ labels[e.entry_type] ?? e.entry_type }}</template>
                <span
                  v-if="e.entry_type === 'provider_margin' && e.amount_cents < 0"
                  class="cerbo-chip--warn"
                  >below cost</span
                >
              </td>
              <td class="cerbo-muted audit__memo">{{ e.memo }}</td>
              <td
                class="cerbo-table__num cerbo-money"
                :class="{
                  'cerbo-money--charge': e.entry_type !== 'provider_margin' || e.amount_cents < 0,
                }"
              >
                {{
                  e.entry_type === 'provider_margin'
                    ? formatCents(e.amount_cents)
                    : `-${formatCents(e.amount_cents)}`
                }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3"><strong>Σ ledger entries</strong> (COGS + margin + fee)</td>
              <td class="cerbo-table__num cerbo-money">
                <strong>{{ formatCents(ledger.sum_cents) }}</strong>
              </td>
            </tr>
            <tr>
              <td colspan="3">Amount paid (orders.total_cents)</td>
              <td class="cerbo-table__num cerbo-money">{{ formatCents(ledger.total_cents) }}</td>
            </tr>
          </tfoot>
        </table>

        <div class="audit__fee">
          <div class="audit__fee-title">Platform fee computation</div>
          <table class="cerbo-table audit__fee-table">
            <tbody>
              <tr>
                <td>Order total</td>
                <td class="cerbo-table__num">{{ ledger.fee_computation.total_cents }}¢</td>
              </tr>
              <tr>
                <td>Rate</td>
                <td class="cerbo-table__num">
                  {{ ledger.fee_computation.fee_bps }} bps (×{{ ledger.fee_computation.fee_bps }} ÷
                  10 000)
                </td>
              </tr>
              <tr>
                <td>Exact</td>
                <td class="cerbo-table__num">{{ ledger.fee_computation.exact }}¢</td>
              </tr>
              <tr>
                <td>Rounding</td>
                <td class="cerbo-table__num">{{ ledger.fee_computation.rounding }}</td>
              </tr>
              <tr>
                <td><strong>Fee recorded</strong></td>
                <td class="cerbo-table__num">
                  <strong>{{ ledger.fee_computation.fee_cents }}¢</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="cerbo-muted">
            The database re-asserts this at commit: three entries, one per type, summing to the
            amount paid, with the fee equal to ⌊(total × 75 + 5000) ÷ 10000⌋. Ledger rows are
            append-only.
          </p>
        </div>
      </CerboPanel>

      <div class="audit__side">
        <CerboPanel
          title="Order Lines (COGS snapshot)"
          color="maroon"
          :footer="`Paid ${fmtDateTime(ledger.paid_at)}`"
        >
          <table class="cerbo-table">
            <thead>
              <tr>
                <th>Supplement</th>
                <th class="cerbo-table__num">Qty</th>
                <th class="cerbo-table__num">Unit COGS</th>
                <th class="cerbo-table__num">Unit price</th>
                <th class="cerbo-table__num">Line</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in ledger.items" :key="i.id">
                <td>
                  {{ i.name }}
                  <div class="cerbo-muted">{{ i.sku }}</div>
                </td>
                <td class="cerbo-table__num">{{ i.quantity }}</td>
                <td class="cerbo-table__num cerbo-money">{{ formatCents(i.unit_cogs_cents) }}</td>
                <td class="cerbo-table__num cerbo-money">{{ formatCents(i.unit_price_cents) }}</td>
                <td class="cerbo-table__num cerbo-money">{{ formatCents(i.line_total_cents) }}</td>
              </tr>
            </tbody>
          </table>
        </CerboPanel>

        <CerboPanel title="Summary" color="navy">
          <table class="cerbo-table">
            <tbody>
              <tr>
                <td>Patient paid</td>
                <td class="cerbo-table__num cerbo-money">{{ formatCents(ledger.total_cents) }}</td>
              </tr>
              <tr v-for="e in ledger.entries" :key="e.id">
                <td>{{ labels[e.entry_type] }}</td>
                <td
                  class="cerbo-table__num cerbo-money"
                  :class="{ 'cerbo-money--charge': e.amount_cents < 0 }"
                >
                  {{ formatCents(e.amount_cents) }}
                </td>
              </tr>
              <tr v-if="marginBps !== null">
                <td>Margin on order</td>
                <td class="cerbo-table__num">{{ formatBps(marginBps) }}</td>
              </tr>
            </tbody>
          </table>
        </CerboPanel>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audit__crumbs {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}
.audit__crumbs .cerbo-link {
  color: #cfd6e4;
}
.audit__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 12px;
  align-items: start;
}
@media (max-width: 960px) {
  .audit__grid {
    grid-template-columns: 1fr;
  }
}
.audit__side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.audit__ledger {
  margin-top: 8px;
}
.audit__memo {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.audit__fee {
  margin-top: 12px;
  border-top: 1px solid var(--cerbo-panel-border);
  padding-top: 8px;
}
.audit__fee-title {
  font-weight: 700;
  margin-bottom: 4px;
}
.audit__fee-table {
  max-width: 420px;
}
.audit__error {
  color: var(--cerbo-charge);
}
</style>
