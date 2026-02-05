<script setup lang="ts">
import { computed } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationPriority } from '@/types/notification'

const notificationStore = useNotificationStore()

const priorityConfig: Record<NotificationPriority, { bgClass: string; iconClass: string; label: string }> = {
  critical: {
    bgClass: 'bg-red-500/80 border-red-500',
    iconClass: 'i-mdi-alert-circle text-red-200',
    label: 'CRITICAL',
  },
  high: {
    bgClass: 'bg-orange-500/80 border-orange-500',
    iconClass: 'i-mdi-alert text-orange-200',
    label: 'HIGH',
  },
  medium: {
    bgClass: 'bg-yellow-500/80 border-yellow-500',
    iconClass: 'i-mdi-alert-outline text-yellow-200',
    label: 'MEDIUM',
  },
  low: {
    bgClass: 'bg-blue-500/80 border-blue-500',
    iconClass: 'i-mdi-information text-blue-200',
    label: 'LOW',
  },
}

const currentPriorityConfig = computed(() => {
  if (!notificationStore.currentNotification) return priorityConfig.high
  return priorityConfig[notificationStore.currentNotification.priority]
})

const formattedTime = computed(() => {
  if (!notificationStore.currentNotification) return ''
  const date = new Date(notificationStore.currentNotification.createdAt)
  return date.toLocaleString()
})

function handleDismiss() {
  notificationStore.dismissCurrentNotification()
}

function handleDismissAll() {
  notificationStore.dismissAllNotifications()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="notificationStore.hasNewNotification"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        @click.self="handleDismiss"
      >
        <div
          class="w-full max-w-2xl mx-4 rounded-2xl border-2 bg-[var(--app-surface)] shadow-2xl shadow-black/50 overflow-hidden"
          :class="currentPriorityConfig.bgClass"
        >
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div
                class="shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-3xl"
                :class="currentPriorityConfig.bgClass"
              >
                <span :class="currentPriorityConfig.iconClass" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="px-2 py-0.5 text-xs font-bold rounded uppercase tracking-wider"
                    :class="currentPriorityConfig.bgClass"
                  >
                    {{ currentPriorityConfig.label }}
                  </span>
                  <span
                    v-if="notificationStore.currentNotification?.category"
                    class="px-2 py-0.5 text-xs font-medium rounded bg-[var(--app-surface-2)] text-[var(--app-muted)]"
                  >
                    {{ notificationStore.currentNotification.category }}
                  </span>
                </div>

                <h2 class="text-2xl font-bold text-[var(--app-fg-strong)] mb-3 leading-tight">
                  {{ notificationStore.currentNotification?.title }}
                </h2>

                <p class="text-base text-[var(--app-fg)] leading-relaxed">
                  {{ notificationStore.currentNotification?.body }}
                </p>

                <div class="mt-4 text-sm text-[var(--app-muted)]">
                  <span class="i-mdi-clock-outline mr-1" />
                  {{ formattedTime }}
                </div>
              </div>
            </div>
          </div>

          <div class="flex border-t border-[var(--app-border)] bg-[var(--app-surface-2)]">
            <button
              type="button"
              class="flex-1 px-6 py-4 text-base font-medium text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)] transition-colors border-r border-[var(--app-border)]"
              @click="handleDismissAll"
            >
              <span class="i-mdi-notification-clear-all mr-2" />
              Dismiss All ({{ notificationStore.unreadCount }})
            </button>

            <button
              type="button"
              class="flex-1 px-6 py-4 text-base font-semibold text-sky-400 hover:bg-sky-500/10 transition-colors"
              @click="handleDismiss"
            >
              <span class="i-mdi-check mr-2" />
              Acknowledge
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-active > div,
.modal-leave-active > div {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from > div,
.modal-leave-to > div {
  transform: scale(0.9) translateY(-20px);
}
</style>
