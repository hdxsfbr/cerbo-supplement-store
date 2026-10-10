<script setup lang="ts">
// US1 — provider assembles an order (T016). Styled as Cerbo chart blocks (constitution VI).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import CerboPanel from '../components/CerboPanel.vue';
import MoneyInput from '../components/MoneyInput.vue';
import SplitPreview from '../components/SplitPreview.vue';
import SupplementSearch from '../components/SupplementSearch.vue';
import { api } from '../api';
import { copyText } from '../clipboard';
import {
  PLATFORM_FEE_BPS,
  formatBps,
  formatCents,
  marginPercentBps,
  priceForMarginBps,
} from '../money';
import { useLoginStore } from '../stores/login';
import { useOrderDraftStore, type DraftLine } from '../stores/orderDraft';
import { useSessionStore } from '../stores/session';
import type { OrderListRow, Patient, Supplement } from '../types';

const props = defineProps<{ orderId?: number }>();
const router = useRouter();
const session = useSessionStore();
const draft = useOrderDraftStore();
// Signed in through the demo chart? Offer the way back to that patient's chart.
const login = useLoginStore();
const chartPath = computed(() =>
  login.isDoctor && draft.order ? `/experimental-chart?patient=${draft.order.patient.id}` : null,
);

const patients = ref<Patient[]>([]);
const supplements = ref<Supplement[]>([]);
const recentOrders = ref<OrderListRow[]>([]);
const selectedPatientId = ref<number | null>(null);
const loadError = ref<string | null>(null);
const copied = ref(false);

async function loadReference(): Promise<void> {
  const [p, s, o] = await Promise.all([api.patients(), api.supplements(), api.listOrders()]);
  patients.value = p.patients;
  supplements.value = s.supplements;
  recentOrders.value = o.orders;
  if (selectedPatientId.value === null && patients.value[0])
    selectedPatientId.value = patients.value[0].id;
}

onMounted(async () => {
  try {
    await loadReference();
    if (props.orderId) {
      await draft.load(props.orderId);
      selectedPatientId.value = draft.order?.patient.id ?? null;
    } else {
      draft.reset();
    }
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});

watch(
  () => props.orderId,
  async (id) => {
    if (id) await draft.load(id);
    else draft.reset();
  },
);

// ── Debounced persistence: local edits → PUT /items ──────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void draft.save(), 400);
}
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

async function startOrder(): Promise<void> {
  if (selectedPatientId.value === null) return;
  const view = await draft.start(selectedPatientId.value);
  await router.replace({ name: 'order', params: { id: view.id } });
  recentOrders.value = (await api.listOrders()).orders;
}

function addSupplement(s: Supplement): void {
  draft.addLine(s);
  scheduleSave();
}

function onQuantity(line: DraftLine, e: Event): void {
  const n = Number((e.target as HTMLInputElement).value);
  draft.setQuantity(line.supplement_id, Number.isInteger(n) && n > 0 ? n : 1);
  scheduleSave();
}

function onPrice(line: DraftLine, cents: number | null | undefined): void {
  if (cents === null || cents === undefined) return;
  draft.setPrice(line.supplement_id, cents);
  scheduleSave();
}

function onPriceValidity(line: DraftLine, valid: boolean): void {
  draft.setPriceValidity(line.supplement_id, valid);
  if (valid) scheduleSave();
}

/** Spec US1 scenario 2: set a margin % instead of a price; the price is derived. */
function onMarginPercent(line: DraftLine, e: Event): void {
  const pct = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return;
  const price = priceForMarginBps(line.unit_cogs_cents, Math.round(pct * 100));
  if (price === null) return;
  draft.setPrice(line.supplement_id, price);
  scheduleSave();
}

function lineMarginLabel(line: DraftLine): string {
  const total = line.quantity * line.unit_price_cents;
  const margin = total - line.quantity * line.unit_cogs_cents;
  const bps = marginPercentBps(total, margin);
  return bps === null ? '—' : formatBps(bps);
}

function lineMarginPercentValue(line: DraftLine): string {
  const bps = marginPercentBps(line.unit_price_cents, line.unit_price_cents - line.unit_cogs_cents);
  return bps === null ? '' : (bps / 100).toFixed(1);
}

