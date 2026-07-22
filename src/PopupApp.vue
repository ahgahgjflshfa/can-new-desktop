<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import type { NotificationPriority } from '@/types/notification'
import { isSystemType } from '@/types/system'
import type { SystemType } from '@/types/system'
import { PopupRevisionGate, shouldClearLmaPopup } from '@/services/popupRevision'

interface NotificationPayload {
  id: string
  title: string
  body: string
  priority: NotificationPriority
  category?: string
  createdAt: string
  unreadCount: number
  metadata?: Record<string, unknown>
  revision: number
}

interface PopupClearedPayload { system: SystemType; revision: number }

const currentNotification = ref<NotificationPayload | null>(null)
const revisionGate = new PopupRevisionGate<NotificationPayload>()
let unlistenShow: UnlistenFn | null = null
let unlistenCleared: UnlistenFn | null = null
let lastSoundRevision = 0

function acceptNotification(notification: NotificationPayload): void {
  const revision = Number.isFinite(notification.revision) ? notification.revision : 0
  const result = revisionGate.accept({ ...notification, revision })
  if (!result.accepted) return
  currentNotification.value = revisionGate.currentPayload
  if (result.playSound) {
    lastSoundRevision = revision
    playNotificationSound()
  }
  void invoke('ack_popup_displayed', { notificationId: notification.id, revision }).catch(err =>
    logAppEvent('warn', 'popup', 'failed to acknowledge displayed notification', err))
}

function playNotificationSound() {
  if (typeof window === 'undefined') return

  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) {
    logAppEvent('warn', 'popup', 'notification sound unavailable because AudioContext is unsupported')
    return
  }

  try {
    const audioContext = new AudioContextConstructor()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const now = audioContext.currentTime

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.setValueAtTime(660, now + 0.12)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    oscillator.connect(gain)
    gain.connect(audioContext.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.36)

    oscillator.addEventListener('ended', () => {
      void audioContext.close().catch(err => {
        logAppEvent('warn', 'popup', 'failed to close notification sound audio context', err)
      })
    })
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to play notification sound', err)
  }
}

const priorityConfig: Record<
  NotificationPriority,
  {
    barClass: string
    iconClass: string
    iconBgClass: string
    badgeClass: string
    label: string
  }
> = {
  pending: {
    barClass: 'bg-[var(--app-danger)]',
    iconClass: 'i-mdi-alert-circle',
    iconBgClass: 'bg-[color:rgba(196,91,91,0.12)] text-[var(--app-danger)]',
    badgeClass: 'bg-[color:rgba(196,91,91,0.14)] text-[var(--app-danger)]',
    label: '待處理',
  },
  replied: {
    barClass: 'bg-[var(--app-warning)]',
    iconClass: 'i-mdi-progress-clock',
    iconBgClass: 'bg-[color:rgba(212,139,42,0.12)] text-[var(--app-warning)]',
    badgeClass: 'bg-[color:rgba(212,139,42,0.14)] text-[var(--app-warning)]',
    label: '已回覆',
  },
  completed: {
    barClass: 'bg-[var(--app-success)]',
    iconClass: 'i-mdi-check-circle',
    iconBgClass: 'bg-[color:rgba(63,143,107,0.12)] text-[var(--app-success)]',
    badgeClass: 'bg-[color:rgba(63,143,107,0.14)] text-[var(--app-success)]',
    label: '已完成',
  },
  ignored: {
    barClass: 'bg-[var(--app-muted-2)]',
    iconClass: 'i-mdi-eye-off',
    iconBgClass: 'bg-[color:rgba(147,143,153,0.12)] text-[var(--app-muted-2)]',
    badgeClass: 'bg-[color:rgba(147,143,153,0.14)] text-[var(--app-muted-2)]',
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

const priorityBarClass = computed(() => currentPriorityConfig.value.barClass)
const priorityIconBgClass = computed(() => currentPriorityConfig.value.iconBgClass)
const priorityBadgeClass = computed(() => currentPriorityConfig.value.badgeClass)

const formattedTime = computed(() => {
  if (!currentNotification.value) return ''
  const date = new Date(currentNotification.value.createdAt)
  return date.toLocaleString()
})

function getNotificationSystem(metadata?: Record<string, unknown>): SystemType | null {
  if (!metadata || !('system' in metadata)) return 'lma'
  const system = metadata.system
  return isSystemType(system) ? system : null
}

const notificationSystem = computed<SystemType | null>(() =>
  getNotificationSystem(currentNotification.value?.metadata)
)

async function openMainWindow() {
  const targetSystem = notificationSystem.value
  if (!targetSystem) {
    logAppEvent('warn', 'popup', 'refused to route notification with unknown system')
    return
  }
  logAppEvent('info', 'popup', 'requested opening main window from popup', { targetSystem })
  try {
    await invoke('show_emergency_window')
    await emit('open-notification-system', { system: targetSystem })
    await invoke('hide_alert_popup')
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to open main window from popup', err)
  }
}

onMounted(async () => {
  unlistenShow = await listen<NotificationPayload>('show-notification', event => {
    console.log('[Popup] Received show-notification event:', event.payload)
    logAppEvent('info', 'popup', 'received show-notification event', event.payload)
    acceptNotification(event.payload)
  })

  unlistenCleared = await listen<PopupClearedPayload>('popup-cleared', event => {
    revisionGate.clear(event.payload.revision)
    if (currentNotification.value !== null && shouldClearLmaPopup(
      event.payload.system,
      typeof currentNotification.value.metadata?.system === 'string' ? currentNotification.value.metadata.system : null,
      currentNotification.value.revision,
      event.payload.revision,
    )) {
      currentNotification.value = null
    }
  })

  try {
    console.log('[Popup] Calling get_pending_notification...')
    const pending = await invoke<NotificationPayload | null>('get_pending_notification')
    console.log('[Popup] get_pending_notification returned:', pending)
    if (pending) {
      logAppEvent('info', 'popup', 'loaded pending notification on mount', { notificationId: pending.id })
      acceptNotification(pending)
    }
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to get pending notification', err)
    console.warn('[Popup] Failed to get pending notification:', err)
  }
})

onUnmounted(() => {
  unlistenShow?.()
  unlistenCleared?.()
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
    <div class="shrink-0 border-t border-[var(--app-border)] px-4 pt-3 pb-3">
      <button
        type="button"
        class="w-full h-10 rounded-lg bg-[var(--app-primary)] text-[13px] font-bold text-white transition-colors hover:bg-[var(--app-primary-strong)] flex items-center justify-center gap-1.5"
        @click="openMainWindow"
      >
        開啟主程式
        <span class="i-mdi-open-in-new text-[13px]" />
      </button>
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
