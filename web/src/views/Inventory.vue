<script setup lang="ts">
// Inventory — practice-wide stock (Cerbo holds the inventory). Its own screen on purpose: stock
// and units sold are shared across every provider in the practice, while Reporting is per
// provider, and the two scopes were confusing side by side.
import { computed, onMounted, ref } from 'vue';
import CerboPanel from '../components/CerboPanel.vue';
import { api, ApiError } from '../api';
import { formatCents } from '../money';
import type { InventoryView } from '../types';

const data = ref<InventoryView | null>(null);
const error = ref<string | null>(null);
const editing = ref<Record<number, string>>({});
const savingId = ref<number | null>(null);
const rowError = ref<Record<number, string>>({});

async function load(): Promise<void> {
  error.value = null;
  try {
    data.value = await api.inventory();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
onMounted(load);

const alerts = computed(() => data.value?.inventory.filter((s) => s.low || s.negative).length ?? 0);
const unitsOnHand = computed(
  () => data.value?.inventory.reduce((n, s) => n + s.inventory_count, 0) ?? 0,
);
const stockValueCents = computed(
  () =>
    data.value?.inventory.reduce(
      (n, s) => n + Math.max(0, s.inventory_count) * s.unit_cogs_cents,
      0,
    ) ?? 0,
);

function startEdit(id: number, current: number): void {
  editing.value = { ...editing.value, [id]: String(current) };
}
function cancelEdit(id: number): void {
  const next = { ...editing.value };
  delete next[id];
  editing.value = next;
}
async function saveEdit(id: number): Promise<void> {
  // Vue casts <input type="number"> v-model values to number; normalise to a string first.
  const raw = editing.value[id] === undefined ? undefined : String(editing.value[id]).trim();
  if (raw === undefined) return;
  const n = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(n)) {
    rowError.value = { ...rowError.value, [id]: 'whole number required' };
    return;
  }
  savingId.value = id;
  try {
    await api.setInventory(id, n);
    cancelEdit(id);
    const next = { ...rowError.value };
    delete next[id];
    rowError.value = next;
    await load();
  } catch (err) {
    rowError.value = {
      ...rowError.value,
      [id]: err instanceof ApiError ? err.message : String(err),
    };
  } finally {
    savingId.value = null;
  }
}
</script>

<template>
  <div class="inv">
    <p v-if="error" class="inv__error">Could not load: {{ error }}</p>
    <template v-if="data">
      <div class="inv__tiles">
        <CerboPanel title="Units on hand" color="navy">
          <div class="inv__tile-value">{{ unitsOnHand }}</div>
          <div class="cerbo-muted">{{ data.inventory.length }} products</div>
        </CerboPanel>
        <CerboPanel title="Stock at cost" color="maroon">
          <div class="inv__tile-value">{{ formatCents(stockValueCents) }}</div>
          <div class="cerbo-muted">on-hand units × unit COGS</div>
        </CerboPanel>
        <CerboPanel title="Alerts" :color="alerts ? 'orange' : 'green'">
          <div class="inv__tile-value">{{ alerts }}</div>
          <div class="cerbo-muted">low (&lt; {{ data.low_stock_threshold }}) or oversold</div>
        </CerboPanel>
      </div>

      <CerboPanel
        title="Inventory"
        color="navy"
        :footer="`Stock is held by the practice and shared by all providers; it moves when any provider's order is paid. Low-stock threshold: ${data.low_stock_threshold}`"
      >
        <template #actions>
          <span v-if="alerts" class="cerbo-chip--warn">{{ alerts }} alert(s)</span>
        </template>
        <table class="cerbo-table">
          <thead>
            <tr>
              <th>Supplement</th>
              <th class="cerbo-table__num">COGS</th>
              <th class="cerbo-table__num">Default price</th>
              <th
                class="cerbo-table__num"
                title="Units sold by the acting provider — same scope as the tiles"
              >
                Sold by you
              </th>
              <th class="cerbo-table__num" title="Units sold by all providers in the practice">
                Sold (all)
              </th>
              <th
                class="cerbo-table__num"
                title="Practice-wide stock; moves when any provider's order is paid"
              >
                On hand
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in data.inventory"
              :key="s.id"
              :class="{ 'dash__row--negative': s.negative }"
            >
              <td>
                {{ s.name }}
                <div class="cerbo-muted">{{ s.sku }}</div>
              </td>
              <td class="cerbo-table__num cerbo-money">{{ formatCents(s.unit_cogs_cents) }}</td>
              <td class="cerbo-table__num cerbo-money">
                {{ formatCents(s.default_price_cents) }}
              </td>
              <td class="cerbo-table__num">{{ s.units_sold_mine }}</td>
              <td class="cerbo-table__num">{{ s.units_sold }}</td>
              <td class="cerbo-table__num">
                <template v-if="editing[s.id] !== undefined">
                  <input
                    v-model="editing[s.id]"
                    class="cerbo-input dash__stock-input"
                    type="number"
                    step="1"
                    :aria-label="`Inventory for ${s.name}`"
                    @keyup.enter="saveEdit(s.id)"
                    @keyup.esc="cancelEdit(s.id)"
                  />
                </template>
                <template v-else>
                  <strong :class="{ 'cerbo-money--charge': s.negative }">{{
                    s.inventory_count
                  }}</strong>
                  <span v-if="s.negative" class="cerbo-chip--warn">oversold</span>
                  <span v-else-if="s.low" class="cerbo-chip--warn">low</span>
                </template>
                <div v-if="rowError[s.id]" class="dash__row-error">{{ rowError[s.id] }}</div>
              </td>
              <td class="cerbo-table__num dash__actions">
                <template v-if="editing[s.id] !== undefined">
                  <button
                    class="cerbo-btn cerbo-btn--primary"
                    :disabled="savingId === s.id"
                    @click="saveEdit(s.id)"
                  >
                    Save
                  </button>
                  <button class="cerbo-btn" @click="cancelEdit(s.id)">Cancel</button>
                </template>
                <button v-else class="cerbo-btn" @click="startEdit(s.id, s.inventory_count)">
                  Edit
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </CerboPanel>
    </template>
  </div>
</template>

<style scoped>
.inv__tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}
.inv__tile-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.dash__row--negative td {
  background: #fff1f0 !important;
}
.dash__stock-input {
  width: 72px;
  text-align: right;
}
.dash__actions {
  white-space: nowrap;
}
.dash__actions .cerbo-btn + .cerbo-btn {
  margin-left: 4px;
}
.dash__row-error {
  color: var(--cerbo-charge);
  font-size: 11px;
}
.inv__error {
  color: #ffb4ab;
  font-weight: 700;
}
</style>
