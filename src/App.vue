<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import HomeView from './components/HomeView.vue'
import SettingsView from './components/SettingsView.vue'
import NotificationsView from './components/NotificationsView.vue'
import LoginView from './components/LoginView.vue'
import StreamTestView from './components/StreamTestView.vue'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useStore()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const hasInitializedNotifications = ref(false)

async function syncNotificationRuntimeByAuth() {
  if (authStore.isAuthenticated) {
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
  void syncNotificationRuntimeByAuth()
})

watch(
  () => authStore.isAuthenticated,
  () => {
    void syncNotificationRuntimeByAuth()
  }
)
</script>

<template>
  <LoginView v-if="!authStore.isAuthenticated" />
  <AppShell v-else>
    <HomeView v-if="store.currentView === 'home'" />
    <SettingsView v-else-if="store.currentView === 'settings'" />
    <NotificationsView v-else-if="store.currentView === 'notifications'" />
    <StreamTestView v-else-if="store.currentView === 'stream-test'" />
  </AppShell>
</template>
