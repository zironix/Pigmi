import { createApp } from 'vue';
import mitt from 'mitt';
import { createPinia } from 'pinia';

import App from './App.vue';

const app = createApp(App);
app.use(createPinia());
app.config.globalProperties.emitter = mitt();
app.mount('#app');
