<script setup lang="ts">
// EXPERIMENTAL — a replica of Cerbo's patient chart (docs/cerbo-ui-reference/) with the
// supplement store embedded where Cerbo keeps its Rx flow: a Supplements tab in the Medications
// panel, a picker modal ("+ Add Supplement") and a detail modal ("+ Complete Supplement Order").
// Only the Supplements tab and modals are wired to the API; the rest of the chart is static.
// Route: /experimental-chart.
import '../styles/chart.css';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useLoginStore } from '../stores/login';
import { useOrderDraftStore } from '../stores/orderDraft';
import { useSessionStore } from '../stores/session';
import {
  formatCents,
  formatBps,
  marginPercentBps,
  parseCentsInput,
  previewSplit,
  priceForMarginBps,
} from '../money';
import type { OrderView, Patient, Supplement } from '../types';

// The acting provider comes from the demo login (identity seam); the patient being viewed is
// chosen from the top-right dropdown and kept in the URL (?patient=<id>) so reloads stick.
useSessionStore();
const login = useLoginStore();
const route = useRoute();
const router = useRouter();
const draft = useOrderDraftStore();
const doctorInitials = computed(() =>
  login.account?.role === 'doctor' ? login.account.initials : '',
);
const providerName = computed(() => login.account?.name ?? '');

const patients = ref<Patient[]>([]);
const patient = ref<Patient | null>(null);
const firstName = computed(() => patient.value?.name.split(' ')[0] ?? '');
function selectPatient(e: Event): void {
  const id = Number((e.target as HTMLSelectElement).value);
  void router.replace({ query: { ...route.query, patient: String(id) } });
}
function signOut(): void {
  login.signOut();
  void router.push('/');
}
const catalog = ref<Supplement[]>([]);
const history = ref<OrderView[]>([]); // this patient's sent/paid orders, newest first
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadChart(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [pts, cat, list] = await Promise.all([
      api.patients(),
      api.supplements(),
      api.listOrders(),
    ]);
    catalog.value = cat.supplements;
    patients.value = pts.patients;
    const wanted = Number(route.query.patient);
    const p = pts.patients.find((x) => x.id === wanted) ?? pts.patients[0] ?? null;
    patient.value = p;
    modal.value = null;
    tab.value = 'meds';
    if (!p) return;
    const mine = list.orders.filter((o) => o.patient_id === p.id).slice(0, 20);
    const views = await Promise.all(mine.map((o) => api.getOrder(o.id)));
    history.value = views.filter((v) => v.status !== 'draft');
    const open = views.find((v) => v.status === 'draft');
    if (open) await draft.load(open.id);
    else draft.reset();
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(loadChart);
watch(
  () => route.query.patient,
  () => void loadChart(),
);

// ── Supplements tab ──────────────────────────────────────────────────────────────────────
const tab = ref<'meds' | 'supps'>('meds');

interface SuppRow {
  key: string;
  name: string;
  sig: string | null;
  cents: number;
  status: 'paid' | 'due' | 'draft';
  date: string;
  orderId: number | null;
  supplementId: number;
}
function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}
const rows = computed<SuppRow[]>(() => {
  const out: SuppRow[] = draft.lines.map((l) => ({
    key: `d-${l.supplement_id}`,
    name: l.name,
    sig: l.sig ?? null,
    cents: l.quantity * l.unit_price_cents,
    status: 'draft',
    date: '',
    orderId: draft.order?.id ?? null,
    supplementId: l.supplement_id,
  }));
  for (const o of history.value) {
    for (const i of o.items) {
      out.push({
        key: `o${o.id}-${i.id}`,
        name: i.name,
        sig: i.sig,
        cents: i.line_total_cents,
        status: o.status === 'paid' ? 'paid' : 'due',
        date: shortDate(o.status === 'paid' ? o.paid_at : o.sent_at),
        orderId: o.id,
        supplementId: i.supplement_id,
      });
    }
  }
  return out;
});
const lastUpdate = computed(() => {
  const latest = history.value[0];
  const iso = latest?.paid_at ?? latest?.sent_at ?? latest?.created_at;
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
});
const draftSummary = computed(() => {
  const n = draft.lines.length;
  if (n === 0) return null;
  return `Draft order: ${n} line${n === 1 ? '' : 's'} · ${formatCents(draft.preview.total_cents)} · not yet sent`;
});
const actionError = ref<string | null>(null);
const busy = ref(false);

async function removeDraftLine(supplementId: number): Promise<void> {
  draft.removeLine(supplementId);
  await draft.flush();
  actionError.value = draft.error;
}

async function sendDraft(): Promise<void> {
  if (!draft.canSend || busy.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    const sent = await draft.send();
    if (!sent) {
      actionError.value = draft.error ?? 'Could not send the order';
      return;
    }
    history.value.unshift(sent);
    draft.reset();
  } finally {
    busy.value = false;
  }
}

