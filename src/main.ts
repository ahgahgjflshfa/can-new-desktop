import { devtools } from '@vue/devtools'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'
import { useSystemStore } from '@/stores/systemStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { initializeNotificationRuntime, teardownNotificationRuntime } from '@/services/lmaNotificationRuntime'
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
const systemStore = useSystemStore(pinia)
const notificationStore = useNotificationStore(pinia)

store.loadSettingsFromStorage()
store.initApp()
authStore.init()
void initializeNotificationRuntime({
  notificationStore,
  authStore,
  onOpenSystem: system => systemStore.switchView(system),
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => teardownNotificationRuntime())
}

app.mount('#app')
