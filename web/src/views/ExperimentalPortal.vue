<script setup lang="ts">
// EXPERIMENTAL — a replica of Cerbo's patient portal (docs/cerbo-ui-reference/portal-*.png) with
// the store's patient side wired in: Secure Messages, My Bills and Payments (balance, statement,
// invoices, pay) and My Supplements come from GET /api/portal/:token for the signed-in patient.
// Account details and the self-reported "Add To Your Supplement List" modal stay static.
// Route: /experimental-portal.
import '../styles/portal-xp.css';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { formatCents } from '../money';
import { useLoginStore } from '../stores/login';
import type { PortalView } from '../types';

const login = useLoginStore();
const router = useRouter();
const firstName = computed(() => login.account?.name.split(' ')[0] ?? '');
function signOut(): void {
  login.signOut();
  void router.push('/');
}

// ── Data ─────────────────────────────────────────────────────────────────────────────────
const data = ref<PortalView | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  const a = login.account;
  if (!a || a.role !== 'patient') return;
  loading.value = true;
  loadError.value = null;
  try {
    const session = await api.portalSignIn(a.id);
    data.value = await api.portal(session.token);
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const providerName = computed(() => data.value?.provider.name ?? 'your provider');
const unread = computed(() => data.value?.messages.filter((m) => !m.read_at).length ?? 0);
const unpaid = computed(
  () => data.value?.invoices.filter((i) => i.status === 'awaiting_payment') ?? [],
);
const balance = computed(() => data.value?.balance_due_cents ?? 0);

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '');
}
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}
function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function stamp(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(iso)}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
}
function fullDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── My Supplements: every line the practice has ordered for this patient ─────────────────
interface SuppRow {
  key: string;
  name: string;
  sig: string;
  date: string;
  paid: boolean;
  payPath: string;
}
const suppRows = computed<SuppRow[]>(() =>
  (data.value?.invoices ?? []).flatMap((inv) =>
    inv.items.map((i, n) => ({
      key: `${inv.id}-${n}`,
      name: i.name,
      sig: i.sig ?? 'As directed',
      date:
        inv.status === 'paid'
          ? `Paid ${shortDate(inv.paid_at)}`
          : `Ordered ${shortDate(inv.sent_at)}`,
      paid: inv.status === 'paid',
      payPath: pathOf(inv.checkout_url),
    })),
  ),
);

