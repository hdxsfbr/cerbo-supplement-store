// Demo login — who is signed in for the experimental chart / portal surfaces. Two hard-coded
// doctors and two hard-coded patients (all from 003_seed.sql). A doctor login sets the acting
// provider on the identity seam; a patient login carries the patient's id for the portal.
// Persisted so a reload keeps the session. Not an auth system: in Cerbo this is the EHR login.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSessionStore } from './session';

export type Account =
  | { role: 'doctor'; id: number; name: string; email: string; initials: string }
  | { role: 'patient'; id: number; name: string; email: string; provider_id: number };

export const ACCOUNTS: Account[] = [
  { role: 'doctor', id: 1, name: 'Dr. Marcus Welby', email: 'welby@demo.cer.bo', initials: 'M.W.' },
  {
    role: 'doctor',
    id: 2,
    name: 'Dr. Sarah Anderson',
    email: 'anderson@demo.cer.bo',
    initials: 'S.A.',
  },
  { role: 'patient', id: 1, name: 'Zeus King', email: 'zeus@olympus.example', provider_id: 1 },
  {
    role: 'patient',
    id: 4,
    name: 'Apollo Ray Sun',
    email: 'apollo@olympus.example',
    provider_id: 2,
  },
];

const STORAGE_KEY = 'cerbo-store.login';

export const useLoginStore = defineStore('login', () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const account = ref<Account | null>(ACCOUNTS.find((a) => `${a.role}:${a.id}` === stored) ?? null);
  const session = useSessionStore();
  if (account.value?.role === 'doctor') session.setProvider(account.value.id);

  const isDoctor = computed(() => account.value?.role === 'doctor');
  const isPatient = computed(() => account.value?.role === 'patient');

  function signIn(email: string): Account | null {
    const a = ACCOUNTS.find((x) => x.email === email) ?? null;
    account.value = a;
    if (!a) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    localStorage.setItem(STORAGE_KEY, `${a.role}:${a.id}`);
    if (a.role === 'doctor') session.setProvider(a.id);
    return a;
  }

  function signOut(): void {
    account.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  return { account, isDoctor, isPatient, signIn, signOut };
});
