<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import type { NotificationPriority } from '@/types/notification'
import { isSystemType, type SystemType } from '@/types/system'
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
  revision?: number
}

interface NotificationSnapshot {
  revision: number
  notifications: NotificationPayload[]
}

interface PopupClearedPayload { system?: SystemType; revision: number }
interface GatePayload { id: string; revision: number }

const currentSnapshot = ref<NotificationSnapshot | null>(null)
// Keep the gate in the popup. Events and the pending read can arrive in either order.
const revisionGate = new PopupRevisionGate<GatePayload>()
let unlistenShow: UnlistenFn | null = null
let unlistenCleared: UnlistenFn | null = null

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asNotifications(value: unknown): NotificationPayload[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => {
    const record = asRecord(item)
    return typeof record?.id === 'string' && typeof record?.title === 'string'
  }) as NotificationPayload[]
}

/** Accept the old single-notification wire format while the Rust lane rolls out snapshots. */
function normalizeSnapshot(value: unknown): NotificationSnapshot | null {
  const record = asRecord(value)
  if (!record) return null

  const notifications = Array.isArray(record.notifications)
    ? asNotifications(record.notifications)
    : [record as unknown as NotificationPayload]
  const revisions = notifications.map(item => Number(item.revision)).filter(Number.isFinite)
  const revision = Number(record.revision)
  const resolvedRevision = Number.isFinite(revision) ? revision : Math.max(0, ...revisions)
  return { revision: resolvedRevision, notifications: notifications.map(item => ({ ...item, revision: Number.isFinite(Number(item.revision)) ? Number(item.revision) : resolvedRevision })) }
}

function systemFor(notification: NotificationPayload): SystemType | null {
  const value = notification.metadata?.system
  if (value === undefined) return 'lma' // legacy notifications were LMA alerts
  return isSystemType(value) ? value : null
}

function acceptSnapshot(value: unknown): void {
  const snapshot = normalizeSnapshot(value)
  if (!snapshot || !Number.isFinite(snapshot.revision)) return
  const result = revisionGate.accept({ id: `snapshot-${snapshot.revision}`, revision: snapshot.revision })
  if (!result.accepted) return

  currentSnapshot.value = snapshot.notifications.length ? snapshot : null
  if (result.playSound) playNotificationSound()

  // A snapshot is one display unit. Do not acknowledge individual items: the
  // Rust command is moving to explicit batch-revision semantics.
  void invoke('ack_popup_displayed', { revision: snapshot.revision }).catch(err =>
    logAppEvent('warn', 'popup', 'failed to acknowledge displayed snapshot', err))
}

/** Windows uses native system notification sound from Rust; skip Web Audio to avoid double sound / autoplay issues. */
function isWindowsHost(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  return /Win/i.test(platform) || /Windows/i.test(ua)
}

function playNotificationSound() {
  // Never run Web Audio on Windows — Rust plays the OS notification sound via PlaySoundW.
  if (isWindowsHost()) return
  if (typeof window === 'undefined' || !window.AudioContext) return
  try {
    const context = new window.AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.setValueAtTime(660, now + 0.12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.36)
    oscillator.addEventListener('ended', () => { void context.close().catch(() => undefined) })
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to play notification sound', err)
  }
}

const priorityConfig: Record<NotificationPriority, { bar: string; icon: string; label: string }> = {
  pending: { bar: 'bg-[var(--app-danger)]', icon: 'i-mdi-alert-circle', label: '待處理' },
  replied: { bar: 'bg-[var(--app-warning)]', icon: 'i-mdi-progress-clock', label: '已回覆' },
  completed: { bar: 'bg-[var(--app-success)]', icon: 'i-mdi-check-circle', label: '已完成' },
  ignored: { bar: 'bg-[var(--app-muted-2)]', icon: 'i-mdi-eye-off', label: '已忽略' },
}

const groups = computed(() => {
  const all = currentSnapshot.value?.notifications ?? []
  return (['lma', 'can', 'charge'] as SystemType[]).map(system => ({
    system,
    label: system === 'lma' ? 'LMA' : system === 'can' ? 'CAN' : 'Charge',
    items: all.filter(item => systemFor(item) === system),
  })).filter(group => group.items.length)
})

function metadataText(notification: NotificationPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = notification.metadata?.[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }
  return null
}

function detailFor(notification: NotificationPayload, system: SystemType): string {
  if (system === 'lma') {
    const task = metadataText(notification, ['task', 'taskName', 'task_name'])
    const location = metadataText(notification, ['location', 'locationName', 'location_name'])
    return [task, location].filter(Boolean).join(' · ') || notification.body
  }
  const keys = system === 'can'
    ? ['trashBinCode', 'trash_bin_code', 'binCode', 'bin_code', 'trashBin', 'code']
    : ['deviceCode', 'device_code', 'chargerCode', 'charger_code', 'device', 'charger', 'code']
  return metadataText(notification, keys) || notification.body
}

