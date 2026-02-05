<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationPriority } from '@/types/notification'

const notificationStore = useNotificationStore()

const now = ref(new Date())
let intervalId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  intervalId = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})

const connectionStatusClass = computed(() => {
  if (!notificationStore.isPolling) return 'bg-gray-500'
  return notificationStore.pollingStats.isConnected ? 'bg-green-500' : 'bg-red-500'
})

const connectionStatusText = computed(() => {
  if (!notificationStore.isPolling) return 'Stopped'
  return notificationStore.pollingStats.isConnected ? 'Connected' : 'Disconnected'
})

const lastPollDisplay = computed(() => {
  const lastPoll = notificationStore.pollingStats.lastPollTime
  if (!lastPoll) return 'Never'
  const seconds = Math.floor((now.value.getTime() - new Date(lastPoll).getTime()) / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
})

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  const isToday = date.toDateString() === new Date().toDateString()
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function goToAlerts() {
  useStore().currentView = 'notifications'
}

const priorityConfig: Record<NotificationPriority, { text: string }> = {
  critical: { text: 'text-red-400' },
  high: { text: 'text-orange-400' },
  medium: { text: 'text-yellow-400' },
  low: { text: 'text-blue-400' },
}
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-[var(--app-fg-strong)]">Dashboard</h1>
      <div class="flex items-center gap-4 text-sm text-[var(--app-muted)]">
        <span>Last poll: {{ lastPollDisplay }}</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :class="connectionStatusClass" />
          <span>{{ connectionStatusText }}</span>
        </div>
      </div>
    </div>

    <div
      class="rounded-xl p-6 border-2 cursor-pointer transition-all hover:scale-[1.01]"
      :class="
        notificationStore.criticalCount > 0
          ? 'bg-red-500/20 border-red-500'
          : notificationStore.unreadCount > 0
            ? 'bg-orange-500/10 border-orange-500/50'
            : 'bg-[var(--app-surface-2)] border-[var(--app-border)]'
      "
      @click="goToAlerts"
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm text-[var(--app-muted)] mb-1">Unread Alerts</div>
          <div class="flex items-baseline gap-3">
            <span
              class="text-5xl font-bold"
              :class="notificationStore.unreadCount > 0 ? 'text-red-400' : 'text-[var(--app-fg-strong)]'"
            >
              {{ notificationStore.unreadCount }}
            </span>
            <span v-if="notificationStore.criticalCount > 0" class="text-red-400 font-medium">
              ({{ notificationStore.criticalCount }} critical)
            </span>
          </div>
        </div>
        <div class="flex gap-4 text-sm">
          <div class="text-center">
            <div class="text-2xl font-semibold text-[var(--app-fg-strong)]">{{ notificationStore.alertsToday }}</div>
            <div class="text-[var(--app-muted)]">Today</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold text-[var(--app-fg-strong)]">{{ notificationStore.alertsThisWeek }}</div>
            <div class="text-[var(--app-muted)]">This Week</div>
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-xl bg-[var(--app-surface-2)] border border-[var(--app-border)] overflow-hidden">
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--app-border)]">
        <h2 class="font-semibold text-[var(--app-fg-strong)]">Recent Activity</h2>
        <button type="button" class="text-sm text-sky-400 hover:text-sky-300 transition-colors" @click="goToAlerts">
          View All
        </button>
      </div>

      <div v-if="notificationStore.recentNotifications.length === 0" class="p-12 text-center text-[var(--app-muted)]">
        <span class="i-mdi-bell-outline text-5xl opacity-30 mb-3 block" />
        <div class="text-lg">No notifications yet</div>
        <div class="text-sm text-[var(--app-muted-2)]">Emergency alerts will appear here</div>
      </div>

      <div v-else class="divide-y divide-[var(--app-border)]">
        <div
          v-for="notification in notificationStore.recentNotifications"
          :key="notification.id"
          class="flex items-center gap-3 px-4 py-3 hover:bg-[var(--app-hover)] transition-colors"
        >
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="{
              'bg-red-500': notification.priority === 'critical',
              'bg-orange-500': notification.priority === 'high',
              'bg-yellow-500': notification.priority === 'medium',
              'bg-blue-500': notification.priority === 'low',
            }"
          />
          <div class="flex-1 min-w-0">
            <div class="font-medium text-[var(--app-fg-strong)] truncate">{{ notification.title }}</div>
            <div class="text-sm text-[var(--app-muted)] truncate">{{ notification.body }}</div>
          </div>
          <div class="text-xs text-[var(--app-muted)] shrink-0">{{ formatTime(notification.receivedAt) }}</div>
          <span v-if="notification.status === 'dismissed'" class="i-mdi-check-circle text-green-500 shrink-0" />
          <span v-else class="i-mdi-circle-outline text-[var(--app-muted)] shrink-0" />
        </div>
      </div>
    </div>

    <div v-if="notificationStore.pollingStats.lastError" class="rounded-xl bg-red-500/10 border border-red-500/50 p-4">
      <div class="flex items-start gap-3">
        <span class="i-mdi-alert-circle text-red-500 text-xl shrink-0" />
        <div>
          <div class="font-medium text-red-400">Connection Error</div>
          <div class="text-sm text-red-300/80">{{ notificationStore.pollingStats.lastError }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
