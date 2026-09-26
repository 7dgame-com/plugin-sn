import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './composables/useTheme'
import './styles/index.css'

const app = createApp(App).use(router).use(i18n).use(ElementPlus)
void router.isReady().then(() => app.mount('#app'))
