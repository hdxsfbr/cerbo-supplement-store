<script setup lang="ts">
// The global Cerbo header (replica of docs/cerbo-ui-reference/) shared by every provider page:
// the chart and the supplement store. Cerbo's own items are static; "Supplements" is ours and
// carries the store's pages in a hover menu. Patient search appears only on the chart, where a
// patient is in context (store pages are practice-wide); the user chip is the sign-out menu.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useLoginStore } from '../stores/login';
import type { Patient } from '../types';

const route = useRoute();
const router = useRouter();
const login = useLoginStore();

const initials = computed(() => (login.account?.role === 'doctor' ? login.account.initials : ''));

const STORE = [
  { label: 'Orders', to: '/orders', match: /^\/orders(?!\/new)/ },
  { label: 'New order', to: '/orders/new', match: /^\/orders\/new/ },
  { label: 'Inventory', to: '/inventory', match: /^\/inventory/ },
  { label: 'Sales report', to: '/dashboard', match: /^\/dashboard/ },
];
const storeActive = computed(() => STORE.some((s) => s.match.test(route.path)));

// Patient search: only on the chart, mirroring the patient being viewed.
const onChart = computed(() => route.name === 'experimental-chart');
const patients = ref<Patient[]>([]);
onMounted(async () => {
  try {
    patients.value = (await api.patients()).patients;
  } catch {
    patients.value = [];
  }
});
const currentPatient = computed(() => (onChart.value ? String(route.query.patient ?? '') : ''));
function openChart(e: Event): void {
  const id = (e.target as HTMLSelectElement).value;
  if (id) void router.push({ name: 'experimental-chart', query: { patient: id } });
}

// User menu
const menu = ref(false);
function onDocClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('.xc-nav__user-wrap')) menu.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
function signOut(): void {
  menu.value = false;
  login.signOut();
  void router.push('/');
}
</script>

<template>
  <nav class="xc-shell xc-nav">
    <RouterLink class="xc-nav__logo" :to="{ name: 'experimental-chart' }" aria-label="Cerbo home">
      <img src="/cerbo-logo.svg" alt="Cerbo" />
      <span class="xc-nav__tag">Location/Department A</span>
    </RouterLink>
    <span class="xc-nav__item">Scheduling<span class="xc-badge">15</span></span>
    <span class="xc-nav__item">Admin</span>
    <span class="xc-nav__item">Reporting</span>
    <span class="xc-nav__item xc-nav__item--menu" :class="{ 'xc-nav__item--on': storeActive }">
      Supplements ▾
      <div class="xc-menu">
        <RouterLink
          v-for="s in STORE"
          :key="s.to"
          :to="s.to"
          class="xc-menu__item"
          :class="{ 'xc-menu__item--on': s.match.test(route.path) }"
          >{{ s.label }}</RouterLink
        >
      </div>
    </span>
    <span class="xc-nav__item"
      >Tasks<span class="xc-nav__circle">21</span><span class="xc-badge">21</span></span
    >
    <span class="xc-nav__item">Generate</span>
    <span class="xc-nav__item">My Links</span>
    <span class="xc-nav__item">Pt Portal</span>
    <span class="xc-nav__item">Settings</span>
    <span class="xc-nav__user-wrap">
      <button
        type="button"
        class="xc-nav__user"
        :title="login.account?.name"
        aria-haspopup="menu"
        :aria-expanded="menu"
        @click="menu = !menu"
      >
        &#128100; {{ initials }}
      </button>
      <div v-if="menu" class="xc-menu xc-menu--user" role="menu">
        <div class="xc-menu__who">
          <b>{{ login.account?.name }}</b>
          <span>Provider</span>
        </div>
        <button type="button" class="xc-menu__item" role="menuitem" @click="signOut">
          Sign out
        </button>
      </div>
    </span>
    <span class="xc-nav__help">?</span>
    <span class="xc-nav__note"></span>
    <select
      v-if="onChart"
      class="xc-nav__search"
      :value="currentPatient"
      aria-label="Search patients"
      @change="openChart"
    >
      <option value="" disabled>- Search Patients -</option>
      <option v-for="p in patients" :key="p.id" :value="String(p.id)">{{ p.name }}</option>
    </select>
  </nav>
</template>
