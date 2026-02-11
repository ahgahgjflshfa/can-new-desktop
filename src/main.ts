import { devtools } from '@vue/devtools'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'
import App from './App.vue'
import './assets/main.css'

if (process.env.NODE_ENV === 'development') {
  devtools.connect('http://localhost', 8098)
}
const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const store = useStore(pinia)
const authStore = useAuthStore(pinia)

store.loadSettingsFromStorage()
store.applyThemePreference()
authStore.init()

app.mount('#app')
