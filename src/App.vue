<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import HomeView from './components/HomeView.vue'
import SettingsView from './components/SettingsView.vue'
import NotificationsView from './components/NotificationsView.vue'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useStore()
const notificationStore = useNotificationStore()

onMounted(() => {
  store.initApp()
  notificationStore.init()
})
</script>

<template>
  <AppShell>
    <HomeView v-if="store.currentView === 'home'" />
    <SettingsView v-else-if="store.currentView === 'settings'" />
    <NotificationsView v-else-if="store.currentView === 'notifications'" />
  </AppShell>
</template>
