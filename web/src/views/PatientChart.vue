<script setup lang="ts">
// The patient chart — a replica of Cerbo's (docs/cerbo-ui-reference/) with the
// supplement store embedded where Cerbo keeps its Rx flow. The Supplements tab is the
// patient's supplement LIST (clinical: what they take); orders are started from it and
// completed on the order page. Patient requests from the portal land here too. DECISIONS #17.
// Only the Supplements tab and its modals are wired to the API; the rest of the chart is static.
// Route: /chart (under the shared header, components/CerboNav.vue).
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '../api';
import { useLoginStore } from '../stores/login';
import { formatCents, formatBps, marginPercentBps } from '../money';
import type { OrderRequest, Patient, PatientSupplement, Supplement } from '../types';

// The acting provider comes from the demo login (identity seam); the patient being viewed is
// chosen from the header's patient search and kept in the URL (?patient=<id>) so reloads stick.
const login = useLoginStore();
const route = useRoute();
const router = useRouter();
const providerName = computed(() => login.account?.name ?? '');

const patient = ref<Patient | null>(null);
const firstName = computed(() => patient.value?.name.split(' ')[0] ?? '');
// The provider's other patients stand in for Cerbo's Relationships panel (one seeded cast).
const others = ref<Patient[]>([]);
const providerShort = computed(() => {
  const n = login.account?.name ?? '';
  const parts = n.replace(/^Dr\.\s*/, '').split(' ');
  return parts.length > 1 ? `${parts[0]![0]}. ${parts[parts.length - 1]}` : n;
});
const catalog = ref<Supplement[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadChart(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const [pts, cat] = await Promise.all([api.patients(), api.supplements()]);
    catalog.value = cat.supplements;
    const wanted = Number(route.query.patient);
    patient.value = pts.patients.find((x) => x.id === wanted) ?? pts.patients[0] ?? null;
    // The URL is the source of truth for the patient in context (the header mirrors it), so a
    // defaulted patient is written back; the watcher below ignores this no-op change.
    if (patient.value && patient.value.id !== wanted) {
      await router.replace({ query: { ...route.query, patient: String(patient.value.id) } });
    }
    others.value = pts.patients.filter((x) => x.id !== patient.value?.id);
    modal.value = null;
    tab.value = route.query.tab === 'supps' ? 'supps' : 'meds';
    selected.value = [];
    await loadList();
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(loadChart);
watch(
  () => route.query.patient,
  (q) => {
    if (Number(q) !== patient.value?.id) void loadChart();
  },
);

// ── Supplements tab: the patient's list + their open requests ────────────────────────────
const tab = ref<'meds' | 'supps'>('meds');
const list = ref<PatientSupplement[]>([]);
const requests = ref<OrderRequest[]>([]);
const selected = ref<number[]>([]);
const busy = ref(false);
const actionError = ref<string | null>(null);

async function loadList(): Promise<void> {
  if (!patient.value) {
    list.value = [];
    requests.value = [];
    return;
  }
  const r = await api.patientSupplements(patient.value.id);
  list.value = r.supplements;
  requests.value = r.requests;
  const active = new Set(r.supplements.filter((x) => x.status === 'active').map((x) => x.id));
  selected.value = selected.value.filter((id) => active.has(id));
}

const activeRows = computed(() => list.value.filter((r) => r.status === 'active'));
const pastRows = computed(() => list.value.filter((r) => r.status !== 'active'));
const openRequests = computed(() => requests.value.filter((r) => r.status === 'requested'));
const lastUpdate = computed(() => {
  const iso = list.value[0]?.created_at;
  return iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
});

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}
function orderLabel(row: PatientSupplement): string {
  const o = row.latest_order;
  if (!o) return '';
  if (o.status === 'paid') return `Paid ${shortDate(o.paid_at)}`;
  if (o.status === 'awaiting_payment') return `Sent ${shortDate(o.sent_at)}`;
  return 'In draft';
}
function toggle(id: number): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}

/** Wraps an API action: one in flight at a time, errors surface in the tab, list reloads. */
async function act(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    await fn();
    await loadList();
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : (err as Error).message;
  } finally {
    busy.value = false;
  }
}

/** Start an order from the selected rows (or a request) and continue on the order page. */
function createOrder(from: { patient_supplement_ids?: number[]; request_id?: number }): void {
  const p = patient.value;
  if (!p) return;
  void act(async () => {
    const view = await api.createOrder(p.id, from);
    await router.push(`/orders/${view.id}`);
  });
}
function discontinue(row: PatientSupplement): void {
  void act(async () => {
    await api.patchPatientSupplement(row.id, { status: 'discontinued' });
  });
}
function restore(row: PatientSupplement): void {
  void act(async () => {
    await api.patchPatientSupplement(row.id, { status: 'active' });
  });
}
function decline(req: OrderRequest): void {
  const note = window.prompt('Message to the patient (optional):', '');
  if (note === null) return;
  void act(async () => {
    await api.declineRequest(req.id, note.trim() || null);
  });
}

