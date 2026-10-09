<script setup lang="ts">
// EXPERIMENTAL — a static, non-functional replica of Cerbo's patient chart, built to match
// docs/cerbo-ui-reference/chart-storylane-full.png as closely as possible. Nothing here is wired
// to the API; it is the canvas we will later embed the supplement store into. Route: /experimental-chart.
import '../styles/chart.css';
import { computed, ref } from 'vue';
import {
  formatCents,
  previewSplit,
  priceForMarginBps,
  marginPercentBps,
  formatBps,
} from '../money';

// Supplements tab + modals (static). `tab` switches the list; `modal` shows the picker or the
// detail form; `picked` is the highlighted catalog row.
const tab = ref<'meds' | 'supps'>('meds');
const modal = ref<null | 'pick' | 'detail'>(null);
const picked = ref(2);
const catalog = [
  {
    name: 'Omega-3 Fish Oil 1000 mg (120 softgels)',
    sku: 'OMG-1000-120',
    strength: '1000MG',
    form: 'SOFTGEL,ORAL',
    unit: 'BOTTLE (120 softgels)',
    cogs: 1850,
    price: 3200,
    stock: 119,
    take: '2',
    freq: 'QD (once a day)',
    days: '60',
  },
  {
    name: 'Vitamin D3 5000 IU (90 caps)',
    sku: 'VD3-5000-090',
    strength: '5000IU',
    form: 'CAP,ORAL',
    unit: 'BOTTLE (90 caps)',
    cogs: 400,
    price: 850,
    stock: 199,
    take: '1',
    freq: 'QD (once a day)',
    days: '90',
  },
  {
    name: 'Magnesium Glycinate 400 mg (120 caps)',
    sku: 'MAG-GLY-120',
    strength: '400MG',
    form: 'CAP,ORAL',
    unit: 'BOTTLE (120 caps)',
    cogs: 950,
    price: 1900,
    stock: 150,
    take: '2',
    freq: 'QHS (at bedtime)',
    days: '60',
  },
  {
    name: 'Probiotic 50B CFU (30 caps)',
    sku: 'PRO-50B-030',
    strength: '50B CFU',
    form: 'CAP,ORAL',
    unit: 'BOTTLE (30 caps)',
    cogs: 2400,
    price: 4500,
    stock: 60,
    take: '1',
    freq: 'QD (once a day)',
    days: '30',
  },
  {
    name: 'Methylated B-Complex (60 caps)',
    sku: 'MBC-060',
    strength: '—',
    form: 'CAP,ORAL',
    unit: 'BOTTLE (60 caps)',
    cogs: 1300,
    price: 2400,
    stock: 90,
    take: '1',
    freq: 'QAM (morning)',
    days: '60',
  },
  {
    name: 'Curcumin Phytosome 500 mg (60 caps)',
    sku: 'CUR-PHY-060',
    strength: '500MG',
    form: 'CAP,ORAL',
    unit: 'BOTTLE (60 caps)',
    cogs: 2200,
    price: 3800,
    stock: 45,
    take: '1',
    freq: 'BID (twice a day)',
    days: '30',
  },
];
const sel = computed(() => catalog[picked.value]!);
const split = computed(() =>
  previewSplit([
    { quantity: 1, unit_price_cents: sel.value.price, unit_cogs_cents: sel.value.cogs },
  ]),
);
const marginPct = computed(() => {
  const bps = marginPercentBps(sel.value.price, sel.value.price - sel.value.cogs);
  return bps === null ? '—' : (bps / 100).toFixed(1);
});
const marginLabel = computed(() => {
  const bps = marginPercentBps(sel.value.price, sel.value.price - sel.value.cogs);
  return bps === null ? '—' : formatBps(bps);
});
void priceForMarginBps;
const supps = [
  {
    name: 'Omega-3 Fish Oil 1000 mg',
    sig: '2 softgels daily with food',
    price: '$32.00',
    status: 'paid',
    date: '10/08/24',
  },
  {
    name: 'Vitamin D3 5000 IU',
    sig: '1 cap QD',
    price: '$10.00',
    status: 'paid',
    date: '10/08/24',
  },
  {
    name: 'Magnesium Glycinate 400 mg',
    sig: '2 caps QHS',
    price: '$19.00',
    status: 'due',
    date: '10/09/24',
  },
  {
    name: 'Probiotic 50B CFU',
    sig: '1 cap QD, empty stomach',
    price: '$45.00',
    status: 'draft',
    date: '',
  },
];

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
      <span class="xc-nav__user">&#128100; M.W.</span>
      <span class="xc-nav__help">?</span>
      <span class="xc-nav__note"></span>
      <input class="xc-nav__search" value="- Search Patients -" readonly />
    </nav>

    <div class="xc-grid">
      <!-- ── Column 1: patient rail ─────────────────────────────────────── -->
      <div class="xc-col xc-col--rail">
        <div class="xc-photo">
          <img src="/experimental/zeus.jpg" alt="" />
          <div class="xc-photo__icons"><span></span><span>&#9998;</span></div>
          <div class="xc-photo__cap">
            <span class="xc-photo__sex">&#9792;</span>
            <b>Zeus King</b> <i>("Jupiter")</i><br />
            #21 - <b style="font-size: 13px">54 Years</b> (01/08/1970)
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
                <span v-if="tab === 'supps'" class="xc-tabs__add" @click="modal = 'pick'"
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
            <div v-else class="xc-panel__body">
              <div v-for="sp in supps" :key="sp.name" class="xc-supp">
                <input type="checkbox" />
                <span class="xc-supp__name"
                  ><a href="#">{{ sp.name }}</a>
                  <span class="xc-supp__sig">— {{ sp.sig }}</span></span
                >
                <span
                  class="xc-supp__status"
                  :class="{
                    'xc-supp__status--paid': sp.status === 'paid',
                    'xc-supp__status--draft': sp.status === 'draft',
                  }"
                  >{{
                    sp.status === 'paid'
                      ? 'Paid ' + sp.date
                      : sp.status === 'due'
                        ? 'Sent ' + sp.date
                        : 'Draft'
                  }}</span
                >
                <span class="xc-supp__price">{{ sp.price }}</span>
              </div>
              <input class="xc-note" value="Draft order: 1 line · $45.00 · not yet sent" readonly />
            </div>
            <div class="xc-panel__foot">
              Most Recent Update: {{ tab === 'meds' ? 'August 7, 2024' : 'October 9, 2026' }} by Dr.
              Marcus Welby
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
                <b>Unreviewed for Zeus King</b>
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
          + Add Supplement for Zeus King<span class="xc-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xc-modal__body" style="position: relative">
          <div class="xc-pick">
            <div>
              <input class="xc-pick__search" placeholder="- type to search -" readonly />
              <div class="xc-pick__list">
                <div
                  v-for="(c, i) in catalog"
                  :key="c.sku"
                  class="xc-pick__row"
                  :class="{ 'xc-pick__row--on': i === picked }"
                  @mouseenter="picked = i"
                  @click="modal = 'detail'"
                >
                  {{ c.name }}
                </div>
                <div class="xc-pick__hint">
                  Above matches are from the practice catalog. To search the full supplier list, add
                  '+' to your search.
                </div>
              </div>
            </div>
            <div class="xc-pick__help">
              Please search for the supplement you are seeking. You may type in as many words as
              you'd like (including only the first few letters of a word), including brand name,
              active ingredient, form (i.e. 'Capsule'), strength (i.e. '400mg'), etc.
              <div class="xc-pick__warn">
                Adding a supplement here creates a store order for the patient. Add supplements
                within a SOAP note if they are part of a documented plan.
              </div>
            </div>
          </div>
          <div class="xc-card">
            <b class="t">{{ sel.name.toUpperCase() }}</b>
            <b>SKU:</b> {{ sel.sku }}<br />
            <b>Strength:</b> {{ sel.strength }}<br />
            <b>Form:</b> {{ sel.form }}<br />
            <b>Default price:</b> {{ formatCents(sel.price) }}<br />
            <b>Your cost (COGS):</b> {{ formatCents(sel.cogs) }}<br />
            <b>Margin at default:</b> {{ marginLabel }} before platform fee<br />
            <b>On hand:</b> {{ sel.stock }}<br />
            <b>Over the Counter?</b> Yes
          </div>
        </div>
      </div>
    </template>

    <!-- ── Modal 2: detail (replica of "+ Complete Rx") ───────────────── -->
    <template v-if="modal === 'detail'">
      <div class="xc-overlay" @click="modal = null"></div>
      <div class="xc-modal" style="top: 110px">
        <div class="xc-modal__hdr">
          + Complete Supplement Order for Zeus King
          <select class="xc-modal__profile">
            <option>Use Protocol</option>
            <option>Adrenal support</option>
            <option>Gut repair</option>
          </select>
          <span class="xc-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xc-modal__body">
          <a href="#" class="xc-back" @click.prevent="modal = 'pick'"
            >Back to Supplement Selector</a
          >
          <div class="xc-detail__title">
            {{ sel.name.toUpperCase() }} ( Strength:
            <input type="text" :value="sel.strength" readonly /> )
          </div>

          <fieldset class="xc-fs">
            <legend>Patient Sig:</legend>
            <div class="xc-fs__row">
              Take
              <select>
                <option>2</option>
              </select>
              <select>
                <option>CAP,ORAL</option>
              </select>
              <select>
                <option>ORAL</option>
              </select>
              <select>
                <option>QHS (at bedtime)</option>
              </select>
              ( <input type="checkbox" /> <i>or as needed</i>)
              <span class="xc-fs__hint">Freetext Only</span>
            </div>
            <textarea placeholder="Other instructions to the patient"></textarea>
          </fieldset>

          <fieldset class="xc-fs">
            <legend>
              Pricing &amp; Dispensing —
              <span style="font-weight: 400">Cerbo Supplement Store</span>
            </legend>
            <div class="xc-fs__row">
              Quantity <input type="text" value="1" readonly style="width: 50px" />
              <select>
                <option>BOTTLE (120 caps)</option>
              </select>
              &nbsp; Patient price $
              <input type="text" value="19.00" readonly style="width: 70px" /> &nbsp; or target
              margin <input type="text" :value="marginPct" readonly style="width: 56px" /> %
              <span class="xc-fs__hint">Default price pre-filled from the practice catalog</span>
            </div>
            <div class="xc-split">
              <div>
                Patient pays<b>{{ formatCents(split.total_cents) }}</b>
              </div>
              <div>
                Your cost (COGS)<b class="neg">−{{ formatCents(split.cogs_cents) }}</b>
              </div>
              <div>
                Platform fee (75 bps)<b class="neg">−{{ formatCents(split.fee_cents) }}</b>
              </div>
              <div>
                Your margin<b :class="{ neg: split.margin_cents < 0 }">{{
                  formatCents(split.margin_cents)
                }}</b>
              </div>
            </div>
            <div class="xc-fs__row" style="margin-top: 10px">
              Days supply
              <input type="text" :value="sel.days" readonly style="width: 50px" /> &nbsp; Refills (
              <input type="text" value="0" readonly style="width: 40px" /> )
              <label style="margin-left: auto"
                ><input type="checkbox" checked /> Send payment link to patient portal</label
              >
            </div>
          </fieldset>

          <fieldset class="xc-fs">
            <legend>Provider Notes</legend>
            <div class="xc-fs__row">
              <label><input type="checkbox" /> <b>This is an ongoing supplement</b></label>
              <label><input type="checkbox" /> <b>Warn me when this supply runs out</b></label>
            </div>
            <textarea
              placeholder="Private notes about this order (not shown to the patient)"
            ></textarea>
            <div style="text-align: right; font-size: 12px; color: #013365; margin-top: 4px">
              Associated diagnoses with this order
            </div>
          </fieldset>

          <div class="xc-ack">
            <input type="checkbox" checked />
            <span
              >I understand this order is placed through the in-house store: the patient pays the
              practice directly, and the margin and 75 bps platform fee are recorded on the order's
              ledger.</span
            >
          </div>

          <div class="xc-btns">
            <button class="xc-btn" @click="modal = null">+ Add to Order</button>
            <button class="xc-btn" @click="modal = 'pick'">+ Add &amp; Add Another</button>
            <button class="xc-btn" @click="modal = null">+ Add &amp; Send to Patient</button>
            <button class="xc-btn xc-btn--gray">Add &amp; Print</button>
          </div>
        </div>
      </div>
    </template>

    <div class="xc-gutter"><span>0</span><span>0</span><span>0</span></div>
    <div class="xc-chat"><span>0</span><span>0</span></div>
  </div>
</template>
