<script setup lang="ts">
// EXPERIMENTAL — a static replica of Cerbo's patient portal, built to match
// docs/cerbo-ui-reference/portal-*.png. Nothing here is wired to the API yet; it is the canvas
// the store's patient side (messages, invoices, pay) will later live in. Route: /experimental-portal.
import '../styles/portal-xp.css';
import { ref } from 'vue';

type View = 'home' | 'supps' | 'msgs' | 'bills';
const view = ref<View>('home');
const modal = ref<null | 'add' | 'stmt' | 'inv'>(null);

const nav: {
  key: string;
  label: string;
  color: string;
  icon: string;
  badge?: string;
  view?: View;
}[] = [
  { key: 'home', label: 'Home', color: '#1e6f7c', icon: '⌂' },
  { key: 'acct', label: 'My Account Details', color: '#3a8fd1', icon: '👤', view: 'home' },
  { key: 'msgs', label: 'Secure Messages', color: '#2e7d1b', icon: '✉', badge: '35', view: 'msgs' },
  { key: 'appt', label: 'My Appointments', color: '#4a6c72', icon: '▦' },
  { key: 'bills', label: 'Invoices & Payment', color: '#3b8ed1', icon: '▤', view: 'bills' },
  { key: 'forms', label: 'Forms & Questionnaires', color: '#6b2a6b', icon: '▣', badge: '!' },
  { key: 'labs', label: 'Labs & Documents', color: '#2ab5a8', icon: '✚' },
  { key: 'vitals', label: 'My Vitals', color: '#d5307a', icon: '♥' },
  { key: 'meds', label: 'My Medications', color: '#8b2a7e', icon: '◐' },
  { key: 'supps', label: 'My Supplements', color: '#7bc24d', icon: '❧', view: 'supps' },
  { key: 'allergy', label: 'My Allergies', color: '#e24a2b', icon: '⊗' },
  { key: 'vacc', label: 'My Vaccine Record', color: '#e24a2b', icon: '💉' },
  { key: 'pharm', label: 'My Pharmacies', color: '#f5b930', icon: '⚗' },
  { key: 'care', label: 'My Care Team', color: '#4aa3df', icon: '👥' },
  { key: 'visit', label: 'My Visit Summaries', color: '#f47b22', icon: '✚', badge: '!' },
  { key: 'video', label: 'Video Education', color: '#7573b4', icon: '🏛' },
];
function go(n: (typeof nav)[number]): void {
  if (n.view) view.value = n.view;
}

const supps = [
  { name: 'Vitamin X', strength: 'N/A' },
  { name: 'Vitamin D', strength: '5000' },
  { name: 'Vitamin C', strength: '1000MG' },
  { name: 'Magnesium', strength: '100MG' },
];
const lookup = [
  'Curcumin',
  'Vitamin E',
  'Tocopherols',
  'ProOmega 2000',
  'Nordic Naturals ProEPA',
  'Arctic Omega Lemon Liquid',
  'Nordic Naturals Omega 3 Gummies',
  'Nordic Naturals ProOmega Junior',
  'Zero Sugar Melatonin Gummies 60 Gummies',
];

const msgs = [
  { me: true, when: '07/24/24, 12:07 pm', subject: 'Re: CA TEST', text: 'khnfiknfk;w' },
  { me: false, when: '07/24/24, 12:06 pm', subject: 'CA TEST', text: 'dekggeogtenlg' },
  { me: false, when: '07/23/24, 1:37 pm', subject: 'Re: Question', text: 'gg' },
  {
    me: true,
    when: '07/23/24, 1:37 pm',
    note: 'You indicated "no reply is necessary" for this message',
    subject: 'Question',
    text: 'I have a rash.',
  },
];

