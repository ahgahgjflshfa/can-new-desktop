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
  metadata?: Record<string, unknown>
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
const isCanNotification = computed(() => currentNotification.value?.metadata?.system === 'can')

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

  isAcknowledging.value = true
  acknowledgeError.value = null

  try {
    if (!isCanNotification.value) {
      const taskId = Number(notificationId)
      if (!Number.isFinite(taskId)) {
        acknowledgeError.value = '任務編號無效'
        return
      }
      await replyTask(taskId)
    }
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
    class="h-screen w-screen flex flex-col overflow-hidden select-none bg-[var(--app-surface)] text-[var(--app-fg)] font-sans antialiased"
  >
    <!-- Priority indicator bar — thicker for pending to convey urgency -->
    <div
      class="shrink-0"
      :class="[priorityBarClass, currentNotification.priority === 'pending' ? 'h-1' : 'h-[3px]']"
    />

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-4 pt-3 pb-2 min-h-0">
      <!-- Status row: priority + category + timestamp -->
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="flex items-center gap-1.5 shrink-0">
          <span
            class="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-[11px]"
            :class="priorityIconBgClass"
          >
            <span :class="currentPriorityConfig.iconClass" />
          </span>
          <span
            class="text-[11px] font-semibold whitespace-nowrap rounded-[3px] px-1.5 py-px"
            :class="priorityBadgeClass"
          >
            {{ currentPriorityConfig.label }}
          </span>
          <span
            v-if="currentNotification.category"
            class="text-[11px] text-[var(--app-muted-2)] whitespace-nowrap"
          >
            · {{ currentNotification.category }}
          </span>
        </div>
        <span class="flex items-center gap-1 text-[11px] text-[var(--app-muted-2)] truncate">
          <span class="i-mdi-clock-outline text-[11px]" />
          {{ formattedTime }}
        </span>
      </div>

      <!-- Title — strong visual weight -->
      <h2 class="text-[1.3rem] font-bold text-[var(--app-fg-strong)] leading-tight mb-1 line-clamp-2">
        {{ currentNotification.title }}
      </h2>

      <!-- Body — compact, clamped -->
      <p class="text-[0.85rem] text-[var(--app-muted)] leading-relaxed line-clamp-3">
        {{ currentNotification.body }}
      </p>

      <!-- Unread count -->
      <div class="mt-2 text-[11px] font-semibold text-[var(--app-primary-strong)]">
        {{ currentNotification.unreadCount }} 筆待處理
      </div>
    </div>

    <!-- Action area -->
    <div class="shrink-0 border-t border-[var(--app-border)] px-4 pt-3 pb-3 space-y-1.5">
      <button
        type="button"
        class="w-full h-10 rounded-lg text-[13px] font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :class="primaryButtonClass"
        :disabled="isAcknowledging"
        @click="acknowledgeCurrentAlert"
      >
        <span class="i-mdi-check-bold mr-1.5" />
        {{ isAcknowledging ? '確認中…' : '確認收到' }}
      </button>

      <button
        type="button"
        class="w-full h-8 text-[12px] font-medium text-[var(--app-muted)] hover:text-[var(--app-primary-strong)] transition-colors flex items-center justify-center gap-1"
        @click="openMainWindow"
      >
        開啟主程式以回覆／完成任務
        <span class="i-mdi-open-in-new text-[12px]" />
      </button>

      <p
        v-if="acknowledgeError"
        class="rounded-md border border-[color:rgba(196,91,91,0.3)] bg-[color:rgba(196,91,91,0.06)] px-2.5 py-1.5 text-[11px] text-[var(--app-danger)]"
      >
        {{ acknowledgeError }}
      </p>
    </div>
  </div>

  <!-- Empty state — intentional monitoring indicator -->
  <div v-else class="h-screen w-screen flex items-center justify-center bg-[var(--app-surface)]">
    <div class="text-center">
      <div class="relative mx-auto mb-3 h-2 w-2">
        <div class="absolute inset-0 rounded-full bg-[var(--app-primary)] animate-ping opacity-60" />
        <div class="relative h-2 w-2 rounded-full bg-[var(--app-primary)]" />
      </div>
      <p class="text-[var(--app-muted-2)] text-[13px]">等待警示中…</p>
    </div>
  </div>
</template>
