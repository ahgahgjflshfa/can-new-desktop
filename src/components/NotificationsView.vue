<script setup lang="ts">
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationPriority, NotificationState } from '@/types/notification'

const notificationStore = useNotificationStore()

const priorityStyles: Record<NotificationPriority, { borderClass: string; iconClass: string }> = {
  pending: { borderClass: 'border-l-red-500', iconClass: 'i-mdi-alert-circle text-red-500' },
  replied: { borderClass: 'border-l-orange-500', iconClass: 'i-mdi-progress-clock text-orange-500' },
  completed: { borderClass: 'border-l-green-500', iconClass: 'i-mdi-check-circle text-green-500' },
  ignored: { borderClass: 'border-l-slate-500', iconClass: 'i-mdi-eye-off text-slate-500' },
}

function getPriorityStyle(priority: string) {
  if (priority in priorityStyles) {
    return priorityStyles[priority as NotificationPriority]
  }
  return priorityStyles.pending
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function handleDelete(notificationId: string) {
  notificationStore.deleteNotification(notificationId)
}

function handleClearHistory() {
  notificationStore.clearHistory()
}

function getStatusBadge(notification: NotificationState): { text: string; class: string } {
  switch (notification.status) {
    case 'pending':
      return { text: 'New', class: 'bg-sky-500/20 text-sky-400' }
    case 'shown':
      return { text: 'Active', class: 'bg-orange-500/20 text-orange-400' }
    case 'dismissed':
      return { text: 'Dismissed', class: 'bg-[var(--app-surface-2)] text-[var(--app-muted)]' }
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto py-12 px-6">
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-3xl font-bold text-[var(--app-fg-strong)] tracking-tight">Notifications</h1>

      <div class="flex items-center gap-3">
        <span
          v-if="notificationStore.unreadCount > 0"
          class="px-3 py-1 text-sm font-medium rounded-full bg-sky-500/20 text-sky-400"
        >
          {{ notificationStore.unreadCount }} unread
        </span>
      </div>
    </div>

    <div class="bg-[var(--app-surface-2)] rounded-xl border border-[var(--app-border)] overflow-hidden">
      <div class="flex items-center justify-between p-4 border-b border-[var(--app-border)]">
        <h2 class="text-xl font-semibold text-[var(--app-fg)] flex items-center gap-2">
          <div class="i-mdi-history text-sky-500" />
          History
        </h2>

        <button
          v-if="notificationStore.dismissedNotifications.length > 0"
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)] transition-colors"
          @click="handleClearHistory"
        >
          <span class="i-mdi-delete-sweep mr-1" />
          Clear dismissed
        </button>
      </div>

      <div v-if="notificationStore.notifications.length === 0" class="p-12 text-center">
        <div class="i-mdi-bell-off text-4xl text-[var(--app-muted-2)] mx-auto mb-3" />
        <p class="text-[var(--app-muted)]">No notifications yet</p>
        <p class="text-sm text-[var(--app-muted-2)]">Emergency alerts will appear here</p>
      </div>

      <div v-else class="divide-y divide-[var(--app-border)]">
        <div
          v-for="notification in notificationStore.notifications"
          :key="notification.id"
          class="p-4 hover:bg-[var(--app-hover)] transition-colors border-l-4"
          :class="[
            getPriorityStyle(notification.priority).borderClass,
            notification.status === 'dismissed' ? 'opacity-60' : '',
          ]"
        >
          <div class="flex items-start gap-3">
            <span :class="getPriorityStyle(notification.priority).iconClass" class="text-xl shrink-0 mt-0.5" />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3
                  class="font-semibold truncate"
                  :class="notification.status === 'dismissed' ? 'text-[var(--app-muted)]' : 'text-[var(--app-fg)]'"
                >
                  {{ notification.title }}
                </h3>

                <span
                  class="shrink-0 px-2 py-0.5 text-xs font-medium rounded"
                  :class="getStatusBadge(notification).class"
                >
                  {{ getStatusBadge(notification).text }}
                </span>
              </div>

              <p class="text-sm text-[var(--app-muted)] line-clamp-2 mb-2">
                {{ notification.body }}
              </p>

              <div class="flex items-center gap-4 text-xs text-[var(--app-muted-2)]">
                <span>
                  <span class="i-mdi-clock-outline mr-1" />
                  {{ formatDate(notification.createdAt) }}
                </span>
                <span v-if="notification.category" class="uppercase tracking-wider">
                  {{ notification.category }}
                </span>
              </div>
            </div>

            <button
              v-if="notification.status === 'dismissed' || notification.priority === 'completed'"
              type="button"
              class="shrink-0 p-2 rounded-lg text-[var(--app-muted)] hover:bg-[var(--app-surface)] hover:text-red-400 transition-colors"
              title="Delete notification"
              @click="handleDelete(notification.id)"
            >
              <span class="i-mdi-close text-lg" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
