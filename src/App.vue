<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import SettingsView from './components/SettingsView.vue'
import NotificationsView from './components/NotificationsView.vue'
import LoginView from './components/LoginView.vue'
import CanLoginView from './components/CanLoginView.vue'
import CanTaskView from './components/CanTaskView.vue'
import { useSystemStore } from '@/stores/systemStore'
import { useAuthStore } from '@/stores/authStore'

const systemStore = useSystemStore()
const authStore = useAuthStore()
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
