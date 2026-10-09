<script setup lang="ts">
// EXPERIMENTAL — a static, non-functional replica of Cerbo's patient chart, built to match
// docs/cerbo-ui-reference/chart-storylane-full.png as closely as possible. Nothing here is wired
// to the API; it is the canvas we will later embed the supplement store into. Route: /experimental-chart.
import '../styles/chart.css';

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
                <span class="xc-tab xc-tab--on">Medications</span>
                <span class="xc-tab">Supplements</span>
                <span class="xc-tab">Pellets</span>
                <span class="xc-tab">IVs</span>
              </div>
            </div>
            <div class="xc-panel__body">
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
            <div class="xc-panel__foot">Most Recent Update: August 7, 2024 by Dr. Marcus Welby</div>
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

    <div class="xc-gutter"><span>0</span><span>0</span><span>0</span></div>
    <div class="xc-chat"><span>0</span><span>0</span></div>
  </div>
</template>