async function sendOrder(): Promise<void> {
  if (timer) clearTimeout(timer);
  const view = await draft.send();
  if (view) recentOrders.value = (await api.listOrders()).orders;
}

const copyFailed = ref(false);
async function copyLink(): Promise<void> {
  if (!draft.order?.checkout_url) return;
  const ok = await copyText(draft.order.checkout_url);
  copied.value = ok;
  copyFailed.value = !ok; // show the link itself so it can be selected by hand
  if (ok) setTimeout(() => (copied.value = false), 1500);
}

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
};

const split = computed(() => (draft.dirty || !draft.order ? draft.preview : draft.order.split));
const belowCogsLines = computed(() =>
  draft.lines.filter((l) => l.unit_price_cents < l.unit_cogs_cents).map((l) => l.name),
);
/** Order-level: provider margin AFTER the platform fee can be negative even with no below-cost line. */
const netMarginNegative = computed(() => split.value.margin_cents < 0);

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}
</script>

<template>
  <div class="ob">
    <p v-if="loadError" class="ob__error">Could not load: {{ loadError }}</p>

    <div class="ob__grid">
      <!-- ── Left column: patient + order lines ───────────────────────────────────── -->
      <div class="ob__col ob__col--main">
        <CerboPanel title="Patient" color="navy" :footer="`Practice: ${session.providerName}`">
          <div v-if="!draft.order" class="ob__row">
            <select v-model="selectedPatientId" class="cerbo-select" aria-label="Patient">
              <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <button
              class="cerbo-btn cerbo-btn--primary"
              :disabled="selectedPatientId === null"
              @click="startOrder"
            >
              Start supplement order
            </button>
          </div>
          <div v-else class="ob__patient">
            <strong>{{ draft.order.patient.name }}</strong>
            <span class="cerbo-muted">{{ draft.order.patient.email ?? 'no email on file' }}</span>
            <span class="ob__status" :class="`ob__status--${draft.order.status}`">
              {{ statusLabel[draft.order.status] }}
            </span>
            <span class="cerbo-muted">Order #{{ draft.order.id }}</span>
            <RouterLink v-if="chartPath" :to="chartPath" class="cerbo-link"
              >Back to chart</RouterLink
            >
            <RouterLink to="/orders/new" class="cerbo-link">New order</RouterLink>
          </div>
        </CerboPanel>

        <CerboPanel
          title="Supplement Order"
          color="maroon"
          :footer="
            draft.saving
              ? 'Saving…'
              : draft.dirty
                ? 'Unsaved changes'
                : draft.order
                  ? `Order #${draft.order.id} · ${draft.lines.length} line(s)`
                  : 'Pick a patient to begin'
          "
        >
          <template #actions>
            <span v-if="draft.locked" class="cerbo-chip--warn">locked</span>
          </template>

          <div v-if="draft.order && !draft.locked" class="ob__row ob__add">
            <SupplementSearch
              :supplements="supplements"
              :on-order="draft.lines.map((l) => l.supplement_id)"
              @pick="addSupplement"
            />
          </div>

          <table v-if="draft.lines.length" class="cerbo-table ob__lines">
            <thead>
              <tr>
                <th>Supplement</th>
                <th class="cerbo-table__num">Qty</th>
                <th class="cerbo-table__num">Unit COGS</th>
                <th class="cerbo-table__num">Patient price</th>
                <th class="cerbo-table__num" title="Gross margin on price, before the platform fee">
                  Gross margin %
                </th>
                <th class="cerbo-table__num">Line total</th>
                <th class="cerbo-table__num" title="Line price minus COGS, before the platform fee">
                  Gross line margin
                </th>
                <th v-if="!draft.locked"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in draft.lines" :key="line.supplement_id">
                <td>
                  <div>{{ line.name }}</div>
                  <div class="cerbo-muted">{{ line.sku }}</div>
                  <div v-if="line.sig" class="cerbo-muted">{{ line.sig }}</div>
                  <span v-if="line.unit_price_cents < line.unit_cogs_cents" class="cerbo-chip--warn"
                    >below COGS</span
                  >
                </td>
                <td class="cerbo-table__num">
                  <input
                    v-if="!draft.locked"
                    class="cerbo-input ob__qty"
                    type="number"
                    min="1"
                    step="1"
                    :value="line.quantity"
                    :aria-label="`Quantity for ${line.name}`"
                    @change="onQuantity(line, $event)"
                  />
                  <span v-else>{{ line.quantity }}</span>
                </td>
                <td class="cerbo-table__num cerbo-money">
                  {{ formatCents(line.unit_cogs_cents) }}
                </td>
                <td class="cerbo-table__num">
                  <MoneyInput
                    v-if="!draft.locked"
                    :id="`price-${line.supplement_id}`"
                    :model-value="line.unit_price_cents"
                    :aria-label="`Patient price for ${line.name}`"
                    @update:model-value="onPrice(line, $event)"
                    @validity="onPriceValidity(line, $event)"
                  />
                  <div v-if="!line.price_valid" class="ob__field-error">
                    Enter a dollar amount (e.g. 32.00)
                  </div>
                  <span v-else class="cerbo-money">{{ formatCents(line.unit_price_cents) }}</span>
                </td>
                <td class="cerbo-table__num">
                  <input
                    v-if="!draft.locked"
                    class="cerbo-input ob__pct"
                    type="number"
                    min="0"
                    max="99.9"
                    step="0.1"
                    :value="lineMarginPercentValue(line)"
                    :aria-label="`Margin percent for ${line.name}`"
                    @change="onMarginPercent(line, $event)"
                  />
                  <span v-else>{{ lineMarginLabel(line) }}</span>
                </td>
                <td class="cerbo-table__num cerbo-money">
                  {{ formatCents(line.quantity * line.unit_price_cents) }}
                </td>
                <td
                  class="cerbo-table__num cerbo-money"
                  :class="{ 'cerbo-money--charge': line.unit_price_cents < line.unit_cogs_cents }"
                >
                  {{ formatCents(line.quantity * (line.unit_price_cents - line.unit_cogs_cents)) }}
                </td>
                <td v-if="!draft.locked" class="cerbo-table__num">
                  <button
                    class="cerbo-btn cerbo-btn--danger"
                    :aria-label="`Remove ${line.name}`"
                    @click="
                      draft.removeLine(line.supplement_id);
                      scheduleSave();
                    "
                  >
                    ×
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="draft.order" class="cerbo-muted ob__empty">No supplements yet.</p>

          <p v-if="belowCogsLines.length" class="ob__warn">
            Priced below cost: {{ belowCogsLines.join(', ') }} — gross margin on
            {{ belowCogsLines.length === 1 ? 'that line is' : 'those lines is' }} negative. Allowed,
            but check it is intended.
          </p>
          <p v-if="draft.order && netMarginNegative" class="ob__warn">
            Order net margin is negative: after the {{ PLATFORM_FEE_BPS }} bps platform fee the
            provider margin is {{ formatCents(split.margin_cents) }}.
          </p>
          <p v-if="draft.invalidLineCount" class="ob__warn">
            {{ draft.invalidLineCount }} price field(s) need a valid dollar amount before this order
            can be saved or sent.
          </p>
          <p v-if="draft.error" class="ob__error">{{ draft.error }}</p>
        </CerboPanel>

        <CerboPanel
          title="Open Orders"
          color="gray"
          :footer="`${recentOrders.length} order(s) for ${session.providerName}`"
        >
          <table v-if="recentOrders.length" class="cerbo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>#</th>
                <th>Patient</th>
                <th>Status</th>
                <th class="cerbo-table__num">Items</th>
                <th class="cerbo-table__num">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in recentOrders" :key="o.id">
                <td>{{ fmtDate(o.created_at) }}</td>
                <td>{{ o.id }}</td>
                <td>{{ o.patient_name }}</td>
                <td>{{ statusLabel[o.status] }}</td>
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
          <p v-else class="cerbo-muted">No orders yet.</p>
        </CerboPanel>
      </div>

      <!-- ── Right column: billing preview + send ──────────────────────────────────── -->
      <div class="ob__col ob__col--side">
        <CerboPanel title="Billing (Supplement Store)" color="amber">
          <SplitPreview
            :total-cents="split.total_cents"
            :cogs-cents="split.cogs_cents"
            :fee-cents="split.fee_cents"
            :margin-cents="split.margin_cents"
            title="Order split"
            margin-label="Provider margin (after fee)"
            compact
          />
          <p v-if="draft.dirty" class="cerbo-muted ob__hint">Unsaved changes</p>

          <div class="ob__send">
            <button
              v-if="draft.order && !draft.locked"
              class="cerbo-btn cerbo-btn--primary ob__send-btn"
              :disabled="!draft.canSend"
              @click="sendOrder"
            >
              {{ draft.sending ? 'Sending…' : 'Send to patient for payment' }}
            </button>
            <p v-if="draft.order && !draft.locked && draft.lines.length === 0" class="cerbo-muted">
              Add at least one supplement to send.
            </p>
            <p v-else-if="draft.order && !draft.locked && !draft.allValid" class="cerbo-muted">
              Fix the highlighted price field(s) to send.
            </p>
          </div>

          <div v-if="draft.order?.checkout_url" class="ob__link">
            <div class="ob__link-title">Sent to patient {{ fmtDate(draft.order.sent_at) }}</div>
            <ul v-if="draft.order.notifications?.length" class="ob__notes">
              <li v-for="n in draft.order.notifications" :key="n.id">
                <span class="ob__note-channel">{{
                  n.channel === 'portal_message' ? 'Portal message' : 'Email'
                }}</span>
                <span v-if="n.recipient" class="cerbo-muted"> → {{ n.recipient }}</span>
                <div class="ob__note-subject">{{ n.subject }}</div>
              </li>
            </ul>
            <p v-else-if="draft.order.notified === false" class="ob__warn">
              The patient could not be notified. Share the payment link directly.
            </p>
            <div class="ob__row">
              <a
                :href="draft.order.portal_url"
                target="_blank"
                rel="noopener"
                class="cerbo-btn cerbo-btn--primary"
                >View as patient</a
              >
              <button class="cerbo-btn" @click="copyLink">
                {{ copied ? 'Copied' : 'Copy payment link' }}
              </button>
              <input
                v-if="copyFailed"
                class="cerbo-input ob__link-url"
                :value="draft.order.checkout_url"
                readonly
                aria-label="Payment link"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <RouterLink
                v-if="draft.order.status === 'paid'"
                :to="`/orders/${draft.order.id}/audit`"
                class="cerbo-btn"
                >Audit</RouterLink
              >
            </div>
          </div>
        </CerboPanel>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ob__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 12px;
  align-items: start;
}
@media (max-width: 900px) {
  .ob__grid {
    grid-template-columns: 1fr;
  }
}
.ob__col {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ob__row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ob__add {
  margin: 8px 0;
}
.ob__link-url {
  flex: 1;
  min-width: 260px;
}
.ob__patient {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}
.ob__status {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 6px;
  border: 1px solid currentColor;
}
.ob__status--draft {
  color: var(--cerbo-muted);
}
.ob__status--awaiting_payment {
  color: var(--cerbo-header-orange);
}
.ob__status--paid {
  color: var(--cerbo-credit);
}
.ob__lines {
  margin-top: 4px;
}
.ob__qty {
  width: 54px;
  text-align: right;
}
.ob__pct {
  width: 64px;
  text-align: right;
}
.ob__empty {
  margin: 8px 0;
}
.ob__warn {
  color: var(--cerbo-warn-fg);
  background: #fff3df;
  border: 1px solid var(--cerbo-warn-bg);
  padding: 4px 8px;
  margin: 8px 0 0;
  font-size: 12px;
}
.ob__error {
  color: var(--cerbo-charge);
  font-weight: 700;
  margin: 8px 0 0;
}
.ob__field-error {
  color: var(--cerbo-charge);
  font-size: 11px;
  text-align: right;
}
.ob__hint {
  margin: 4px 0 0;
  text-align: center;
}
.ob__send {
  margin-top: 10px;
}
.ob__send-btn {
  width: 100%;
}
.ob__link {
  margin-top: 12px;
  border-top: 1px solid var(--cerbo-panel-border);
  padding-top: 8px;
}
.ob__link-title {
  font-weight: 700;
  margin-bottom: 4px;
}
.ob__notes {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
.ob__notes li {
  padding: 4px 6px;
  background: var(--cerbo-zebra);
  margin-bottom: 4px;
  font-size: 12px;
}
.ob__note-channel {
  font-weight: 700;
}
.ob__note-subject {
  color: var(--cerbo-text);
}
</style>
