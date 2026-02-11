<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
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
let unlistenShow: UnlistenFn | null = null
let unlistenHide: UnlistenFn | null = null

const priorityConfig: Record<NotificationPriority, { bgClass: string; iconClass: string; label: string }> = {
  pending: {
    bgClass: 'bg-red-500/80 border-red-600',
    iconClass: 'i-mdi-alert-circle text-red-100',
    label: 'PENDING',
  },
  replied: {
    bgClass: 'bg-orange-500/80 border-orange-600',
    iconClass: 'i-mdi-progress-clock text-orange-100',
    label: 'REPLIED',
  },
  completed: {
    bgClass: 'bg-green-500/80 border-green-600',
    iconClass: 'i-mdi-check-circle text-green-100',
    label: 'COMPLETED',
  },
  ignored: {
    bgClass: 'bg-slate-500/80 border-slate-600',
    iconClass: 'i-mdi-eye-off text-slate-100',
    label: 'IGNORED',
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
  await invoke('show_emergency_window')
}

onMounted(async () => {
  unlistenShow = await listen<NotificationPayload>('show-notification', event => {
    console.log('[Popup] Received show-notification event:', event.payload)
    currentNotification.value = event.payload
  })

  unlistenHide = await listen('hide-notification', () => {
    currentNotification.value = null
  })

  try {
    console.log('[Popup] Calling get_pending_notification...')
    const pending = await invoke<NotificationPayload | null>('get_pending_notification')
    console.log('[Popup] get_pending_notification returned:', pending)
    if (pending) {
      currentNotification.value = pending
    }
  } catch (err) {
    console.warn('[Popup] Failed to get pending notification:', err)
  }
})

onUnmounted(() => {
  unlistenShow?.()
  unlistenHide?.()
})
</script>

<template>
  <div
    v-if="currentNotification"
    class="h-screen w-screen flex flex-col overflow-hidden select-none"
    :class="currentPriorityConfig.bgClass"
  >
    <!-- Draggable title bar -->
    <div data-tauri-drag-region class="shrink-0 h-8 flex items-center justify-between px-3 bg-black/20 cursor-move">
      <span class="text-xs font-semibold text-white/90 uppercase tracking-wider"> Emergency Alert </span>
      <span class="text-xs text-white/70"> {{ currentNotification.unreadCount }} pending </span>
    </div>

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
        </div>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="shrink-0 border-t border-black/20 p-2">
      <button
        type="button"
        class="w-full px-4 py-3 text-sm font-semibold text-white hover:bg-black/20 transition-colors"
        @click="openMainWindow"
      >
        <span class="i-mdi-open-in-new mr-1.5" />
        Open main app to reply / complete
      </button>
    </div>
  </div>

  <!-- Loading/empty state (shouldn't normally be visible) -->
  <div v-else class="h-screen w-screen flex items-center justify-center bg-neutral-900">
    <p class="text-neutral-500 text-sm">Waiting for alerts...</p>
  </div>
</template>
