<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { replyTask } from '@/services/taskActionService'
import { logAppEvent } from '@/services/appLogger'
import type { NotificationPriority } from '@/types/notification'

interface NotificationPayload {
  id: string
  title: string
  body: string
  priority: NotificationPriority
  category?: string
  createdAt: string
  unreadCount: number
}

const currentNotification = ref<NotificationPayload | null>(null)
const isAcknowledging = ref(false)
const acknowledgeError = ref<string | null>(null)
let unlistenShow: UnlistenFn | null = null

const priorityConfig: Record<
  NotificationPriority,
  {
    barClass: string
    iconClass: string
    iconBgClass: string
    badgeClass: string
    label: string
    buttonClass: string
  }
> = {
  pending: {
    barClass: 'bg-[var(--app-danger)]',
    iconClass: 'i-mdi-alert-circle',
    iconBgClass: 'bg-[color:rgba(196,91,91,0.12)] text-[var(--app-danger)]',
    badgeClass: 'bg-[color:rgba(196,91,91,0.14)] text-[var(--app-danger)]',
    label: '待處理',
    buttonClass: 'bg-[var(--app-danger)] hover:bg-[color:#b04a4a]',
  },
  replied: {
    barClass: 'bg-[var(--app-warning)]',
    iconClass: 'i-mdi-progress-clock',
    iconBgClass: 'bg-[color:rgba(212,139,42,0.12)] text-[var(--app-warning)]',
    badgeClass: 'bg-[color:rgba(212,139,42,0.14)] text-[var(--app-warning)]',
    label: '已回覆',
    buttonClass: 'bg-[var(--app-warning)] hover:bg-[color:#c07d24]',
  },
  completed: {
    barClass: 'bg-[var(--app-success)]',
    iconClass: 'i-mdi-check-circle',
    iconBgClass: 'bg-[color:rgba(63,143,107,0.12)] text-[var(--app-success)]',
    badgeClass: 'bg-[color:rgba(63,143,107,0.14)] text-[var(--app-success)]',
    label: '已完成',
    buttonClass: 'bg-[var(--app-success)] hover:bg-[color:#367a5c]',
  },
  ignored: {
    barClass: 'bg-[var(--app-muted-2)]',
    iconClass: 'i-mdi-eye-off',
    iconBgClass: 'bg-[color:rgba(147,143,153,0.12)] text-[var(--app-muted-2)]',
    badgeClass: 'bg-[color:rgba(147,143,153,0.14)] text-[var(--app-muted-2)]',
    label: '已忽略',
    buttonClass: 'bg-[var(--app-muted-2)] hover:bg-[var(--app-muted)]',
  },
}

const currentPriorityConfig = computed(() => {
  if (!currentNotification.value) return priorityConfig.pending
  if (currentNotification.value.priority in priorityConfig) {
    return priorityConfig[currentNotification.value.priority]
  }
  return priorityConfig.pending
})

const priorityBarClass = computed(() => currentPriorityConfig.value.barClass)
const priorityIconBgClass = computed(() => currentPriorityConfig.value.iconBgClass)
const priorityBadgeClass = computed(() => currentPriorityConfig.value.badgeClass)
const primaryButtonClass = computed(() => currentPriorityConfig.value.buttonClass)

const formattedTime = computed(() => {
  if (!currentNotification.value) return ''
  const date = new Date(currentNotification.value.createdAt)
  return date.toLocaleString()
})

async function openMainWindow() {
  logAppEvent('info', 'popup', 'requested opening main window from popup')
  try {
    await invoke('hide_alert_popup')
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to hide popup before opening main window', err)
  }
  await invoke('show_emergency_window')
}

async function acknowledgeCurrentAlert() {
  if (!currentNotification.value || isAcknowledging.value) return

  const notificationId = currentNotification.value.id
  const taskId = Number(notificationId)
  if (!Number.isFinite(taskId)) {
    acknowledgeError.value = '任務編號無效'
    return
  }

  isAcknowledging.value = true
  acknowledgeError.value = null

  try {
    await replyTask(taskId)
    logAppEvent('info', 'popup', 'popup acknowledge succeeded', { notificationId })

    await invoke('emit_dismiss_notification', {
      notificationId,
      dismissAll: false,
    })
  } catch (err) {
    acknowledgeError.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'popup', 'popup acknowledge failed', err)
  } finally {
    isAcknowledging.value = false
  }
}

