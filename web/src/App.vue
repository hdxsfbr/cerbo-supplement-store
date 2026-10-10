<script setup lang="ts">
// Root layout switch: provider routes (chart + supplement store) render under the shared Cerbo
// header (components/CerboNav.vue); `bare` routes (sign-in, patient portal, checkout) bring
// their own chrome.
import { computed } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import CerboNav from './components/CerboNav.vue';
import './styles/chart.css';

const route = useRoute();
const surface = computed(() => route.meta.surface ?? 'provider');
const full = computed(() => route.meta.full === true);
</script>

<template>
  <div v-if="surface === 'provider'" class="cerbo-page">
    <CerboNav />
    <main :class="full ? '' : 'cerbo-main'">
      <RouterView />
    </main>
  </div>
  <RouterView v-else />
</template>
