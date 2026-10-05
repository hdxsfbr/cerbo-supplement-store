import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// Router + stores land in T015; this is the minimal bootable shell for the scaffold.
createApp(App).use(createPinia()).mount('#app');
