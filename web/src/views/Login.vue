<script setup lang="ts">
// Demo sign-in: pick one of the hard-coded accounts. Doctors land on the chart, patients on
// the portal. Route: /.
import '../styles/portal-xp.css';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ACCOUNTS, useLoginStore } from '../stores/login';

const router = useRouter();
const route = useRoute();
const login = useLoginStore();
const email = ref(login.account?.email ?? ACCOUNTS[0]!.email);
const doctors = ACCOUNTS.filter((a) => a.role === 'doctor');
const patients = ACCOUNTS.filter((a) => a.role === 'patient');

function submit(): void {
  const a = login.signIn(email.value);
  if (!a) return;
  const next = typeof route.query.next === 'string' ? route.query.next : null;
  void router.push(a.role === 'doctor' ? (next ?? '/experimental-chart') : '/portal');
}
</script>

<template>
  <div class="xp xp-login">
    <form class="xp-login__box" @submit.prevent="submit">
      <img class="xp-login__logo" src="/cerbo-logo-dark.svg" alt="Cerbo" />
      <label class="xp-login__label" for="login-email">Email</label>
      <select id="login-email" v-model="email" class="xp-login__select">
        <optgroup label="Providers">
          <option v-for="a in doctors" :key="a.email" :value="a.email">
            {{ a.email }} — {{ a.name }}
          </option>
        </optgroup>
        <optgroup label="Patients">
          <option v-for="a in patients" :key="a.email" :value="a.email">
            {{ a.email }} — {{ a.name }}
          </option>
        </optgroup>
      </select>
      <label class="xp-login__label" for="login-pw">Password</label>
      <input id="login-pw" class="xp-login__input" type="password" value="••••••••" readonly />
      <button class="xp-btn xp-login__btn" type="submit">Sign In</button>
    </form>
  </div>
</template>