// ── Modal 1: picker ──────────────────────────────────────────────────────────────────────
const modal = ref<null | 'pick' | 'detail'>(null);
const query = ref('');
const picked = ref(0);
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return catalog.value;
  return catalog.value.filter(
    (s) => s.name.toLowerCase().includes(q) || (s.sku ?? '').toLowerCase().includes(q),
  );
});
watch(query, () => (picked.value = 0));
const hovered = computed<Supplement | null>(() => matches.value[picked.value] ?? null);
function marginAtDefault(s: Supplement): string {
  const bps = marginPercentBps(s.default_price_cents, s.default_price_cents - s.unit_cogs_cents);
  return bps === null ? '—' : formatBps(bps);
}
function openPicker(): void {
  query.value = '';
  picked.value = 0;
  actionError.value = null;
  modal.value = 'pick';
}

// ── Modal 2: detail ──────────────────────────────────────────────────────────────────────
const TAKE = ['1', '2', '3', '4'];
const UNITS = ['capsule(s)', 'softgel(s)', 'tablet(s)', 'scoop(s)', 'dropper(s)', 'packet(s)'];
const FREQ = [
  'once daily',
  'twice daily',
  'three times daily',
  'every morning',
  'at bedtime',
  'with meals',
  'as needed',
];
const chosen = ref<Supplement | null>(null);
const form = ref({
  take: '2',
  unit: 'capsule(s)',
  freq: 'once daily',
  note: '',
  qty: '1',
  price: '',
  margin: '',
  ack: true,
});

function guessUnit(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('softgel')) return 'softgel(s)';
  if (n.includes('tablet')) return 'tablet(s)';
  if (n.includes('powder') || n.includes('scoop')) return 'scoop(s)';
  if (n.includes('drop') || n.includes('liquid')) return 'dropper(s)';
  return 'capsule(s)';
}
function parseSig(sig: string): { take: string; unit: string; freq: string; note: string } | null {
  const m = /^Take (\d) (\S+) (.+?)(?:\. (.*))?$/.exec(sig);
  if (!m) return null;
  return { take: m[1]!, unit: m[2]!, freq: m[3]!, note: m[4] ?? '' };
}
function openDetail(s: Supplement): void {
  chosen.value = s;
  const existing = draft.lines.find((l) => l.supplement_id === s.id);
  const price = existing?.unit_price_cents ?? s.default_price_cents;
  const parsed = existing?.sig ? parseSig(existing.sig) : null;
  form.value = {
    take: parsed && TAKE.includes(parsed.take) ? parsed.take : '1',
    unit: parsed && UNITS.includes(parsed.unit) ? parsed.unit : guessUnit(s.name),
    freq: parsed && FREQ.includes(parsed.freq) ? parsed.freq : 'once daily',
    note: parsed ? parsed.note : existing?.sig ? existing.sig : '',
    qty: String(existing?.quantity ?? 1),
    price: formatCents(price).replace(/^\$/, ''),
    margin: marginText(price, s.unit_cogs_cents),
    ack: true,
  };
  actionError.value = null;
  modal.value = 'detail';
}
function marginText(priceCents: number, cogs: number): string {
  const bps = marginPercentBps(priceCents, priceCents - cogs);
  return bps === null ? '' : (bps / 100).toFixed(1);
}
const priceCents = computed(() => parseCentsInput(form.value.price));
const qty = computed(() => {
  const n = Number(form.value.qty);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
});
const formValid = computed(() => priceCents.value !== null && qty.value !== null && form.value.ack);
const detailSplit = computed(() =>
  chosen.value && priceCents.value !== null && qty.value !== null
    ? previewSplit([
        {
          quantity: qty.value,
          unit_price_cents: priceCents.value,
          unit_cogs_cents: chosen.value.unit_cogs_cents,
        },
      ])
    : null,
);
function onPriceInput(): void {
  if (!chosen.value || priceCents.value === null) return;
  form.value.margin = marginText(priceCents.value, chosen.value.unit_cogs_cents);
}
function onMarginInput(): void {
  if (!chosen.value) return;
  const pct = Number(form.value.margin);
  if (!Number.isFinite(pct)) return;
  const cents = priceForMarginBps(chosen.value.unit_cogs_cents, Math.round(pct * 100));
  if (cents !== null) form.value.price = formatCents(cents).replace(/^\$/, '');
}
const composedSig = computed(() => {
  const f = form.value;
  const base = `Take ${f.take} ${f.unit} ${f.freq}`;
  const note = f.note.trim();
  return note ? `${base}. ${note}` : base;
});