onMounted(async () => {
  unlistenShow = await listen<NotificationPayload>('show-notification', event => {
    console.log('[Popup] Received show-notification event:', event.payload)
    logAppEvent('info', 'popup', 'received show-notification event', event.payload)
    acknowledgeError.value = null
    currentNotification.value = event.payload
  })

  try {
    console.log('[Popup] Calling get_pending_notification...')
    const pending = await invoke<NotificationPayload | null>('get_pending_notification')
    console.log('[Popup] get_pending_notification returned:', pending)
    if (pending) {
      logAppEvent('info', 'popup', 'loaded pending notification on mount', { notificationId: pending.id })
      currentNotification.value = pending
    }
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to get pending notification', err)
    console.warn('[Popup] Failed to get pending notification:', err)
  }
})

onUnmounted(() => {
  unlistenShow?.()
})
</script>

<template>
  <div
    v-if="currentNotification"
    class="h-screen w-screen flex flex-col overflow-hidden select-none bg-[var(--app-bg)] text-[var(--app-fg)] font-sans antialiased"
  >
    <!-- Priority indicator bar -->
    <div class="shrink-0 h-1.5" :class="priorityBarClass" />

    <!-- Header -->
    <div class="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4">
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          :class="priorityIconBgClass"
        >
          <span :class="[currentPriorityConfig.iconClass, 'text-xl']" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider"
              :class="priorityBadgeClass"
            >
              {{ currentPriorityConfig.label }}
            </span>
            <span
              v-if="currentNotification.category"
              class="rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--app-surface-2)] text-[var(--app-muted)]"
            >
              {{ currentNotification.category }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto bg-[var(--app-surface-3)] p-5">
      <h2 class="text-[1.25rem] font-bold text-[var(--app-fg-strong)] mb-2 leading-tight">
        {{ currentNotification.title }}
      </h2>

      <p class="text-[0.95rem] text-[var(--app-muted)] leading-relaxed">
        {{ currentNotification.body }}
      </p>

      <div class="mt-4 flex items-center gap-4 text-xs text-[var(--app-muted-2)]">
        <span class="flex items-center gap-1">
          <span class="i-mdi-clock-outline" />
          {{ formattedTime }}
        </span>
      </div>

      <div class="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--app-primary-strong)]">
        {{ currentNotification.unreadCount }} 筆待處理
      </div>
    </div>

    <!-- Action buttons -->
    <div class="shrink-0 border-t border-[var(--app-border)] bg-[var(--app-surface)] p-4 space-y-2.5">
      <button
        type="button"
        class="w-full h-11 rounded-full text-sm font-bold tracking-wide text-white transition-all shadow-[0_4px_12px_rgba(0,0,0,0.12)] disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
        :class="primaryButtonClass"
        :disabled="isAcknowledging"
        @click="acknowledgeCurrentAlert"
      >
        <span class="i-mdi-check-bold mr-1.5" />
        {{ isAcknowledging ? '確認中…' : '確認收到' }}
      </button>

      <button
        type="button"
        class="w-full h-11 rounded-full text-sm font-bold tracking-wide text-[var(--app-primary-strong)] bg-[var(--app-primary-surface)] hover:bg-[var(--app-accent)] transition-colors"
        @click="openMainWindow"
      >
        <span class="i-mdi-open-in-new mr-1.5" />
        開啟主程式以回覆／完成任務
      </button>

      <p
        v-if="acknowledgeError"
        class="rounded-xl border border-[color:rgba(196,91,91,0.35)] bg-[color:rgba(196,91,91,0.08)] px-3 py-2 text-xs text-[var(--app-danger)]"
      >
        {{ acknowledgeError }}
      </p>
    </div>
  </div>

  <!-- Loading/empty state -->
  <div v-else class="h-screen w-screen flex items-center justify-center bg-[var(--app-bg)]">
    <div class="text-center">
      <div class="mx-auto mb-3 text-4xl text-[var(--app-muted-2)] i-mdi-bell-off" />
      <p class="text-[var(--app-muted)] text-sm">等待警示中…</p>
    </div>
  </div>
</template>