// ── Modal 1: picker (the practice catalog) ───────────────────────────────────────────────
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
function onList(s: Supplement): boolean {
  return activeRows.value.some((r) => r.supplement_id === s.id);
}
function openPicker(): void {
  query.value = '';
  picked.value = 0;
  actionError.value = null;
  modal.value = 'pick';
}

// ── Modal 2: directions (Patient Sig) → add to the list ──────────────────────────────────
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
const form = ref({ take: '1', unit: 'capsule(s)', freq: 'once daily', note: '' });

function guessUnit(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('softgel')) return 'softgel(s)';
  if (n.includes('tablet')) return 'tablet(s)';
  if (n.includes('powder') || n.includes('scoop')) return 'scoop(s)';
  if (n.includes('drop') || n.includes('liquid')) return 'dropper(s)';
  return 'capsule(s)';
}
function openDetail(s: Supplement): void {
  chosen.value = s;
  form.value = { take: '1', unit: guessUnit(s.name), freq: 'once daily', note: '' };
  actionError.value = null;
  modal.value = 'detail';
}
const composedSig = computed(() => {
  const f = form.value;
  const base = `Take ${f.take} ${f.unit} ${f.freq}`;
  const note = f.note.trim();
  return note ? `${base}. ${note}` : base;
});
function addToList(then: 'close' | 'another'): void {
  const p = patient.value;
  const s = chosen.value;
  if (!p || !s) return;
  void act(async () => {
    await api.addPatientSupplement(p.id, s.id, composedSig.value);
    tab.value = 'supps';
    if (then === 'another') openPicker();
    else modal.value = null;
  });
}

