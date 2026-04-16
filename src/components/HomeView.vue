<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useStore } from '@/store'
import { useNotificationStore } from '@/stores/notificationStore'

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
  if (!notificationStore.isPolling) return 'bg-[var(--app-muted-2)]'
  return notificationStore.pollingStats.isConnected ? 'bg-[var(--app-success)]' : 'bg-[var(--app-danger)]'
})

const connectionStatusText = computed(() => {
  if (!notificationStore.isPolling) return '已停止'
  return notificationStore.pollingStats.isConnected ? '已連線' : '未連線'
})

const lastPollDisplay = computed(() => {
  const lastPoll = notificationStore.pollingStats.lastPollTime
  if (!lastPoll) return '尚未'

  const lastPollMs = lastPoll instanceof Date ? lastPoll.getTime() : new Date(lastPoll).getTime()
  if (!Number.isFinite(lastPollMs)) return '尚未'

  const seconds = Math.max(0, Math.floor((now.value.getTime() - lastPollMs) / 1000))
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} 分鐘前`
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
</script>

<template>
  <div class="space-y-6 px-6 py-6 md:px-8 md:py-8">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-[var(--app-fg-strong)]">總覽儀表板</h1>
        <p class="mt-1 text-sm text-[var(--app-muted)]">檢視警示動態、連線狀態，以及最近的車站事件。</p>
      </div>
      <div class="flex items-center gap-4 text-sm text-[var(--app-muted)]">
        <span>上次輪詢：{{ lastPollDisplay }}</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" :class="connectionStatusClass" />
          <span>{{ connectionStatusText }}</span>
        </div>
      </div>
    </div>

    <div
      class="cursor-pointer rounded-[1.5rem] border p-6 transition-all hover:-translate-y-0.5"
      :class="
        notificationStore.pendingAlertCount > 0
          ? 'bg-[color:rgba(196,91,91,0.12)] border-[var(--app-danger)]'
          : notificationStore.unreadCount > 0
            ? 'bg-[color:rgba(212,139,42,0.10)] border-[color:rgba(212,139,42,0.55)]'
            : 'bg-[var(--app-surface)] border-[var(--app-border)]'
      "
      @click="goToAlerts"
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm text-[var(--app-muted)] mb-1">未讀警示</div>
          <div class="flex items-baseline gap-3">
            <span
              class="text-5xl font-bold"
              :class="notificationStore.unreadCount > 0 ? 'text-[var(--app-danger)]' : 'text-[var(--app-fg-strong)]'"
            >
              {{ notificationStore.unreadCount }}
            </span>
            <span v-if="notificationStore.pendingAlertCount > 0" class="font-medium text-[var(--app-danger)]">
              （{{ notificationStore.pendingAlertCount }} 筆待處理）
            </span>
          </div>
        </div>
        <div class="flex gap-4 text-sm">
          <div class="text-center">
            <div class="text-2xl font-semibold text-[var(--app-fg-strong)]">{{ notificationStore.alertsToday }}</div>
            <div class="text-[var(--app-muted)]">今天</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold text-[var(--app-fg-strong)]">{{ notificationStore.alertsThisWeek }}</div>
            <div class="text-[var(--app-muted)]">本週</div>
          </div>
        </div>
      </div>
    </div>

    <div class="overflow-hidden rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--app-border)]">
        <h2 class="font-semibold text-[var(--app-fg-strong)]">最近活動</h2>
        <button
          type="button"
          class="text-sm text-[var(--app-primary-strong)] transition-colors hover:text-[var(--app-primary)]"
          @click="goToAlerts"
        >
          查看全部
        </button>
      </div>

      <div v-if="notificationStore.recentNotifications.length === 0" class="p-12 text-center text-[var(--app-muted)]">
        <span class="i-mdi-bell-outline text-5xl opacity-30 mb-3 block" />
        <div class="text-lg">目前尚無通知</div>
        <div class="text-sm text-[var(--app-muted-2)]">新的緊急警示會顯示在這裡</div>
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
              'bg-[var(--app-danger)]': notification.priority === 'pending',
              'bg-[var(--app-warning)]': notification.priority === 'replied',
              'bg-[var(--app-success)]': notification.priority === 'completed',
              'bg-[var(--app-muted-2)]': notification.priority === 'ignored',
            }"
          />
          <div class="flex-1 min-w-0">
            <div class="font-medium text-[var(--app-fg-strong)] truncate">{{ notification.title }}</div>
            <div class="text-sm text-[var(--app-muted)] truncate">{{ notification.body }}</div>
          </div>
          <div class="text-xs text-[var(--app-muted)] shrink-0">{{ formatTime(notification.receivedAt) }}</div>
          <span
            v-if="notification.status === 'dismissed'"
            class="i-mdi-check-circle shrink-0 text-[var(--app-success)]"
          />
          <span v-else class="i-mdi-circle-outline text-[var(--app-muted)] shrink-0" />
        </div>
      </div>
    </div>

    <div
      v-if="notificationStore.pollingStats.lastError"
      class="rounded-[1.25rem] border border-[color:rgba(196,91,91,0.35)] bg-[color:rgba(196,91,91,0.08)] p-4"
    >
      <div class="flex items-start gap-3">
        <span class="i-mdi-alert-circle text-xl shrink-0 text-[var(--app-danger)]" />
        <div>
          <div class="font-medium text-[var(--app-danger)]">連線錯誤</div>
          <div class="text-sm text-[color:rgba(87,52,52,0.82)]">{{ notificationStore.pollingStats.lastError }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
