<script setup lang="ts">
// US3 — provider dashboard (T023, FR-007/FR-008). Cerbo billing idiom. Every money figure on
// this page is a SUM over ledger_entries from the API; nothing is recomputed client-side.
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import CerboPanel from '../components/CerboPanel.vue';
import { api } from '../api';
import { formatBps, formatCents, marginPercentBps } from '../money';
import type { DashboardSummary } from '../types';

const data = ref<DashboardSummary | null>(null);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    data.value = await api.dashboard();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
onMounted(load);

const reconciles = computed(
  () =>
    data.value !== null &&
    data.value.cogs_cents + data.value.margin_cents + data.value.fees_cents ===
      data.value.gross_cents,
);
const marginBps = computed(() =>
  data.value ? marginPercentBps(data.value.gross_cents, data.value.margin_cents) : null,
);

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
</script>

<template>
  <div class="dash">
    <p v-if="error" class="dash__error">Could not load: {{ error }}</p>

    <template v-if="data">
      <div class="dash__tiles">
        <CerboPanel title="Gross sales (GMV)" color="amber">
          <div class="dash__tile-value">{{ formatCents(data.gross_cents) }}</div>
          <div class="cerbo-muted">{{ data.orders_paid }} paid order(s)</div>
        </CerboPanel>
        <CerboPanel title="Provider margin" color="green">
          <div class="dash__tile-value" :class="{ 'cerbo-money--charge': data.margin_cents < 0 }">
            {{ formatCents(data.margin_cents) }}
          </div>
          <div class="cerbo-muted">
            <template v-if="marginBps !== null">{{ formatBps(marginBps) }} of gross · </template
            >after COGS and platform fee
          </div>
        </CerboPanel>
        <CerboPanel title="Cost of goods" color="maroon">
          <div class="dash__tile-value">{{ formatCents(data.cogs_cents) }}</div>
          <div class="cerbo-muted">cost of units sold</div>
        </CerboPanel>
        <CerboPanel title="Platform fees (75 bps)" color="black">
          <div class="dash__tile-value">{{ formatCents(data.fees_cents) }}</div>
          <div class="cerbo-muted">75 bps of each order</div>
        </CerboPanel>
      </div>

      <div v-if="!reconciles" class="dash__recon dash__recon--bad">
        Totals do not reconcile: COGS {{ formatCents(data.cogs_cents) }} + margin
        {{ formatCents(data.margin_cents) }} + fees {{ formatCents(data.fees_cents) }} ≠ gross
        {{ formatCents(data.gross_cents) }}. Please reload.
      </div>

      <div class="dash__grid">
        <CerboPanel
          title="Billing (Supplement Store · paid orders)"
          color="amber"
          :footer="`${data.paid_orders.length} paid order(s) for ${data.provider.name}`"
        >
          <table v-if="data.paid_orders.length" class="cerbo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>#</th>
                <th>Patient</th>
                <th class="cerbo-table__num">Paid</th>
                <th class="cerbo-table__num">COGS</th>
                <th class="cerbo-table__num">Fee</th>
                <th class="cerbo-table__num">Margin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in data.paid_orders" :key="o.id">
                <td>{{ fmtDate(o.paid_at) }}</td>
                <td>{{ o.id }}</td>
                <td>{{ o.patient_name }}</td>
                <td class="cerbo-table__num cerbo-money cerbo-money--credit">
                  ({{ formatCents(o.total_cents) }})
                </td>
                <td class="cerbo-table__num cerbo-money cerbo-money--charge">
                  -{{ formatCents(o.cogs_cents) }}
                </td>
                <td class="cerbo-table__num cerbo-money cerbo-money--charge">
                  -{{ formatCents(o.fee_cents) }}
                </td>
                <td
                  class="cerbo-table__num cerbo-money"
                  :class="{ 'cerbo-money--charge': o.margin_cents < 0 }"
                >
                  <strong>{{ formatCents(o.margin_cents) }}</strong>
                </td>
                <td>
                  <RouterLink :to="`/orders/${o.id}/audit`" class="cerbo-link">audit</RouterLink>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><strong>Totals</strong></td>
                <td class="cerbo-table__num cerbo-money cerbo-money--credit">
                  ({{ formatCents(data.gross_cents) }})
                </td>
                <td class="cerbo-table__num cerbo-money cerbo-money--charge">
                  -{{ formatCents(data.cogs_cents) }}
                </td>
                <td class="cerbo-table__num cerbo-money cerbo-money--charge">
                  -{{ formatCents(data.fees_cents) }}
                </td>
                <td class="cerbo-table__num cerbo-money">
                  <strong>{{ formatCents(data.margin_cents) }}</strong>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <p v-else class="cerbo-muted">
            No paid orders yet.
            <RouterLink to="/orders/new" class="cerbo-link">Start one</RouterLink>.
          </p>
        </CerboPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dash__tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 900px) {
  .dash__tiles {
    grid-template-columns: repeat(2, 1fr);
  }
}
.dash__tile-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.dash__recon {
  margin: 10px 0;
  padding: 6px 10px;
  background: #e9f3ea;
  border: 1px solid #b9d9bd;
  color: #1d4a24;
  font-size: 12px;
}
.dash__recon--bad {
  background: #fdecea;
  border-color: #f1b0a8;
  color: var(--cerbo-charge);
  font-weight: 700;
}
.dash__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-items: start;
}
@media (max-width: 1000px) {
  .dash__grid {
    grid-template-columns: 1fr;
  }
}
.dash__error {
  color: #ffb4ab;
  font-weight: 700;
}
</style>
