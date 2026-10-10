<script setup lang="ts">
// Orders — the provider's supplement orders with filters and sorting. The list comes from
// GET /api/orders (newest first, practice-sized); filtering and sorting happen here.
// Route: /orders. Starting or editing an order is the order page (/orders/new, /orders/:id).
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import CerboPanel from '../components/CerboPanel.vue';
import { api } from '../api';
import { formatCents } from '../money';
import { useSessionStore } from '../stores/session';
import type { OrderListRow, OrderStatus } from '../types';

const session = useSessionStore();
const orders = ref<OrderListRow[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

onMounted(async () => {
  try {
    orders.value = (await api.listOrders()).orders;
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
});

const statusLabel: Record<OrderStatus, string> = {
  draft: 'Draft',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
};

// ── Filters ──────────────────────────────────────────────────────────────────────────────
const status = ref<'all' | OrderStatus>('all');
const patientId = ref<'all' | number>('all');
const search = ref('');

const patients = computed(() => {
  const seen = new Map<number, string>();
  for (const o of orders.value) seen.set(o.patient_id, o.patient_name);
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
const counts = computed(() => {
  const c: Record<'all' | OrderStatus, number> = { all: 0, draft: 0, awaiting_payment: 0, paid: 0 };
  for (const o of orders.value) {
    c.all += 1;
    c[o.status] += 1;
  }
  return c;
});

// ── Sorting ──────────────────────────────────────────────────────────────────────────────
type SortKey = 'created_at' | 'id' | 'patient_name' | 'status' | 'item_count' | 'total_cents';
const sortKey = ref<SortKey>('created_at');
const sortDir = ref<'asc' | 'desc'>('desc');
function sortBy(key: SortKey): void {
  if (sortKey.value === key) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  else {
    sortKey.value = key;
    // numbers and dates read best newest/largest first; text A→Z
    sortDir.value = key === 'patient_name' || key === 'status' ? 'asc' : 'desc';
  }
}
function arrow(key: SortKey): string {
  return sortKey.value === key ? (sortDir.value === 'asc' ? ' ▲' : ' ▼') : '';
}
const STATUS_ORDER: Record<OrderStatus, number> = { draft: 0, awaiting_payment: 1, paid: 2 };

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = orders.value.filter(
    (o) =>
      (status.value === 'all' || o.status === status.value) &&
      (patientId.value === 'all' || o.patient_id === patientId.value) &&
      (!q || o.patient_name.toLowerCase().includes(q) || String(o.id) === q),
  );
  const dir = sortDir.value === 'asc' ? 1 : -1;
  const k = sortKey.value;
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (k === 'patient_name') cmp = a.patient_name.localeCompare(b.patient_name);
    else if (k === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (k === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
    else cmp = a[k] - b[k];
    return cmp !== 0 ? cmp * dir : (b.id - a.id) * (k === 'id' ? 0 : 1);
  });
});
const totalCents = computed(() => rows.value.reduce((s, o) => s + o.total_cents, 0));

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
</script>

<template>
  <div class="ol">
    <CerboPanel
      title="Supplement Orders"
      color="gray"
      :footer="`${rows.length} of ${orders.length} order(s) for ${session.providerName} · ${formatCents(totalCents)} shown`"
    >
      <template #actions>
        <RouterLink to="/orders/new" class="cerbo-btn cerbo-btn--primary">New order</RouterLink>
      </template>

      <div class="ol__filters">
        <div class="ol__tabs" role="tablist">
          <button
            v-for="s in ['all', 'draft', 'awaiting_payment', 'paid'] as const"
            :key="s"
            type="button"
            class="ol__tab"
            :class="{ 'ol__tab--on': status === s }"
            role="tab"
            :aria-selected="status === s"
            @click="status = s"
          >
            {{ s === 'all' ? 'All' : statusLabel[s] }}
            <span class="ol__count">{{ counts[s] }}</span>
          </button>
        </div>
        <select v-model="patientId" class="cerbo-select" aria-label="Filter by patient">
          <option value="all">All patients</option>
          <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input
          v-model="search"
          class="cerbo-input ol__search"
          type="search"
          placeholder="Patient name or order #"
          aria-label="Search orders"
        />
      </div>

      <p v-if="loading" class="cerbo-muted">Loading orders…</p>
      <p v-else-if="loadError" class="ob__error">{{ loadError }}</p>
      <table v-else-if="rows.length" class="cerbo-table ol__table">
        <thead>
          <tr>
            <th>
              <button type="button" class="ol__sort" @click="sortBy('created_at')">
                Date{{ arrow('created_at') }}
              </button>
            </th>
            <th>
              <button type="button" class="ol__sort" @click="sortBy('id')">
                #{{ arrow('id') }}
              </button>
            </th>
            <th>
              <button type="button" class="ol__sort" @click="sortBy('patient_name')">
                Patient{{ arrow('patient_name') }}
              </button>
            </th>
            <th>
              <button type="button" class="ol__sort" @click="sortBy('status')">
                Status{{ arrow('status') }}
              </button>
            </th>
            <th class="cerbo-table__num">
              <button type="button" class="ol__sort" @click="sortBy('item_count')">
                Items{{ arrow('item_count') }}
              </button>
            </th>
            <th class="cerbo-table__num">
              <button type="button" class="ol__sort" @click="sortBy('total_cents')">
                Total{{ arrow('total_cents') }}
              </button>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in rows" :key="o.id">
            <td>{{ fmtDate(o.created_at) }}</td>
            <td>{{ o.id }}</td>
            <td>{{ o.patient_name }}</td>
            <td>
              <span class="ol__status" :class="`ol__status--${o.status}`">{{
                statusLabel[o.status]
              }}</span>
            </td>
            <td class="cerbo-table__num">{{ o.item_count }}</td>
            <td class="cerbo-table__num cerbo-money">{{ formatCents(o.total_cents) }}</td>
            <td>
              <RouterLink :to="`/orders/${o.id}`" class="cerbo-link">open</RouterLink>
              <template v-if="o.status === 'paid'">
                ·
                <RouterLink :to="`/orders/${o.id}/audit`" class="cerbo-link">audit</RouterLink>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="cerbo-muted">
        {{ orders.length ? 'No orders match these filters.' : 'No orders yet.' }}
      </p>
    </CerboPanel>
  </div>
</template>

<style scoped>
.ol__filters {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ol__tabs {
  display: inline-flex;
  border: 1px solid var(--cerbo-panel-border);
  border-radius: 3px;
  overflow: hidden;
}
.ol__tab {
  background: #fff;
  border: 0;
  border-right: 1px solid var(--cerbo-panel-border);
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--cerbo-text);
}
.ol__tab:last-child {
  border-right: 0;
}
.ol__tab--on {
  background: var(--cerbo-navy, #013365);
  color: #fff;
}
.ol__count {
  display: inline-block;
  min-width: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.12);
  font-size: 11px;
  text-align: center;
}
.ol__tab--on .ol__count {
  background: rgba(255, 255, 255, 0.25);
}
.ol__search {
  min-width: 220px;
}
.ol__sort {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-transform: inherit;
  letter-spacing: inherit;
}
.ol__status {
  font-size: 12px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 2px;
  color: #fff;
  background: #999;
}
.ol__status--awaiting_payment {
  background: #ff9900;
}
.ol__status--paid {
  background: #336601;
}
</style>
