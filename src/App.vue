<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import SettingsView from './components/SettingsView.vue'
import NotificationsView from './components/NotificationsView.vue'
import LoginView from './components/LoginView.vue'
import CanLoginView from './components/CanLoginView.vue'
import CanTaskView from './components/CanTaskView.vue'
import { useStore } from '@/store'
import { useSystemStore } from '@/stores/systemStore'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

const store = useStore()
const systemStore = useSystemStore()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const hasInitializedNotifications = ref(false)
let unlistenOpenNotificationSystem: UnlistenFn | null = null

interface OpenNotificationSystemPayload {
  system?: 'lma' | 'can'
}

async function syncNotificationRuntimeByAuth() {
  if (authStore.isSystemAuthenticated('lma')) {
    if (!hasInitializedNotifications.value) {
      await notificationStore.init()
      hasInitializedNotifications.value = true
      return
    }

    if (notificationStore.pollingEnabled && !notificationStore.isPolling) {
      notificationStore.startPolling()
    }
    return
  }

  if (notificationStore.isPolling) {
    notificationStore.stopPolling()
  }
}

onMounted(() => {
  store.initApp()
  authStore.init()
  void syncNotificationRuntimeByAuth()
  void listen<OpenNotificationSystemPayload>('open-notification-system', event => {
    const targetSystem = event.payload.system
    if (targetSystem === 'lma' || targetSystem === 'can') {
      systemStore.switchView(targetSystem)
    }
  }).then(unlisten => {
    unlistenOpenNotificationSystem = unlisten
  })
})

onUnmounted(() => {
  unlistenOpenNotificationSystem?.()
  unlistenOpenNotificationSystem = null
})

watch(
  () => [authStore.currentSystem, authStore.token, notificationStore.pollingEnabled],
  () => {
    void syncNotificationRuntimeByAuth()
  }
)
</script>

<template>
  <AppShell>
    <template v-if="systemStore.currentView === 'lma'">
      <LoginView v-if="!authStore.isAuthenticated" />
      <NotificationsView v-else />
    </template>
    <template v-else-if="systemStore.currentView === 'can'">
      <CanLoginView v-if="!authStore.isAuthenticated" />
      <CanTaskView v-else />
    </template>
    <SettingsView v-else-if="systemStore.currentView === 'settings'" />
  </AppShell>
</template>
