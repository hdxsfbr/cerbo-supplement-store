import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

// Two surfaces (constitution VI): `provider` routes render inside the Cerbo chart chrome,
// `patient` routes render in the clean portal layout. See App.vue.
declare module 'vue-router' {
  interface RouteMeta {
    surface: 'provider' | 'patient';
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/orders/new' },
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
    path: '/portal/:token',
    name: 'portal',
    component: () => import('./views/PatientPortal.vue'),
    props: true,
    meta: { surface: 'patient', title: 'Patient Portal' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/orders/new' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Cerbo` : 'Cerbo · Supplement Store';
});