async function commit(then: 'close' | 'another' | 'send'): Promise<void> {
  const s = chosen.value;
  if (!patient.value || !s || !formValid.value || busy.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    if (!draft.order) await draft.start(patient.value.id);
    if (!draft.lines.some((l) => l.supplement_id === s.id)) draft.addLine(s);
    draft.setQuantity(s.id, qty.value!);
    draft.setPrice(s.id, priceCents.value!);
    draft.setSig(s.id, composedSig.value);
    await draft.flush();
    if (draft.error) {
      actionError.value = draft.error;
      return;
    }
    if (then === 'send') {
      const sent = await draft.send();
      if (!sent) {
        actionError.value = draft.error ?? 'Could not send the order';
        return;
      }
      history.value.unshift(sent);
      draft.reset();
      modal.value = null;
      tab.value = 'supps';
      return;
    }
    tab.value = 'supps';
    if (then === 'another') openPicker();
    else modal.value = null;
  } catch (err) {
    actionError.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

const encounters = [
  { icon: 'plus', name: 'Functional Med Visit', who: 'M.W.', date: '08/07/2024' },
  { icon: 'plus', name: 'Annual Wellness', who: 'M.W.', date: '08/06/2024' },
  { icon: 'video', name: 'Follow Up', who: 'M.W.', date: '08/06/2024' },
  { icon: 'plus', name: 'New Patient', who: 'M.W.', date: '08/06/2024' },
  { icon: 'video', name: 'IV Injection', who: 'M.W.', date: '07/16/2024' },
];
const meds = [
  { name: 'Levothroid - 0.025MG QD', from: '08/07/24', to: '09/06/24' },
  { name: 'Ozempic - 0.25 Or 0.5MG/DOSE QD (X2)', from: '08/07/24', to: '09/06/24', up: true },
  { name: 'Claritin - 10MG QD', from: '08/06/24', to: '09/05/24' },
  { name: 'Lexapro 10mg Tab - 10MG [See Sig]', from: '08/06/24', to: '08/01/25' },
  { name: 'Lisinopril - 10MG [See Sig] (X2)', from: '08/06/24', to: '06/02/25' },
  { name: 'Jardiance - 10MG QD', from: '07/09/24', to: '08/08/24', expired: true },
];
const docTabs = [
  ['Unreviewed', 10, true],
  ['Labs', 1],
  ['Imaging'],
  ['Consult'],
  ['Procedures'],
  ['Handouts', 9],
  ['Forms', 2],
  ['Misc', 3],
  ['Sent', 1],
  ['Invoices', 6],
] as const;
const docs = [
  {
    name: 'Skincare Treatment Form Added 08/07/2024',
    meta: '[text/html - 21.4KB]',
    date: '08/07/24',
  },
  {
    name: 'Supplement Plan: 08/06/2024',
    meta: '[text/html - 8.1KB]',
    date: '08/06/24',
    person: true,
  },
  { name: 'Botox Map added 08/06/2024', meta: '[text/html - 7.8KB]', date: '08/06/24' },
  { name: 'WellnessandSupplementPlans', meta: '[pdf - 746.3KB]', date: '08/05/24', person: true },
  {
    name: 'Ultrasound Video; see link in notes',
    meta: '[pdf - 746.3KB]',
    date: '08/05/24',
    person: true,
  },
  {
    name: 'Wellness Plan: 07/31/2024',
    meta: '[text/html - 21.5KB]',
    date: '07/31/24',
    person: true,
  },
  {
    name: 'Complete cbc w/auto diff wbc Results',
    meta: '[text/html - 5.3KB]',
    date: '07/10/24',
    person: true,
  },
  {
    name: 'LIPID PANEL, CBC (INCLUDES DIFF/PLT)',
    meta: '[pdf - 10KB]',
    date: '02/29/24',
    person: true,
    flag: true,
  },
];
const ledger = [
  { d: '08/08/24', n: 'Vitamin B12', a: '-$12.00' },
  { d: '08/08/24', n: 'Credit / Payment (+)', a: '($600.00)', cr: true },
  { d: '08/07/24', n: 'Vitamin B12', a: '-$12.00' },
  { d: '08/07/24', n: 'B12', a: '-$25.00', plain: true },
  { d: '08/07/24', n: 'Credit / Payment (+)', a: '($25.00)', cr: true },
  { d: '08/07/24', n: 'Vitamin B12 Lozenges (60 Ct)', a: '-$54.00' },
];
</script>

<template>
  <div class="xc">
    <nav class="xc-nav">
      <div class="xc-nav__logo">
        <img src="/cerbo-logo.svg" alt="Cerbo" />
        <span class="xc-nav__tag">Location/Department A</span>
      </div>
      <span class="xc-nav__item">Scheduling<span class="xc-badge">15</span></span>
      <span class="xc-nav__item">Admin</span>
      <span class="xc-nav__item">Reporting</span>
      <span class="xc-nav__item"
        >Tasks<span class="xc-nav__circle">21</span><span class="xc-badge">21</span></span
      >
      <span class="xc-nav__item">Generate</span>
      <span class="xc-nav__item">My Links</span>
      <span class="xc-nav__item">Pt Portal</span>
      <span class="xc-nav__item">Settings</span>
      <span class="xc-nav__user" :title="providerName" @click="signOut"
        >&#128100; {{ doctorInitials }}</span
      >
      <span class="xc-nav__help">?</span>
      <span class="xc-nav__note"></span>
      <select class="xc-nav__search" :value="patient?.id ?? ''" @change="selectPatient">
        <option value="" disabled>- Search Patients -</option>
        <option v-for="p in patients" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </nav>

    <div class="xc-grid">
      <!-- ── Column 1: patient rail ─────────────────────────────────────── -->
      <div class="xc-col xc-col--rail">
        <div class="xc-photo">
          <img v-if="patient?.id === 1" src="/experimental/zeus.jpg" alt="" />
          <div v-else class="xc-photo__blank">{{ firstName.slice(0, 1) }}</div>
          <div class="xc-photo__icons"><span></span><span>&#9998;</span></div>
          <div class="xc-photo__cap">
            <span class="xc-photo__sex">&#9792;</span>
            <b>{{ patient?.name ?? '…' }}</b> <i v-if="patient?.id === 1">("Jupiter")</i><br />
            #{{ 20 + (patient?.id ?? 1) }} - <b style="font-size: 13px">54 Years</b> (01/08/1970)
          </div>
        </div>

        <div class="xc-panel">
          <div class="xc-panel__hdr xc-dark">Patient Information</div>
          <div class="xc-panel__body xc-info">
            <div>
              <b>Sex:</b> undefined
              <small style="color: #555; margin-left: 10px">* defaults to female</small>
            </div>
            <div><b>Pronouns:</b> he/him/his</div>
            <div>
              <b>Home:</b> <a href="#" style="border-bottom: 1px dotted">555 099 1222</a>
              <span style="color: #f0b429">&#9733;</span>
            </div>
            <div><b>Mobile:</b> &#128274; <a href="#">5552120155</a></div>
            <div><b>Work:</b></div>
            <div><b>EM:</b> <a href="#">jdoe@cer.bo</a></div>
            <div><b>Grp Account:</b> <a href="#">ABC Corp</a></div>
            <div>
              <b>Provider:</b>
              <select>
                <option>M. Welby</option>
              </select>
            </div>
            <div style="display: flex; justify-content: space-between">
              <span><b>Joined:</b> September 11, 2010</span
              ><span
                style="
                  border: 1px solid #555;
                  width: 12px;
                  height: 12px;
                  font-size: 10px;
                  line-height: 10px;
                  text-align: center;
                "
                >+</span
              >
            </div>
          </div>
          <div class="xc-strip xc-strip--red">Opted Out of AC</div>
          <div class="xc-strip xc-strip--black">Cash Pay</div>
          <div class="xc-strip xc-strip--gray">Hormone</div>
        </div>

        <div class="xc-panel">
          <div class="xc-panel__hdr xc-purple">Health Maintenance</div>
          <div class="xc-panel__body" style="font-size: 13px">
            <div style="margin: 3px 0">
              <b>Mammogram:</b> <span style="color: #cc0100">Not Recorded</span>
            </div>
            <div style="margin: 3px 0"><b>Colonoscopy screen :</b> 12/18/2023</div>
          </div>
        </div>

        <div class="xc-panel">
          <div class="xc-panel__hdr xc-dark">Relationships</div>
          <div class="xc-panel__body xc-rel" style="font-size: 13px">
            <ul>
              <li><a href="#">Hera Elaine Queen</a> - <i>emer. contact</i> &#128101;</li>
              <li><a href="#">Demeter W Harvest</a> - <i>sibling</i> &#128101;</li>
              <li><a href="#">John Doe</a> - <i>child</i> &#128101;</li>
              <li><a href="#">Phoebe Buffay</a> - <i>dependent</i></li>
            </ul>
          </div>
        </div>

        <div class="xc-panel">
          <div class="xc-panel__hdr xc-green">Facilities/Specialists</div>
          <div class="xc-panel__body" style="font-size: 13px; line-height: 1.5">
            <div>[ Ph] <a href="#">Other: WELLS PHARMACY</a></div>
            <div>[ Ph] <a href="#">CVS: Burke Town Ctr</a></div>
            <div>[ Rad] <a href="#">MRI of Reston Radiology Associates</a></div>
            <div>[ Spec] <a href="#">PCP: Health For All</a></div>
          </div>
        </div>
      </div>

      <div class="xc-mid">
        <!-- ── Column 2: encounters / meds ───────────────────────────────── -->
        <div class="xc-col xc-col--mid">
          <div class="xc-panel">
            <div class="xc-panel__hdr xc-green">Encounters</div>
            <div class="xc-panel__body" style="min-height: 220px">
              <div v-for="e in encounters" :key="e.name" class="xc-row">
                <span class="xc-ico" :class="{ 'xc-ico--green': e.icon === 'video' }">{{
                  e.icon === 'video' ? '▶' : '+'
                }}</span>
                <a href="#" class="xc-row__name">{{ e.name }}</a>
                <span class="xc-row__who">{{ e.who }}</span>
                <span class="xc-row__date">{{ e.date }}</span>
              </div>
            </div>
            <div class="xc-panel__foot">Last in person: 08/07/2024 (Seen by Dr. Marcus Welby)</div>
          </div>

          <div class="xc-panel">
            <div class="xc-panel__hdr xc-red" style="padding: 0">
              <div class="xc-tabs">
                <span class="xc-tab" :class="{ 'xc-tab--on': tab === 'meds' }" @click="tab = 'meds'"
                  >Medications</span
                >
                <span
                  class="xc-tab"
                  :class="{ 'xc-tab--on': tab === 'supps' }"
                  @click="tab = 'supps'"
                  >Supplements</span
                >
                <span class="xc-tab">Pellets</span>
                <span class="xc-tab">IVs</span>
                <span v-if="tab === 'supps'" class="xc-tabs__add" @click="openPicker"
                  >+ Add Supplement</span
                >
              </div>
            </div>
            <div v-if="tab === 'meds'" class="xc-panel__body">
              <div
                v-for="m in meds"
                :key="m.name"
                class="xc-med"
                :class="{ 'xc-med--off': m.expired }"
              >
                <input type="checkbox" />
                <span class="xc-med__name"
                  ><span v-if="m.up" class="xc-up">↑</span><a href="#">{{ m.name }}</a></span
                >
                <span class="xc-med__dates">
                  <span v-if="m.expired" class="xc-expired">Just Expired! </span>
                  <template v-if="m.expired"
                    >({{ m.from }} - <span style="color: #ff6600; font-weight: 700">{{ m.to }}</span
                    >)</template
                  >
                  <template v-else
                    >{{ m.from }} - <b>{{ m.to }}</b></template
                  >
                </span>
              </div>
              <input class="xc-note" value="Test note" readonly />
            </div>
            <div v-else class="xc-panel__body xc-panel__body--scroll">
              <div v-if="loading" class="xc-supp__empty">Loading…</div>
              <div v-else-if="loadError" class="xc-supp__empty xc-supp__err">
                {{ loadError }}
              </div>
              <div v-else-if="rows.length === 0" class="xc-supp__empty">
                No supplements on file. Use + Add Supplement to start an order.
              </div>
              <div v-for="sp in rows" :key="sp.key" class="xc-supp">
                <input type="checkbox" />
                <span class="xc-supp__name"
                  ><a
                    href="#"
                    @click.prevent="
                      sp.status === 'draft' &&
                      openDetail(catalog.find((c) => c.id === sp.supplementId)!)
                    "
                    >{{ sp.name }}</a
                  >
                  <span v-if="sp.sig" class="xc-supp__sig">— {{ sp.sig }}</span></span
                >
                <router-link
                  v-if="sp.orderId !== null && sp.status !== 'draft'"
                  :to="`/orders/${sp.orderId}`"
                  class="xc-supp__status"
                  :class="{ 'xc-supp__status--paid': sp.status === 'paid' }"
                  >{{ (sp.status === 'paid' ? 'Paid ' : 'Sent ') + sp.date }}</router-link
                >
                <span v-else class="xc-supp__status xc-supp__status--draft">Draft</span>
                <span class="xc-supp__price">{{ formatCents(sp.cents) }}</span>
                <span
                  class="xc-supp__rm"
                  :class="{ 'xc-supp__rm--spacer': sp.status !== 'draft' }"
                  title="Remove from draft"
                  @click="sp.status === 'draft' && removeDraftLine(sp.supplementId)"
                  >✕</span
                >
              </div>
              <div v-if="draftSummary" class="xc-note xc-note--draft">
                {{ draftSummary }}
                <a
                  href="#"
                  :class="{ 'xc-disabled': !draft.canSend || busy }"
                  @click.prevent="sendDraft"
                  >Send to patient</a
                >
              </div>
              <div v-if="actionError && !modal" class="xc-supp__err">{{ actionError }}</div>
            </div>
            <div class="xc-panel__foot">
              <template v-if="tab === 'meds'"
                >Most Recent Update: August 7, 2024 by Dr. Marcus Welby</template
              >
              <template v-else-if="lastUpdate"
                >Most Recent Update: {{ lastUpdate }} by {{ history[0]?.provider.name }}</template
              >
              <template v-else>No orders yet</template>
            </div>
          </div>
        </div>

        <!-- ── Column 3: need to know / open orders ──────────────────────── -->
        <div class="xc-col xc-col--third">
          <div class="xc-panel">
            <div class="xc-panel__hdr xc-navy">Need to Know</div>
            <div class="xc-panel__body xc-ntk">
              <div class="xc-intake">MISSING INTAKE FORMS</div>
              The king of the gods, the ruler of Mount Olympus and the god of the sky, weather,
              thunder, law, order and fate. He is the youngest son of Kronos and Rhea, whom he
              overthrew, and brother-husband to Hera. In artwork, he was depicted as a regal man,
              mature with sturdy figure and dark beard. His symbols are the thunderbolt, royal
              sceptre, and eagle.
            </div>
            <div class="xc-panel__foot">Last Updated by Dr. P Doe - 10/14/2022</div>
          </div>

          <div class="xc-panel">
            <div class="xc-panel__hdr xc-dark">Open Orders</div>
            <div class="xc-panel__body" style="min-height: 250px">
              <div class="xc-order">
                <span class="xc-order__print"></span>Myers Cocktail from 08/07/2024<span
                  class="xc-order__x"
                  >[X]</span
                >
              </div>
              <div class="xc-order">
                <span class="xc-order__print"></span>Myers Cocktail from 07/05/2024<span
                  class="xc-order__x"
                  >[X]</span
                >
              </div>
              <div class="xc-order xc-order--gray">NO SOAP (Admin)<small>08/08/24</small></div>
              <div class="xc-med" style="border: 0">
                <input type="checkbox" /><span class="xc-med__name" style="color: #444"
                  >Complete cbc w/auto diff wbc</span
                ><span class="xc-chip xc-chip--blue">$</span
                ><span class="xc-chip xc-chip--rose">T</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Documents: spans the two middle columns ─────────────────── -->
        <div class="xc-docs-span">
          <div class="xc-panel">
            <div class="xc-panel__hdr xc-orange" style="padding: 0">
              <div class="xc-tabs">
                <span
                  v-for="t in docTabs"
                  :key="t[0]"
                  class="xc-tab"
                  :class="{ 'xc-tab--on': t[2] }"
                  >{{ t[0] }}<i v-if="t[1]">{{ t[1] }}</i></span
                >
              </div>
            </div>
            <div class="xc-panel__body">
              <div class="xc-docs__bar">
                <b>Unreviewed for {{ patient?.name ?? '…' }}</b>
                <span
                  ><input value="Search Documents" readonly /><select>
                    <option>Newest First</option>
                  </select></span
                >
              </div>
              <div class="xc-docs__grid">
                <div>
                  <div v-for="d in docs" :key="d.name" class="xc-doc">
                    <span v-if="d.flag" class="xc-flag">&#9660;</span>
                    <span v-if="d.person" class="xc-person"></span>
                    <a href="#" :style="d.flag ? 'color:#cc0100' : ''">{{ d.name }}</a>
                    <span class="xc-doc__size">{{ d.meta }}</span>
                    <span class="xc-doc__date">{{ d.date }}</span>
                  </div>
                </div>
                <div class="xc-keydocs">
                  <div class="xc-keydocs__hdr">&#9660; Key Documents</div>
                  <div class="xc-keydocs__row">
                    <span>06/21/24</span><span class="xc-person"></span
                    ><a href="#"><b>celiac disease</b></a>
                  </div>
                  <div class="xc-keydocs__row">
                    <span>02/29/24</span><span class="xc-person"></span
                    ><span class="xc-crit">LIPID PANEL, CBC (INCLUDES DIFF/PLT)</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="xc-panel__foot">
              Viewing Unreviewed files; Ordered by reverse chronological order
            </div>
          </div>
        </div>
      </div>

      <!-- ── Column 4: notes / allergies / vitals / billing ────────────── -->
      <div class="xc-col xc-col--right">
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-navy">Admin Notes</div>
          <div class="xc-panel__body xc-admin">
            Get new credit card info next visit. Only visible to practice.
          </div>
          <div class="xc-panel__foot">Last Updated by Dr. Marcus Welby - 07/02/2024</div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-navy">Social/Family Notes</div>
          <div class="xc-panel__body xc-social">
            Father: age: 82<br />history of high blood pressure<br />Mother: age: 81 this is a free
            text block
          </div>
          <div class="xc-panel__foot">Last Updated by Dr. Marcus Welby - 03/13/2024</div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-red">
            Allergy, <span style="color: #ff9900">Intolerance</span>,
            <span style="color: #000">Discont.</span>
          </div>
          <div class="xc-panel__body xc-allergy">
            <span style="color: #cc0100">Aspirin</span>, <span style="color: #cc0100">Apple</span>,
            <span style="color: #cc0100">pollen</span>, <span style="color: #336601">Grass</span>,
            <span style="color: #cc0100">shellfish</span>, <span style="color: #ff9900">Mold</span>
          </div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-pmhx">Past Med Hx</div>
          <div class="xc-panel__body xc-pm">
            Tension-type headache &nbsp;♦&nbsp; Hypothyroidism, unspecified &nbsp;♦&nbsp; Obesity,
            unspecified &nbsp;♦&nbsp; Hypertensive heart disease with heart failure &nbsp;♦&nbsp;
            Chronic fatigue &nbsp;♦&nbsp;
            <span class="n">Major depressive disorder, single episode, unspecified</span>
            &nbsp;♦&nbsp; Segmental and
          </div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-black">Patient Vitals</div>
          <div class="xc-panel__body xc-vitals">
            <div class="xc-vitals__row">
              <span><b>BP:</b> 120/80 @ 80b/m</span
              ><span
                ><b>Wt:</b> 150 &nbsp;<b>Ht:</b> 70 &nbsp;<span class="m">BMI: 21.5</span></span
              >
            </div>
            <div class="xc-vitals__row" style="padding-top: 10px">
              <span><b>1 - Temp</b> 98.0</span><span><b>A1c</b> <span class="r">8</span></span
              ><span
                ><b>Basal Metabolic Rate</b>
                <span class="m" style="font-style: normal">N/A</span></span
              >
            </div>
          </div>
          <div class="xc-panel__foot">Most Recent Update: 2024-08-07 13:56:03</div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-billing">
            Billing
            <small style="font-weight: 600; font-size: 12px"
              >(Subscription: &nbsp;<span style="color: #013365">12 month subscription</span>
              )</small
            >
          </div>
          <div class="xc-panel__body">
            <div class="xc-bal">BALANCE: <span>-$672.63</span></div>
            <div class="xc-led--clip">
              <div v-for="(l, i) in ledger" :key="i" class="xc-led">
                <span>{{ l.d }}</span>
                <b :class="{ cr: l.cr }" :style="l.plain ? 'color:#111' : ''">{{ l.n }}</b>
                <span
                  :class="l.cr ? 'cr-amt' : 'amt'"
                  :style="l.plain ? 'color:#8a8a8a;font-weight:400' : ''"
                  >{{ l.a }}</span
                >
              </div>
            </div>
          </div>
          <div class="xc-panel__foot">Last Manual Transaction: August 7, 2024</div>
        </div>
      </div>
    </div>

    <!-- ── Modal 1: picker (replica of "+ Add New Rx") ─────────────────── -->
    <template v-if="modal === 'pick'">
      <div class="xc-overlay" @click="modal = null"></div>
      <div class="xc-modal">
        <div class="xc-modal__hdr">
          + Add Supplement for {{ patient?.name ?? '…'
          }}<span class="xc-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xc-modal__body" style="position: relative">
          <div class="xc-pick">
            <div>
              <input
                v-model="query"
                class="xc-pick__search"
                placeholder="- type to search -"
                autofocus
                @keydown.enter.prevent="hovered && openDetail(hovered)"
                @keydown.down.prevent="picked = Math.min(picked + 1, matches.length - 1)"
                @keydown.up.prevent="picked = Math.max(picked - 1, 0)"
              />
              <div class="xc-pick__list">
                <div
                  v-for="(c, i) in matches"
                  :key="c.id"
                  class="xc-pick__row"
                  :class="{ 'xc-pick__row--on': i === picked }"
                  @mouseenter="picked = i"
                  @click="openDetail(c)"
                >
                  {{ c.name }}
                </div>
                <div v-if="matches.length === 0" class="xc-pick__hint">
                  No matches in the practice catalog.
                </div>
                <div v-else class="xc-pick__hint">
                  Matches are from the practice catalog. Products not listed here can be added under
                  Inventory.
                </div>
              </div>
            </div>
            <div class="xc-pick__help">
              Search the practice catalog by product name or SKU. Pick a supplement to set the
              patient's directions, quantity and price; the order is sent to the patient portal for
              payment.
              <div class="xc-pick__warn">
                Adding a supplement here creates a store order for the patient. Add supplements
                within a SOAP note if they are part of a documented plan.
              </div>
            </div>
          </div>
          <div v-if="hovered" class="xc-card">
            <b class="t">{{ hovered.name.toUpperCase() }}</b>
            <b>SKU:</b> {{ hovered.sku ?? '—' }}<br />
            <b>Default price:</b> {{ formatCents(hovered.default_price_cents) }}<br />
            <b>Your cost (COGS):</b> {{ formatCents(hovered.unit_cogs_cents) }}<br />
            <b>Margin at default:</b> {{ marginAtDefault(hovered) }} before platform fee<br />
            <b>On hand:</b> {{ hovered.inventory_count }}<br />
            <b
              v-if="draft.lines.some((l) => l.supplement_id === hovered!.id)"
              class="xc-card__draft"
              >Already on the draft order — opening it edits that line</b
            >
          </div>
        </div>
      </div>
    </template>

    <!-- ── Modal 2: detail (replica of "+ Complete Rx") ───────────────── -->
    <template v-if="modal === 'detail' && chosen">
      <div class="xc-overlay" @click="modal = null"></div>
      <div class="xc-modal" style="top: 110px">
        <div class="xc-modal__hdr">
          + Complete Supplement Order for {{ patient?.name ?? '…' }}
          <span class="xc-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xc-modal__body">
          <a href="#" class="xc-back" @click.prevent="openPicker">Back to Supplement Selector</a>
          <div class="xc-detail__title">
            {{ chosen.name.toUpperCase() }}
            <span v-if="chosen.sku" class="xc-detail__sku">( SKU: {{ chosen.sku }} )</span>
          </div>

          <fieldset class="xc-fs">
            <legend>Patient Sig:</legend>
            <div class="xc-fs__row">
              Take
              <select v-model="form.take">
                <option v-for="t in TAKE" :key="t">{{ t }}</option>
              </select>
              <select v-model="form.unit">
                <option v-for="u in UNITS" :key="u">{{ u }}</option>
              </select>
              <select v-model="form.freq">
                <option v-for="f in FREQ" :key="f">{{ f }}</option>
              </select>
              <span class="xc-fs__hint">Shown to the patient as: “{{ composedSig }}”</span>
            </div>
            <textarea
              v-model="form.note"
              placeholder="Other instructions to the patient"
            ></textarea>
          </fieldset>

          <fieldset class="xc-fs">
            <legend>
              Pricing &amp; Dispensing —
              <span style="font-weight: 400">Cerbo Supplement Store</span>
            </legend>
            <div class="xc-fs__row">
              Quantity
              <input
                v-model="form.qty"
                type="text"
                inputmode="numeric"
                style="width: 50px"
                :class="{ 'xc-bad': qty === null }"
              />
              &nbsp; Patient price $
              <input
                v-model="form.price"
                type="text"
                inputmode="decimal"
                style="width: 70px"
                :class="{ 'xc-bad': priceCents === null }"
                @input="onPriceInput"
              />
              &nbsp; or target margin
              <input
                v-model="form.margin"
                type="text"
                inputmode="decimal"
                style="width: 56px"
                @input="onMarginInput"
              />
              %
              <span class="xc-fs__hint">Default price pre-filled from the practice catalog</span>
            </div>
            <div v-if="detailSplit" class="xc-split">
              <div>
                Patient pays<b>{{ formatCents(detailSplit.total_cents) }}</b>
              </div>
              <div>
                Your cost (COGS)<b class="neg">−{{ formatCents(detailSplit.cogs_cents) }}</b>
              </div>
              <div>
                Platform fee (75 bps)<b class="neg">−{{ formatCents(detailSplit.fee_cents) }}</b>
              </div>
              <div>
                Your margin<b :class="{ neg: detailSplit.margin_cents < 0 }">{{
                  formatCents(detailSplit.margin_cents)
                }}</b>
              </div>
            </div>
            <div v-else class="xc-split xc-split--invalid">
              Enter a whole-number quantity and a price in dollars and cents to see the split.
            </div>
            <div v-if="detailSplit && detailSplit.margin_cents < 0" class="xc-supp__err">
              This price is below your cost. The order can still be sent.
            </div>
          </fieldset>

          <div class="xc-ack">
            <input v-model="form.ack" type="checkbox" />
            <span
              >I understand this order is placed through the in-house store: the patient pays the
              practice directly, and the margin and 75 bps platform fee are recorded on the order's
              ledger.</span
            >
          </div>

          <div v-if="actionError" class="xc-supp__err">{{ actionError }}</div>
          <div class="xc-btns">
            <button class="xc-btn" :disabled="!formValid || busy" @click="commit('close')">
              + Add to Order
            </button>
            <button class="xc-btn" :disabled="!formValid || busy" @click="commit('another')">
              + Add &amp; Add Another
            </button>
            <button class="xc-btn" :disabled="!formValid || busy" @click="commit('send')">
              + Add &amp; Send to Patient
            </button>
          </div>
        </div>
      </div>
    </template>

    <div class="xc-gutter"><span>0</span><span>0</span><span>0</span></div>
    <div class="xc-chat"><span>0</span><span>0</span></div>
  </div>
</template>
