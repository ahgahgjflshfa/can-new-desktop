<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationPriority, NotificationState } from '@/types/notification'
import type { CompletionResult } from '@/services/taskActionService'

const notificationStore = useNotificationStore()
const activeTab = ref<'active' | 'completed'>('active')

const priorityStyles: Record<NotificationPriority, { borderClass: string; iconClass: string }> = {
  pending: { borderClass: 'border-l-[var(--app-danger)]', iconClass: 'i-mdi-alert-circle text-[var(--app-danger)]' },
  replied: {
    borderClass: 'border-l-[var(--app-warning)]',
    iconClass: 'i-mdi-progress-clock text-[var(--app-warning)]',
  },
  completed: {
    borderClass: 'border-l-[var(--app-success)]',
    iconClass: 'i-mdi-check-circle text-[var(--app-success)]',
  },
  ignored: { borderClass: 'border-l-[var(--app-muted-2)]', iconClass: 'i-mdi-eye-off text-[var(--app-muted-2)]' },
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

  if (diffMins < 1) return '剛剛'
  if (diffMins < 60) return `${diffMins} 分鐘前`
  if (diffHours < 24) return `${diffHours} 小時前`
  if (diffDays < 7) return `${diffDays} 天前`
  return date.toLocaleDateString()
}

function handleDelete(notificationId: string) {
  notificationStore.deleteNotification(notificationId)
}

function handleClearHistory() {
  notificationStore.clearHistory()
}

function handleReply(notificationId: string) {
  void notificationStore.replyTaskById(notificationId)
}

function handleComplete(notificationId: string, result: CompletionResult) {
  void notificationStore.completeTaskById(notificationId, result)
}

const activeNotifications = computed(() => {
  return notificationStore.notifications.filter(notification => {
    return (
      notification.status !== 'dismissed' &&
      (notification.priority === 'pending' || notification.priority === 'replied')
    )
  })
})

const completedNotifications = computed(() => {
  return notificationStore.notifications.filter(notification => {
    return (
      notification.status === 'dismissed' ||
      notification.priority === 'completed' ||
      notification.priority === 'ignored'
    )
  })
})

const visibleNotifications = computed(() => {
  return activeTab.value === 'active' ? activeNotifications.value : completedNotifications.value
})

function getStatusBadge(notification: NotificationState): { text: string; class: string } {
  switch (notification.status) {
    case 'pending':
      return { text: '新通知', class: 'bg-[var(--app-primary-surface)] text-[var(--app-primary-strong)]' }
    case 'shown':
      return { text: '處理中', class: 'bg-[color:rgba(212,139,42,0.14)] text-[var(--app-warning)]' }
    case 'dismissed':
      return { text: '已關閉', class: 'bg-[var(--app-surface-2)] text-[var(--app-muted)]' }
  }
}
</script>

<template>
  <div class="min-h-full">
    <div class="sticky top-0 z-10 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 md:px-8">
      <div class="mx-auto flex max-w-5xl items-center justify-center gap-10 overflow-x-auto">
        <div v-if="notificationStore.unreadCount > 0" class="absolute right-6 hidden md:block lg:right-8">
          <span
            class="rounded-full bg-[var(--app-primary-surface)] px-3 py-1 text-sm font-medium text-[var(--app-primary-strong)]"
          >
            {{ notificationStore.unreadCount }} 筆未讀
          </span>
        </div>

        <div class="flex items-center gap-6 overflow-x-auto">
          <button
            type="button"
            class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold transition-colors"
            :class="
              activeTab === 'active'
                ? 'text-[var(--app-primary-strong)]'
                : 'text-[var(--app-muted)] hover:text-[var(--app-fg)]'
            "
            @click="activeTab = 'active'"
          >
            進行中任務 ({{ activeNotifications.length }})
            <span
              v-if="activeTab === 'active'"
              class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]"
            />
          </button>

          <button
            type="button"
            class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold transition-colors"
            :class="
              activeTab === 'completed'
                ? 'text-[var(--app-primary-strong)]'
                : 'text-[var(--app-muted)] hover:text-[var(--app-fg)]'
            "
            @click="activeTab = 'completed'"
          >
            已完成任務
            <span
              v-if="activeTab === 'completed'"
              class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]"
            />
          </button>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-5xl px-6 py-6 md:px-8 md:py-8">
      <div class="overflow-hidden rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)]">
        <div class="flex items-center justify-between border-b border-[var(--app-border)] p-4">
          <h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--app-fg)]">
            <div class="i-mdi-history text-[var(--app-primary-strong)]" />
            {{ activeTab === 'active' ? '進行中' : '已完成' }}
          </h2>

          <button
            v-if="activeTab === 'completed' && notificationStore.dismissedNotifications.length > 0"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
            @click="handleClearHistory"
          >
            <span class="i-mdi-delete-sweep mr-1" />
            清除已關閉項目
          </button>
        </div>

        <div
          v-if="notificationStore.taskActionError"
          class="mx-4 mt-4 rounded-lg border border-[color:rgba(196,91,91,0.35)] bg-[color:rgba(196,91,91,0.08)] px-3 py-2 text-sm text-[var(--app-danger)]"
        >
          {{ notificationStore.taskActionError }}
        </div>

        <div v-if="visibleNotifications.length === 0" class="p-12 text-center">
          <div class="mx-auto mb-3 text-4xl text-[var(--app-muted-2)] i-mdi-bell-off" />
          <p class="text-[var(--app-muted)]">
            {{ activeTab === 'active' ? '目前沒有進行中的任務' : '目前沒有已完成任務' }}
          </p>
          <p class="text-sm text-[var(--app-muted-2)]">
            {{ activeTab === 'active' ? '新的警示與待處理任務會顯示在這裡' : '完成或關閉的任務會顯示在這裡' }}
          </p>
        </div>

        <div v-else class="divide-y divide-[var(--app-border)]">
          <div
            v-for="notification in visibleNotifications"
            :key="notification.id"
            class="border-l-4 p-4 transition-colors hover:bg-[var(--app-hover)]"
            :class="[
              getPriorityStyle(notification.priority).borderClass,
              notification.status === 'dismissed' ? 'opacity-60' : '',
            ]"
          >
            <div class="flex items-start gap-3">
              <span :class="getPriorityStyle(notification.priority).iconClass" class="mt-0.5 shrink-0 text-xl" />

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

                <div v-if="notification.status !== 'dismissed'" class="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    v-if="notification.priority === 'pending'"
                    type="button"
                    class="rounded-full bg-[var(--app-primary-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--app-primary)] disabled:opacity-60"
                    :disabled="notificationStore.isTaskActionPending"
                    @click="handleReply(notification.id)"
                  >
                    回覆
                  </button>

                  <template v-if="notification.priority === 'replied'">
                    <button
                      type="button"
                      class="rounded-full bg-[var(--app-success)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      :disabled="notificationStore.isTaskActionPending"
                      @click="handleComplete(notification.id, 'normal')"
                    >
                      完成：一般處理
                    </button>

                    <button
                      type="button"
                      class="rounded-full bg-[var(--app-warning)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      :disabled="notificationStore.isTaskActionPending"
                      @click="handleComplete(notification.id, 'no_passenger')"
                    >
                      完成：未載客
                    </button>
                  </template>
                </div>
              </div>

              <button
                v-if="notification.status === 'dismissed' || notification.priority === 'completed'"
                type="button"
                class="shrink-0 rounded-lg p-2 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-surface-2)] hover:text-[var(--app-danger)]"
                title="刪除通知"
                @click="handleDelete(notification.id)"
              >
                <span class="i-mdi-close text-lg" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
