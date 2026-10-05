// Acting provider — the identity seam's client half. In Cerbo this would be the logged-in EHR
// user; here it is a selectable seeded provider sent as `x-acting-provider`. Persisted so a
// reload keeps the same "login".

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, setActingProvider } from '../api';

const STORAGE_KEY = 'cerbo-store.acting-provider';

// Seeded providers (003_seed.sql). There is no /api/providers endpoint on purpose: in production
// this list does not exist — the EHR session tells us who is acting.
export const SEEDED_PROVIDERS = [
  { id: 1, name: 'Dr. Marcus Welby' },
  { id: 2, name: 'Dr. Sarah Anderson' },
] as const;

export const useSessionStore = defineStore('session', () => {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  const providerId = ref<number>(Number.isInteger(stored) && stored > 0 ? stored : 1);
  const providerName = ref<string>(
    SEEDED_PROVIDERS.find((p) => p.id === providerId.value)?.name ?? 'Provider',
  );
  setActingProvider(providerId.value);

  async function refreshName(): Promise<void> {
    const res = await api.patients();
    providerName.value = res.provider.name;
  }

  function setProvider(id: number): void {
    providerId.value = id;
    providerName.value = SEEDED_PROVIDERS.find((p) => p.id === id)?.name ?? `Provider #${id}`;
    localStorage.setItem(STORAGE_KEY, String(id));
    setActingProvider(id);
  }

  return { providerId, providerName, setProvider, refreshName };
});