const initials = computed(() => (login.account?.role === 'doctor' ? login.account.initials : ''));
const encounters = computed(() =>
  [
    { icon: 'plus', name: 'Functional Med Visit', date: '08/07/2024' },
    { icon: 'plus', name: 'Annual Wellness', date: '08/06/2024' },
    { icon: 'video', name: 'Follow Up', date: '08/06/2024' },
    { icon: 'plus', name: 'New Patient', date: '08/06/2024' },
    { icon: 'video', name: 'IV Injection', date: '07/16/2024' },
  ].map((e) => ({ ...e, who: initials.value })),
);
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
    <div class="xc-grid">
      <!-- ── Column 1: patient rail ─────────────────────────────────────── -->
      <div class="xc-col xc-col--rail">
        <div class="xc-photo">
          <img v-if="patient?.id === 1" src="/chart/zeus.jpg" alt="" />
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
            <div>
              <b>EM:</b> <a href="#">{{ patient?.email ?? '—' }}</a>
            </div>
            <div><b>Grp Account:</b> <a href="#">ABC Corp</a></div>
            <div>
              <b>Provider:</b>
              <select>
                <option>{{ providerShort }}</option>
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
              <li v-for="(o, i) in others" :key="o.id">
                <RouterLink :to="{ name: 'chart', query: { patient: String(o.id) } }">{{
                  o.name
                }}</RouterLink>
                - <i>{{ i === 0 ? 'emer. contact' : 'family' }}</i> &#128101;
              </li>
              <li v-if="others.length === 0"><i>No relationships on file</i></li>
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
            <div class="xc-panel__foot">
              Last in person: 08/07/2024 (Seen by {{ providerName }})
            </div>
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
                  >Supplements<span v-if="openRequests.length" class="xc-tab__badge">{{
                    openRequests.length
                  }}</span></span
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
              <div v-else-if="loadError" class="xc-supp__empty xc-supp__err">{{ loadError }}</div>
              <template v-else>
                <div v-for="r in openRequests" :key="r.id" class="xc-req">
                  <div>
                    <b>Patient request</b> · {{ shortDate(r.created_at) }} ·
                    {{ r.items.map((i) => i.name).join(', ') }}
                    <i v-if="r.note">— “{{ r.note }}”</i>
                  </div>
                  <div class="xc-req__act">
                    <RouterLink v-if="r.order_id" :to="`/orders/${r.order_id}`"
                      >Open draft order</RouterLink
                    >
                    <a v-else href="#" @click.prevent="createOrder({ request_id: r.id })"
                      >Create order</a
                    >
                    <a href="#" @click.prevent="decline(r)">Decline</a>
                  </div>
                </div>
                <div v-if="activeRows.length === 0" class="xc-supp__empty">
                  No supplements on this patient’s list. Use + Add Supplement.
                </div>
                <div v-for="row in activeRows" :key="row.id" class="xc-supp">
                  <input
                    type="checkbox"
                    :checked="selected.includes(row.id)"
                    :title="`Select ${row.name} for an order`"
                    @change="toggle(row.id)"
                  />
                  <span class="xc-supp__name"
                    >{{ row.name }}
                    <span v-if="row.sig" class="xc-supp__sig">— {{ row.sig }}</span>
                    <span v-if="row.added_by === 'patient'" class="xc-supp__self"
                      >patient-reported</span
                    ></span
                  >
                  <RouterLink
                    v-if="row.latest_order"
                    :to="`/orders/${row.latest_order.id}`"
                    class="xc-supp__status"
                    :class="{
                      'xc-supp__status--paid': row.latest_order.status === 'paid',
                      'xc-supp__status--draft': row.latest_order.status === 'draft',
                    }"
                    >{{ orderLabel(row) }}</RouterLink
                  >
                  <span class="xc-supp__rm" title="Discontinue" @click="discontinue(row)">✕</span>
                </div>
                <div v-if="pastRows.length" class="xc-supp__past">
                  Discontinued:
                  <span v-for="row in pastRows" :key="row.id"
                    >{{ row.name }} <a href="#" @click.prevent="restore(row)">restore</a></span
                  >
                </div>
                <div class="xc-note xc-note--draft">
                  <span>{{ selected.length }} selected</span>
                  <a
                    href="#"
                    :class="{ 'xc-disabled': selected.length === 0 || busy }"
                    @click.prevent="createOrder({ patient_supplement_ids: selected })"
                    >Create supplement order</a
                  >
                </div>
                <div v-if="actionError && !modal" class="xc-supp__err">{{ actionError }}</div>
              </template>
            </div>
            <div class="xc-panel__foot">
              <template v-if="tab === 'meds'"
                >Most Recent Update: August 7, 2024 by {{ providerName }}</template
              >
              <template v-else-if="lastUpdate"
                >Most Recent Update: {{ lastUpdate }} by {{ providerName }}</template
              >
              <template v-else>No supplements on file</template>
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
          <div class="xc-panel__foot">Last Updated by {{ providerName }} - 07/02/2024</div>
        </div>
        <div class="xc-panel">
          <div class="xc-panel__hdr xc-navy">Social/Family Notes</div>
          <div class="xc-panel__body xc-social">
            Father: age: 82<br />history of high blood pressure<br />Mother: age: 81 this is a free
            text block
          </div>
          <div class="xc-panel__foot">Last Updated by {{ providerName }} - 03/13/2024</div>
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
                <div v-else class="xc-pick__hint">Matches are from the practice catalog.</div>
              </div>
            </div>
            <div class="xc-pick__help">
              Search the practice catalog by product name or SKU. Pick a supplement and set the
              patient's directions; it goes on their supplement list. Select list items to start an
              order.
              <div class="xc-pick__warn">
                This adds to the patient's supplement list only. Pricing and sending happen when you
                create an order from the list.
              </div>
            </div>
          </div>
          <div v-if="hovered" class="xc-card">
            <b class="t">{{ hovered.name.toUpperCase() }}</b>
            <b>SKU:</b> {{ hovered.sku ?? '—' }}<br />
            <b>Default price:</b> {{ formatCents(hovered.default_price_cents) }}<br />
            <b>Your cost (COGS):</b> {{ formatCents(hovered.unit_cogs_cents) }}<br />
            <b>Margin at default:</b> {{ marginAtDefault(hovered) }} before platform fee<br />
            <b v-if="onList(hovered)" class="xc-card__draft">Already on this patient's list</b>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Modal 2: directions (replica of "+ Complete Rx", Patient Sig only) ─── -->
    <template v-if="modal === 'detail' && chosen">
      <div class="xc-overlay" @click="modal = null"></div>
      <div class="xc-modal" style="top: 110px">
        <div class="xc-modal__hdr">
          + Add {{ chosen.name }} for {{ patient?.name ?? '…' }}
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

          <div v-if="actionError" class="xc-supp__err">{{ actionError }}</div>
          <div class="xc-btns">
            <button class="xc-btn" :disabled="busy" @click="addToList('close')">
              + Add to List
            </button>
            <button class="xc-btn" :disabled="busy" @click="addToList('another')">
              + Add &amp; Add Another
            </button>
          </div>
        </div>
      </div>
    </template>

    <div class="xc-gutter"><span>0</span><span>0</span><span>0</span></div>
    <div class="xc-chat"><span>0</span><span>0</span></div>
  </div>
</template>