// ── Statement: charges at send time, credits at payment time, running balance ────────────
interface StmtRow {
  date: string;
  type: string;
  amount: string;
  balance: number;
  kind: 'charge' | 'credit';
}
const statement = computed<StmtRow[]>(() => {
  const inv = [...(data.value?.invoices ?? [])].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const events: { at: string; type: string; cents: number; kind: 'charge' | 'credit' }[] = [];
  for (const o of inv) {
    for (const i of o.items)
      events.push({ at: o.sent_at, type: i.name, cents: i.line_total_cents, kind: 'charge' });
    if (o.status === 'paid' && o.paid_at)
      events.push({
        at: o.paid_at,
        type: `Credit / Payment (+)${o.card ? ` ${o.card.brand} ••${o.card.last4}` : ''}`,
        cents: o.total_cents,
        kind: 'credit',
      });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  let bal = 0;
  return events.map((e) => {
    bal += e.kind === 'charge' ? e.cents : -e.cents;
    return {
      date: fullDate(e.at),
      type: e.type,
      amount: (e.kind === 'credit' ? '+ ' : '') + formatCents(e.cents),
      balance: bal,
      kind: e.kind,
    };
  });
});

// ── Navigation ───────────────────────────────────────────────────────────────────────────
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
  { key: 'msgs', label: 'Secure Messages', color: '#2e7d1b', icon: '✉', view: 'msgs' },
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
function badgeFor(n: (typeof nav)[number]): string | null {
  if (n.key === 'msgs') return unread.value > 0 ? String(unread.value) : null;
  if (n.key === 'bills') return unpaid.value.length > 0 ? String(unpaid.value.length) : null;
  return n.badge ?? null;
}
function go(n: (typeof nav)[number]): void {
  if (n.view) view.value = n.view;
}

// Patient-reported supplements (static replica of Cerbo's lookup; not part of the store).
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
</script>

<template>
  <div class="xp">
    <div class="xp__wrap">
      <a class="xp__logo" href="#" @click.prevent="view = 'home'"
        ><img src="/cerbo-logo-dark.svg" alt="Cerbo"
      /></a>
      <div class="xp__page">
        <div class="xp__main">
          <!-- ── Home / My Account Details (static) ─────────────────────── -->
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
                <div>
                  <label>Email</label><input :value="login.account?.email ?? ''" readonly />
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

          <!-- ── My Supplements (store orders) ──────────────────────────── -->
          <template v-else-if="view === 'supps'">
            <h1>My Supplements</h1>
            <div class="xp-card">
              <div class="xp-card__leaf">❧</div>
              <div class="xp-center" style="margin-top: 36px">
                <button class="xp-btn">🕓 View My Daily Supplement Regimen</button>
              </div>
              <div class="xp-card__title">My Supplements</div>
              <div v-if="loading" class="xp-muted">Loading…</div>
              <div v-else-if="loadError" class="xp-muted xp-err">{{ loadError }}</div>
              <div v-else-if="suppRows.length === 0" class="xp-muted">
                {{ providerName }} has not ordered any supplements for you yet.
              </div>
              <table v-else class="xp-table">
                <thead>
                  <tr>
                    <th>Supplement</th>
                    <th>Directions</th>
                    <th>Relevant Dates</th>
                    <th style="text-align: center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in suppRows" :key="s.key">
                    <td>
                      <RouterLink :to="s.payPath">{{ s.name }}</RouterLink>
                    </td>
                    <td>{{ s.sig }}</td>
                    <td>{{ s.date }}</td>
                    <td style="text-align: center">
                      <RouterLink v-if="!s.paid" :to="s.payPath" class="xp-btn xp-btn--sm"
                        >Pay Now</RouterLink
                      >
                      <template v-else>
                        <span class="xp-act xp-act--x">✕</span
                        ><span class="xp-act xp-act--r">⟳</span>
                      </template>
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

          <!-- ── Secure Messages (portal notifications) ────────────────── -->
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
            <div v-if="loading" class="xp-muted">Loading…</div>
            <div v-else-if="loadError" class="xp-muted xp-err">{{ loadError }}</div>
            <div v-else-if="(data?.messages.length ?? 0) === 0" class="xp-muted xp-center">
              No messages yet.
            </div>
            <div v-for="m in data?.messages ?? []" :key="m.id" class="xp-msg">
              <div class="xp-msg__hdr">
                <div><b>From:</b> {{ providerName }} ➔ Me</div>
                <div>{{ stamp(m.created_at) }}</div>
              </div>
              <div class="xp-msg__body">
                <div class="xp-msg__subject">{{ m.subject }}</div>
                <div class="xp-msg__text">{{ m.body }}</div>
                <div class="xp-msg__foot">
                  <RouterLink
                    v-if="m.link && m.order_status === 'awaiting_payment'"
                    :to="pathOf(m.link)"
                    class="xp-btn"
                    >Pay Now $</RouterLink
                  >
                  <RouterLink v-else-if="m.link" :to="pathOf(m.link)" class="xp-btn xp-btn--outline"
                    >View Receipt</RouterLink
                  >
                  <button class="xp-btn xp-btn--outline" style="margin-left: 8px">Reply ✈</button>
                </div>
              </div>
            </div>
          </template>

          <!-- ── My Bills and Payments (invoices) ───────────────────────── -->
          <template v-else>
            <h1>My Bills and Payments</h1>
            <p class="lead">
              If you have any questions about the information shown here, please use the
              <a href="#" @click.prevent="view = 'msgs'">secure message portal</a> to contact us.
            </p>
            <div class="xp-balance" :class="{ 'xp-balance--zero': balance === 0 }">
              Current Balance: <span class="amt">{{ formatCents(balance) }}</span>
              <RouterLink
                v-if="unpaid.length > 0"
                :to="pathOf(unpaid[unpaid.length - 1]!.checkout_url)"
                class="xp-btn xp-btn--red"
                >Make Payment $</RouterLink
              >
            </div>
            <div v-if="loadError" class="xp-muted xp-err">{{ loadError }}</div>
            <h2>Billing Options</h2>
            <div class="xp-tiles">
              <div class="xp-tile">
                <div class="xp-tile__ic" style="background: #f2b61c">✚</div>
                <h3>Add Payment Method</h3>
                <template v-if="data?.payment_method">
                  <div class="xp-tile__card">
                    <span class="xp-visa">{{ data.payment_method.brand.toUpperCase() }}</span
                    ><span>************{{ data.payment_method.last4 }}</span>
                  </div>
                  <i>Last used card</i>
                </template>
                <i v-else>No card on file</i>
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
                <p>
                  View or print
                  <a href="#" @click.prevent="modal = 'inv'">invoices and receipts</a>
                </p>
                <button class="xp-btn" @click="modal = 'inv'">View Invoices</button>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Sidebar ───────────────────────────────────────────────────── -->
        <aside class="xp__side">
          <div class="xp-side__hi">Hi {{ firstName }}!</div>
          <select class="xp-side__switch" @change="signOut">
            <option>Switch Account</option>
            <option>Sign out</option>
          </select>
          <ul class="xp-nav">
            <li
              v-for="n in nav"
              :key="n.key"
              :class="{ on: n.view === view && n.key !== 'home' }"
              @click="go(n)"
            >
              <span v-if="badgeFor(n)" class="xp-nav__badge">{{ badgeFor(n) }}</span>
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
          Your Billing Statement for {{ providerName }}
          <span class="xp-modal__close" @click="modal = null">✕</span>
        </div>
        <div class="xp-modal__body">
          <p>
            Below is your history of supplement charges from and payments to
            {{ providerName }} in chronological order. Charges appear when an order is sent to you
            and payments when you pay it in the portal.
          </p>
          <div v-if="statement.length === 0" class="xp-muted">No charges or payments yet.</div>
          <div v-else class="xp-stmt__scroll">
            <table class="xp-stmt">
              <thead>
                <tr>
                  <th>Service Date</th>
                  <th>Charge Type</th>
                  <th>Patient</th>
                  <th class="r">Amount</th>
                  <th class="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in statement" :key="i" :class="{ credit: r.kind === 'credit' }">
                  <td>{{ r.date }}</td>
                  <td>{{ r.type }}</td>
                  <td>{{ login.account?.name }}</td>
                  <td class="r">{{ r.amount }}</td>
                  <td class="r" :class="r.balance > 0 ? 'neg' : 'pos'">
                    {{ formatCents(r.balance) }}
                  </td>
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
            Select from the available invoices below. Unpaid invoices open the secure payment page;
            paid ones open the receipt.
          </p>
          <div v-if="(data?.invoices.length ?? 0) === 0" class="xp-muted">No invoices yet.</div>
          <ul v-else class="xp-inv">
            <li v-for="inv in data?.invoices ?? []" :key="inv.id">
              <span class="xp-inv__ic">▤</span>
              <RouterLink :to="pathOf(inv.checkout_url)">
                {{ inv.status === 'paid' ? 'Receipt' : 'Invoice' }}: Supplement order #{{
                  inv.id
                }}
                ({{ inv.item_count }} item{{ inv.item_count === 1 ? '' : 's' }},
                {{ formatCents(inv.total_cents) }}) — {{ longDate(inv.sent_at) }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