function timeFor(notification: NotificationPayload): string {
  const date = new Date(notification.createdAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const notificationSystem = computed<SystemType | null>(() => {
  const first = currentSnapshot.value?.notifications[0]
  return first ? systemFor(first) : null
})

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
  unlistenShow = await listen<unknown>('show-notification', event => {
    logAppEvent('info', 'popup', 'received show-notification event', event.payload)
    acceptSnapshot(event.payload)
  })
  unlistenCleared = await listen<PopupClearedPayload>('popup-cleared', event => {
    revisionGate.clear(event.payload.revision)
    const snapshot = currentSnapshot.value
    if (!snapshot) return
    // Newer closure events may only carry the snapshot revision. In that
    // shape, close the complete batch rather than guessing at a task.
    if (!event.payload.system) {
      if (snapshot.revision <= event.payload.revision) currentSnapshot.value = null
      return
    }
    const clearedSystem = event.payload.system
    const remaining = snapshot.notifications.filter(notification => !shouldClearLmaPopup(
      clearedSystem,
      systemFor(notification),
      snapshot.revision,
      event.payload.revision,
    ))
    currentSnapshot.value = remaining.length ? { ...snapshot, notifications: remaining } : null
  })
  try {
    const pending = await invoke<unknown>('get_pending_notification')
    if (pending) acceptSnapshot(pending)
  } catch (err) {
    logAppEvent('warn', 'popup', 'failed to get pending notification', err)
  }
})

onUnmounted(() => { unlistenShow?.(); unlistenCleared?.() })
</script>

<template>
  <div v-if="currentSnapshot" class="h-screen w-screen flex flex-col overflow-hidden select-none bg-[var(--app-surface)] text-[var(--app-fg)] font-sans antialiased">
    <div class="h-1 shrink-0 bg-[var(--app-primary)]" />
    <main class="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-2">
      <div class="mb-3 flex items-end justify-between gap-3">
        <div>
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--app-primary-strong)]">即時警示</p>
          <h1 class="mt-0.5 text-[1.2rem] font-bold leading-tight text-[var(--app-fg-strong)]">待處理通知</h1>
        </div>
        <span class="rounded-full bg-[var(--app-primary)]/10 px-2 py-1 text-[11px] font-semibold text-[var(--app-primary-strong)]">{{ currentSnapshot.notifications.length }} 筆</span>
      </div>

      <section v-for="group in groups" :key="group.system" class="mb-3 last:mb-0">
        <div class="mb-1.5 flex items-center gap-2">
          <span class="h-1.5 w-1.5 rounded-full bg-[var(--app-primary)]" />
          <h2 class="text-[11px] font-bold tracking-wide text-[var(--app-muted)]">{{ group.label }}</h2>
          <span class="text-[10px] text-[var(--app-muted-2)]">{{ group.items.length }}</span>
        </div>
        <div class="overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)]/70">
          <article v-for="(notification, index) in group.items" :key="notification.id" class="relative px-3 py-2.5" :class="index ? 'border-t border-[var(--app-border)]' : ''">
            <div class="absolute inset-y-0 left-0 w-0.5" :class="priorityConfig[notification.priority]?.bar || priorityConfig.pending.bar" />
            <div class="flex items-start justify-between gap-2 pl-1">
              <div class="min-w-0">
                <div class="mb-0.5 flex items-center gap-1.5">
                  <span class="truncate text-[13px] font-semibold text-[var(--app-fg-strong)]">{{ notification.title }}</span>
                  <span class="shrink-0 rounded px-1 py-px text-[9px] font-semibold" :class="notification.priority === 'pending' ? 'bg-[var(--app-danger)]/10 text-[var(--app-danger)]' : 'bg-[var(--app-muted-2)]/10 text-[var(--app-muted-2)]'">{{ priorityConfig[notification.priority]?.label || '待處理' }}</span>
                </div>
                <p class="truncate text-[11px] text-[var(--app-muted)]">{{ detailFor(notification, group.system) }}</p>
              </div>
              <time class="shrink-0 pt-0.5 text-[10px] text-[var(--app-muted-2)]">{{ timeFor(notification) }}</time>
            </div>
          </article>
        </div>
      </section>
    </main>
    <div class="shrink-0 border-t border-[var(--app-border)] px-4 pt-3 pb-3">
      <button type="button" class="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--app-primary)] text-[13px] font-bold text-white transition-colors hover:bg-[var(--app-primary-strong)]" @click="openMainWindow">
        開啟主程式
        <span class="i-mdi-open-in-new text-[13px]" />
      </button>
    </div>
  </div>
  <div v-else class="h-screen w-screen flex items-center justify-center bg-[var(--app-surface)]">
    <div class="text-center"><div class="relative mx-auto mb-3 h-2 w-2"><div class="absolute inset-0 rounded-full bg-[var(--app-primary)] animate-ping opacity-60" /><div class="relative h-2 w-2 rounded-full bg-[var(--app-primary)]" /></div><p class="text-[var(--app-muted-2)] text-[13px]">等待警示中…</p></div>
  </div>
</template>
