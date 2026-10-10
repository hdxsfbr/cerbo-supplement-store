<script setup lang="ts">
// The patient portal frame (replica of docs/cerbo-ui-reference/portal-*.png): logo, white page,
// and the sidebar with greeting + navigation. Shared by the portal views and the checkout page,
// so paying an invoice happens inside the portal rather than on a separate page.
//
// The four wired entries deep-link with `?view=…`. Reached by capability token (/portal/:token)
// the links keep the token; reached through the demo sign-in (/portal) they don't need one.
import '../styles/portal-xp.css';
import { computed } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useLoginStore } from '../stores/login';

export type PortalSection = 'home' | 'supps' | 'msgs' | 'bills';

const props = defineProps<{
  /** Patient's full name; the greeting uses the first name. */
  name: string | null;
  /** Portal capability token when not signed in through the demo login. */
  token: string | null;
  active: PortalSection;
  badges?: Partial<Record<PortalSection, string | null>>;
}>();

const login = useLoginStore();
const router = useRouter();
const firstName = computed(() => props.name?.split(' ')[0] ?? '');
const base = computed(() => (props.token ? `/portal/${props.token}` : '/portal'));
function to(view: PortalSection) {
  return { path: base.value, query: { view } };
}

const NAV: {
  key: string;
  label: string;
  color: string;
  icon: string;
  view?: PortalSection;
  badge?: string;
}[] = [
  { key: 'home', label: 'Home', color: '#1e6f7c', icon: '⌂', view: 'home' },
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
function badgeFor(n: (typeof NAV)[number]): string | null {
  if (n.view && n.view !== 'home') return props.badges?.[n.view] ?? null;
  return n.badge ?? null;
}

function signOut(): void {
  if (login.isPatient) login.signOut();
  void router.push('/');
}
</script>

<template>
  <div class="xp">
    <div class="xp__wrap">
      <RouterLink class="xp__logo" :to="to('home')"
        ><img src="/cerbo-logo-dark.svg" alt="Cerbo"
      /></RouterLink>
      <div class="xp__page">
        <div class="xp__main">
          <slot />
        </div>
        <aside class="xp__side">
          <div class="xp-side__hi">Hi {{ firstName || 'there' }}!</div>
          <a href="#" class="xp-side__out" @click.prevent="signOut">Sign Out</a>
          <ul class="xp-nav">
            <li
              v-for="n in NAV"
              :key="n.key"
              :class="{ on: n.view === active && n.key !== 'home' }"
            >
              <component
                :is="n.view ? RouterLink : 'span'"
                v-bind="n.view ? { to: to(n.view) } : {}"
                class="xp-nav__link"
              >
                <span v-if="badgeFor(n)" class="xp-nav__badge">{{ badgeFor(n) }}</span>
                <span class="xp-nav__ic" :style="{ background: n.color }">{{ n.icon }}</span>
                <span>{{ n.label }}</span>
              </component>
            </li>
          </ul>
        </aside>
      </div>
    </div>
    <slot name="modals" />
  </div>
</template>