const stmt = [
  {
    d: '06/07/2024',
    t: 'Credit / Payment (+)',
    payor: '',
    amt: '+ $266.67',
    bal: '$266.67',
    c: 'credit',
  },
  {
    d: '06/08/2024',
    t: 'Credit / Payment (+)',
    payor: '',
    amt: '+ $140.00',
    bal: '$266.67',
    c: 'dim hl',
  },
  {
    d: '07/01/2024',
    t: 'Credit / Payment (+)',
    payor: '',
    amt: '+ $700.00',
    bal: '$966.67',
    c: 'credit',
  },
  {
    d: '07/02/2024',
    t: 'Office Visit - 10 Min',
    payor: '',
    amt: '$67.00',
    bal: '$899.67',
    c: 'pos',
  },
  { d: '07/05/2024', t: 'Vitamin C', payor: '', amt: '$20.00', bal: '$879.67', c: 'pos' },
  {
    d: '07/05/2024',
    t: 'Myers Cocktail IV',
    payor: 'Group: ABC Corp',
    amt: '$200.00',
    bal: '$679.67',
    c: 'dim',
  },
  { d: '07/05/2024', t: 'Dutch Complete', payor: '', amt: '$499.00', bal: '$180.67', c: 'pos' },
  {
    d: '07/05/2024',
    t: 'Credit / Payment (+)',
    payor: 'Group: ABC Corp',
    amt: '+ $499.00',
    bal: '$679.67',
    c: 'dim',
  },
  {
    d: '07/08/2024',
    t: 'Credit / Payment (+)',
    payor: 'Group: ABC Corp',
    amt: '+ $8000.00',
    bal: '$679.67',
    c: 'dim hl',
  },
  { d: '07/09/2024', t: '3 month program', payor: '', amt: '$500.00', bal: '$179.67', c: 'pos' },
  {
    d: '07/09/2024',
    t: 'ND EST 1 Prolong 55 - 69 1 Unit',
    payor: '',
    amt: '$475.00',
    bal: '$295.33',
    c: 'neg',
  },
  { d: '07/09/2024', t: 'Vitamin C', payor: '', amt: '$18.00', bal: '$313.33', c: 'neg' },
  { d: '07/09/2024', t: 'Test Pellet', payor: '', amt: '$0.00', bal: '$313.33', c: 'neg' },
  {
    d: '07/09/2024',
    t: 'Office Visit - 10 Min',
    payor: '',
    amt: '$67.00',
    bal: '$380.33',
    c: 'neg',
  },
  { d: '07/11/2024', t: 'Test Pellet', payor: '', amt: '$0.00', bal: '$380.33', c: 'neg' },
  { d: '07/12/2024', t: 'B12', payor: '', amt: '$25.00', bal: '$405.33', c: 'neg' },
  {
    d: '07/12/2024',
    t: 'Credit / Payment (+)',
    payor: 'Group: ABC Corp',
    amt: '+ $25.00',
    bal: '$380.33',
    c: 'dim',
  },
  {
    d: '07/12/2024',
    t: 'Myers Cocktail IV',
    payor: 'Group: ABC Corp',
    amt: '$180.00',
    bal: '$560.33',
    c: 'dim',
  },
  {
    d: '07/12/2024',
    t: 'Myers Cocktail IV',
    payor: 'Group: ABC Corp',
    amt: '$180.00',
    bal: '$740.33',
    c: 'dim',
  },
  { d: '07/12/2024', t: 'IV Vitamin Therapy', payor: '', amt: '$112.50', bal: '$852.83', c: 'neg' },
  { d: '07/12/2024', t: 'IV Vitamin Therapy', payor: '', amt: '$112.50', bal: '$965.33', c: 'neg' },
  { d: '07/15/2024', t: 'Vitamin B12', payor: '', amt: '$12.00', bal: '$977.33', c: 'neg' },
  { d: '08/07/2024', t: 'B12', payor: '', amt: '$25.00', bal: '$1002.33', c: 'neg' },
  { d: '08/08/2024', t: 'Vitamin B12', payor: '', amt: '$12.00', bal: '$1014.33', c: 'neg' },
];
const invoices = [
  'Receipt for Services: Jul 12, 2024',
  'Invoice: Jun 5, 2024',
  'Invoice: Services rendered: Apr 11, 2024',
  'Receipt for Services: Apr 9, 2024',
  'Receipt for test visit (Jan 8, 2024)',
];
</script>

