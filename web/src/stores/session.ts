// Acting provider — the identity seam's client half. In Cerbo this would be the logged-in EHR
// user; here the demo sign-in (stores/login.ts) sets it and it is sent as `x-acting-provider`.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { setActingProvider } from '../api';

export const useSessionStore = defineStore('session', () => {
  const providerId = ref<number | null>(null);
  const providerName = ref<string>('');

  function setProvider(id: number, name: string): void {
    providerId.value = id;
    providerName.value = name;
    setActingProvider(id);
  }
  function clear(): void {
    providerId.value = null;
    providerName.value = '';
    setActingProvider(null);
  }

  return { providerId, providerName, setProvider, clear };
});
