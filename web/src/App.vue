<script setup lang="ts">
// Root layout switch: provider routes get the Cerbo chart chrome (dark page, top nav, acting
// provider switcher = identity seam); patient routes get the plain portal layout.
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { SEEDED_PROVIDERS, useSessionStore } from './stores/session';

const route = useRoute();
const session = useSessionStore();
const surface = computed(() => route.meta.surface ?? 'provider');

function onProviderChange(e: Event): void {
  session.setProvider(Number((e.target as HTMLSelectElement).value));
  // Simplest correct behaviour for a demo "re-login": reload the current provider route.
  window.location.assign('/orders/new');
}
</script>

<template>
  <div v-if="surface === 'provider'" class="cerbo-page">
    <nav class="cerbo-nav">
      <RouterLink to="/orders/new" class="cerbo-nav__logo" aria-label="Cerbo home">
        <img src="/cerbo-logo.svg" alt="Cerbo" />
      </RouterLink>
      <RouterLink to="/orders/new" class="cerbo-nav__item" active-class="cerbo-nav__item--active">
        Supplement Store
      </RouterLink>
      <RouterLink to="/dashboard" class="cerbo-nav__item" active-class="cerbo-nav__item--active">
        Reporting
      </RouterLink>
      <RouterLink to="/inventory" class="cerbo-nav__item" active-class="cerbo-nav__item--active">
        Inventory
      </RouterLink>
      <span class="cerbo-nav__spacer" />
      <label class="cerbo-nav__acting">
        <span class="cerbo-muted">Acting as</span>
        <select class="cerbo-select" :value="session.providerId" @change="onProviderChange">
          <option v-for="p in SEEDED_PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
    </nav>
    <main class="cerbo-main">
      <RouterView />
    </main>
  </div>
  <RouterView v-else-if="surface === 'bare'" />
  <div v-else class="portal-page">
    <RouterView />
  </div>
</template>

<style scoped>
/* Cerbo's logo sits straight on the slate header: white wordmark, coloured mark (no tile). */
.cerbo-nav__logo {
  display: inline-flex;
  align-items: center;
  margin-right: 16px;
  line-height: 0;
}
.cerbo-nav__logo img {
  height: 26px;
  width: auto;
  display: block;
}
.cerbo-nav__spacer {
  flex: 1;
}
.cerbo-nav__acting {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cerbo-nav__acting .cerbo-muted {
  color: #e9edf2;
}
.cerbo-main {
  padding: 12px;
  max-width: 1280px;
  margin: 0 auto;
}
</style>
