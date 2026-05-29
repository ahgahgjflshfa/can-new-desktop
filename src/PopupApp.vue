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

const priorityConfig: Record<NotificationPriority, { bgClass: string; iconClass: string; label: string }> = {
  pending: {
    bgClass: 'bg-red-500/80 border-red-600',
    iconClass: 'i-mdi-alert-circle text-red-100',
    label: '待處理',
  },
  replied: {
    bgClass: 'bg-orange-500/80 border-orange-600',
    iconClass: 'i-mdi-progress-clock text-orange-100',
    label: '已回覆',
  },
  completed: {
    bgClass: 'bg-green-500/80 border-green-600',
    iconClass: 'i-mdi-check-circle text-green-100',
    label: '已完成',
  },
  ignored: {
    bgClass: 'bg-slate-500/80 border-slate-600',
    iconClass: 'i-mdi-eye-off text-slate-100',
    label: '已忽略',
  },
}

const currentPriorityConfig = computed(() => {
  if (!currentNotification.value) return priorityConfig.pending
  if (currentNotification.value.priority in priorityConfig) {
    return priorityConfig[currentNotification.value.priority]
  }
  return priorityConfig.pending
})

const formattedTime = computed(() => {
  if (!currentNotification.value) return ''
  const date = new Date(currentNotification.value.createdAt)
  return date.toLocaleString()
})

async function openMainWindow() {
  logAppEvent('info', 'popup', 'requested opening main window from popup')
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
    class="h-screen w-screen flex flex-col overflow-hidden select-none"
    :class="currentPriorityConfig.bgClass"
  >
    <!-- Content -->
    <div class="flex-1 p-4 overflow-y-auto">
      <div class="flex items-start gap-3">
        <div class="shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-black/20">
          <span :class="currentPriorityConfig.iconClass" />
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="px-2 py-0.5 text-xs font-bold rounded uppercase tracking-wider bg-black/30 text-white">
              {{ currentPriorityConfig.label }}
            </span>
            <span
              v-if="currentNotification.category"
              class="px-2 py-0.5 text-xs font-medium rounded bg-black/20 text-white/80"
            >
              {{ currentNotification.category }}
            </span>
          </div>

          <h2 class="text-xl font-bold text-white mb-2 leading-tight">
            {{ currentNotification.title }}
          </h2>

          <p class="text-sm text-white/90 leading-relaxed">
            {{ currentNotification.body }}
          </p>

          <div class="mt-3 text-xs text-white/70">
            <span class="i-mdi-clock-outline mr-1" />
            {{ formattedTime }}
          </div>

          <div class="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-white/70">
            {{ currentNotification.unreadCount }} 筆待處理
          </div>
        </div>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="shrink-0 border-t border-black/20 p-2 space-y-2">
      <button
        type="button"
        class="w-full px-4 py-3 text-sm font-semibold text-white bg-black/25 hover:bg-black/35 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="isAcknowledging"
        @click="acknowledgeCurrentAlert"
      >
        <span class="i-mdi-check-bold mr-1.5" />
        {{ isAcknowledging ? '確認中…' : '確認收到' }}
      </button>

      <button
        type="button"
        class="w-full px-4 py-3 text-sm font-semibold text-white hover:bg-black/20 transition-colors"
        @click="openMainWindow"
      >
        <span class="i-mdi-open-in-new mr-1.5" />
        開啟主程式以回覆／完成任務
      </button>

      <p v-if="acknowledgeError" class="px-1 text-xs text-white/90">
        {{ acknowledgeError }}
      </p>
    </div>
  </div>

  <!-- Loading/empty state (shouldn't normally be visible) -->
  <div v-else class="h-screen w-screen flex items-center justify-center bg-neutral-900">
    <p class="text-neutral-500 text-sm">等待警示中…</p>
  </div>
</template>
