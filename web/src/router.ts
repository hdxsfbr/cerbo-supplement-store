import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useLoginStore } from './stores/login';

// Two surfaces (constitution VI): `provider` routes render inside the Cerbo chart chrome,
// `patient` routes render in the clean portal layout. See App.vue.
declare module 'vue-router' {
  interface RouteMeta {
    surface: 'provider' | 'patient' | 'bare';
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'login',
    component: () => import('./views/Login.vue'),
    meta: { surface: 'bare', title: 'Sign in' },
  },
  {
    path: '/orders/new',
    name: 'order-new',
    component: () => import('./views/OrderBuilder.vue'),
    meta: { surface: 'provider', title: 'Supplement Store' },
  },
  {
    path: '/orders/:id(\\d+)',
    name: 'order',
    component: () => import('./views/OrderBuilder.vue'),
    props: (route) => ({ orderId: Number(route.params.id) }),
    meta: { surface: 'provider', title: 'Supplement Store' },
  },
  {
    path: '/orders/:id(\\d+)/audit',
    name: 'order-audit',
    component: () => import('./views/OrderAudit.vue'),
    props: (route) => ({ orderId: Number(route.params.id) }),
    meta: { surface: 'provider', title: 'Order Audit' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('./views/Dashboard.vue'),
    meta: { surface: 'provider', title: 'Dashboard' },
  },
  {
    path: '/pay/:token',
    name: 'checkout',
    component: () => import('./views/Checkout.vue'),
    props: true,
    meta: { surface: 'patient', title: 'Pay for your supplements' },
  },
  {
    path: '/inventory',
    name: 'inventory',
    component: () => import('./views/Inventory.vue'),
    meta: { surface: 'provider', title: 'Inventory' },
  },
  {
    // EXPERIMENTAL: static replica of Cerbo's chart; no app chrome, nothing wired.
    path: '/experimental-chart',
    name: 'experimental-chart',
    component: () => import('./views/ExperimentalChart.vue'),
    meta: { surface: 'bare', title: 'Zeus King — Chart (experimental)' },
  },
  {
    // EXPERIMENTAL: static replica of Cerbo's patient portal; no app chrome, nothing wired.
    path: '/experimental-portal',
    name: 'experimental-portal',
    component: () => import('./views/ExperimentalPortal.vue'),
    meta: { surface: 'bare', title: 'Patient Portal (experimental)' },
  },
  {
    path: '/portal/:token',
    name: 'portal',
    component: () => import('./views/PatientPortal.vue'),
    props: true,
    meta: { surface: 'patient', title: 'Patient Portal' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/orders/new' },
];

export const router = createRouter({ history: createWebHistory(), routes });

// The experimental surfaces need a demo login (stores/login.ts); everything else is unchanged.
router.beforeEach((to) => {
  if (to.name !== 'experimental-chart' && to.name !== 'experimental-portal') return true;
  const a = useLoginStore().account;
  if (!a) return { name: 'login' };
  if (to.name === 'experimental-chart' && a.role !== 'doctor')
    return { name: 'experimental-portal' };
  if (to.name === 'experimental-portal' && a.role !== 'patient')
    return { name: 'experimental-chart' };
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Cerbo` : 'Cerbo · Supplement Store';
});