<template>
  <div class="xp">
    <div class="xp__wrap">
      <a class="xp__logo" href="#" @click.prevent="view = 'home'"
        ><img src="/cerbo-logo-dark.svg" alt="Cerbo"
      /></a>
      <div class="xp__page">
        <div class="xp__main">
          <!-- ── Home / My Account Details ───────────────────────────────── -->
          <template v-if="view === 'home'">
            <h1>My Account Details</h1>
            <p class="lead">
              Please help us keep our records up to date by regularly reviewing and updating your
              personal information. Requested changes pending our review are shown in
              <span class="orange">orange</span>. To update core information, such as your name and
              date of birth, please <a href="#">contact our office directly.</a>
            </p>
            <h2>Basic Contact Information</h2>
            <div class="xp-form">
              <div class="xp-form__grid">
                <div><label>Home Address</label><input value="6 Summit Ln" readonly /></div>
                <div><label>Home Address (suite/apt)</label><input readonly /></div>
                <div><label>City</label><input value="Olympus" readonly /></div>
                <div><label>State / Province</label><input value="OR" readonly /></div>
                <div><label>Zip / Postal Code</label><input value="97203" readonly /></div>
                <div>
                  <label>Time Zone</label>
                  <select>
                    <option>America/Los Angeles</option>
                  </select>
                </div>
                <div>
                  <label>Preferred Contact Phone Number</label>
                  <select>
                    <option>Home Phone</option>
                  </select>
                </div>
              </div>
              <div class="xp-form__grid xp-form__grid--4">
                <div><label>Home Phone</label><input value="555 099 1222" readonly /></div>
                <div><label>Work Phone</label><input readonly /></div>
                <div><label>Mobile Phone</label><input value="5552120155" readonly /></div>
                <div><label>Other Phone</label><input readonly /></div>
              </div>
              <div class="xp-form__grid">
                <div>
                  <label>Race</label>
                  <select>
                    <option>White</option>
                  </select>
                </div>
                <div>
                  <label>Ethnicity</label>
                  <select>
                    <option>not Hispanic or Latino</option>
                  </select>
                </div>
                <div>
                  <label>Pronouns</label>
                  <select>
                    <option>he/him/his</option>
                  </select>
                </div>
                <div>
                  <label>Describe your gender identity</label
                  ><input placeholder="Female" readonly />
                </div>
              </div>
              <div class="xp-center"><button class="xp-btn">Save Account Details 💾</button></div>
            </div>
            <h2>Contact Preferences</h2>
            <div class="xp-form">
              <div class="xp-prefs">
                <div>
                  Non-medical automated notifications (such as informational or educational emails,
                  news about the practice, promotions, or marketing emails)
                </div>
                <div>
                  <b>Email</b>
                  <select>
                    <option>Yes</option>
                  </select>
                </div>
                <div>
                  <b>SMS/Text</b>
                  <select>
                    <option>No</option>
                  </select>
                </div>
              </div>
              <div class="xp-center"><button class="xp-btn">Save Preferences 💾</button></div>
            </div>
          </template>

          <!-- ── My Supplements ─────────────────────────────────────────── -->
          <template v-else-if="view === 'supps'">
            <h1>My Supplements</h1>
            <div class="xp-card">
              <div class="xp-card__leaf">❧</div>
              <div class="xp-center" style="margin-top: 36px">
                <button class="xp-btn">🕓 View My Daily Supplement Regimen</button>
              </div>
              <div class="xp-card__title">My Supplements</div>
              <table class="xp-table">
                <thead>
                  <tr>
                    <th>Supplement</th>
                    <th>Strength</th>
                    <th>Relevant Dates</th>
                    <th style="text-align: center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in supps" :key="s.name">
                    <td>
                      <a href="#">{{ s.name }}</a>
                    </td>
                    <td>{{ s.strength }}</td>
                    <td>N/A</td>
                    <td style="text-align: center">
                      <span class="xp-act xp-act--x">✕</span><span class="xp-act xp-act--r">⟳</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="xp-check">
                <input type="checkbox" /> I am not currently taking any supplements
              </div>
              <div class="xp-card__title">Past Supplements</div>
              <div class="xp-muted">
                We have no discontinued or expired supplements on record for you.
              </div>
            </div>
            <div class="xp-center">
              <button class="xp-btn xp-btn--light" @click="modal = 'add'">
                Add a New Supplement ➕
              </button>
            </div>
          </template>

          <!-- ── Secure Messages ────────────────────────────────────────── -->
          <template v-else-if="view === 'msgs'">
            <h1>Secure Messages</h1>
            <p class="lead">
              Secure messaging is a secure, encrypted alternative to email for electronic
              communications with our office. Electronic communications are for
              <u>non-urgent requests</u>. We will try to respond to your message within 1-2 business
              days.
            </p>
            <div class="xp-center" style="margin: 20px 0 30px">
              <button class="xp-btn">Send a Secure Message ✈</button>
            </div>
            <div v-for="(m, i) in msgs" :key="i" class="xp-msg" :class="{ 'xp-msg--me': m.me }">
              <div class="xp-msg__hdr">
                <div>
                  <b>From:</b>
                  <template v-if="m.me"> Me ➔ Dr. Marcus Welby</template>
                  <template v-else> Dr. Marcus Welby ➔ Me</template>
                  <small v-if="m.note">{{ m.note }}</small>
                </div>
                <div>{{ m.when }}</div>
              </div>
              <div class="xp-msg__body">
                <div class="xp-msg__subject">{{ m.subject }}</div>
                <div class="xp-msg__text">{{ m.text }}</div>
                <div class="xp-msg__foot">
                  <button class="xp-btn xp-btn--outline">
                    {{ m.me ? 'Send Follow-up' : 'Reply' }} ✈
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- ── My Bills and Payments ──────────────────────────────────── -->
          <template v-else>
            <h1>My Bills and Payments</h1>
            <p class="lead">
              If you have any questions about the information shown here, please use the
              <a href="#" @click.prevent="view = 'msgs'">secure message portal</a> to contact us.
            </p>
            <div class="xp-balance">
              Current Balance: <span class="amt">-$2726.58</span>
              <button class="xp-btn xp-btn--red">Make Payment $</button>
            </div>
            <h2>Billing Options</h2>
            <div class="xp-tiles">
              <div class="xp-tile">
                <div class="xp-tile__ic" style="background: #f2b61c">✚</div>
                <h3>Add Payment Method</h3>
                <div class="xp-tile__card">
                  <span class="xp-visa">VISA</span><span>************9990</span>
                </div>
                <i>Expires: (12/30)</i>
                <p style="margin-top: 14px">
                  Add a new preferred card for future payments (your provider may charge this card)
                </p>
                <button class="xp-btn">Add Payment Method</button>
              </div>
              <div class="xp-tile">
                <div class="xp-tile__ic" style="background: #2ca3cf">▤</div>
                <h3>My Statements</h3>
                <p>Review your billing history, with a full list of charges and payments</p>
                <button class="xp-btn" @click="modal = 'stmt'">View Statement</button>
              </div>
              <div class="xp-tile">
                <div class="xp-tile__ic" style="background: #35bfb3">▤</div>
                <h3>My Invoices</h3>
                <p>View or print <a href="#">requested invoices, receipts, or estimates</a></p>
                <button class="xp-btn" @click="modal = 'inv'">View Invoices</button>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Sidebar ───────────────────────────────────────────────────── -->
        <aside class="xp__side">
          <div class="xp-side__hi">Hi Zeus!</div>
          <select class="xp-side__switch">
            <option>Switch Account</option>
          </select>
          <ul class="xp-nav">
            <li
              v-for="n in nav"
              :key="n.key"
              :class="{ on: n.view === view && n.key !== 'home' }"
              @click="go(n)"
            >
              <span v-if="n.badge" class="xp-nav__badge">{{ n.badge }}</span>
              <div class="xp-nav__ic" :style="{ background: n.color }">{{ n.icon }}</div>
              <span>{{ n.label }}</span>
            </li>
          </ul>
        </aside>
      </div>
    </div>

    <!-- ── Modals ──────────────────────────────────────────────────────── -->
    <template v-if="modal === 'add'">
      <div class="xp-overlay" @click="modal = null"></div>
      <div class="xp-modal xp-modal--md" style="top: 410px">
        <div class="xp-modal__hdr">
          <div class="xp-modal__ic" style="background: #2ca3cf">+</div>
          Add To Your Supplement List
          <span class="xp-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xp-modal__body" style="position: relative">
          <p>
            Use the search bar below to find your supplement. If there are several similar potential
            matches, choose the one that seems like the best fit. If you cannot find a match, click
            where indicated to add a new item.
          </p>
          <div class="xp-lookup">
            <label>Look up supplement</label>
            <input value="natural" readonly />
          </div>
          <div class="xp-lookup__dd">
            <div v-for="l in lookup" :key="l" :class="{ on: l.includes('Omega 3') }">{{ l }}</div>
            <div class="new">
              + Add New<small>None of the above? Click here to add yours.</small>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-if="modal === 'stmt'">
      <div class="xp-overlay" @click="modal = null"></div>
      <div class="xp-modal">
        <div class="xp-modal__hdr">
          <div class="xp-modal__ic" style="background: #2ca3cf">▤</div>
          Your Billing Statement for Demo Practice
          <span class="xp-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xp-modal__body">
          <p>
            Below is your history of charges from and payments to Demo Practice in chronological
            order. Pending charges are also included in this list, so if you see unexpected charges
            dating from the last week please wait for the transaction to be finalized before
            contacting our office.
          </p>
          <div class="xp-stmt__scroll">
            <table class="xp-stmt">
              <thead>
                <tr>
                  <th>Service Date</th>
                  <th>Charge Type</th>
                  <th>Patient</th>
                  <th>Payor</th>
                  <th class="r">Amount</th>
                  <th class="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in stmt" :key="i" :class="r.c.replace(/pos|neg/, '')">
                  <td>{{ r.d }}</td>
                  <td>{{ r.t }}</td>
                  <td>Zeus King</td>
                  <td>{{ r.payor }}</td>
                  <td class="r">{{ r.amt }}</td>
                  <td class="r" :class="r.c.includes('dim') ? '' : r.c">{{ r.bal }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="xp-center" style="margin-top: 16px">
            <button class="xp-btn">Print This Statement 🖶</button>
          </div>
        </div>
      </div>
    </template>

    <template v-if="modal === 'inv'">
      <div class="xp-overlay" @click="modal = null"></div>
      <div class="xp-modal xp-modal--sm">
        <div class="xp-modal__hdr">
          <div class="xp-modal__ic" style="background: #2ca3cf">▤</div>
          Saved Invoices
          <span class="xp-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xp-modal__body">
          <p>
            Select from the available invoices below. Invoices must be generated by your provider,
            so if you don't see the invoice you're looking for please use the
            <a href="#">secure message form</a> or an email to request it.
          </p>
          <ul class="xp-inv">
            <li v-for="inv in invoices" :key="inv">
              <span class="xp-inv__ic">▤</span><a href="#">{{ inv }}</a>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
