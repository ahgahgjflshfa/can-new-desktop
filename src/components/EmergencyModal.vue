<script setup lang="ts">
import { computed } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationPriority } from '@/types/notification'

const notificationStore = useNotificationStore()

const priorityConfig: Record<NotificationPriority, { bgClass: string; iconClass: string; label: string }> = {
  pending: {
    bgClass: 'bg-red-500/80 border-red-500',
    iconClass: 'i-mdi-alert-circle text-red-200',
    label: 'PENDING',
  },
  replied: {
    bgClass: 'bg-orange-500/80 border-orange-500',
    iconClass: 'i-mdi-progress-clock text-orange-200',
    label: 'REPLIED',
  },
  completed: {
    bgClass: 'bg-green-500/80 border-green-500',
    iconClass: 'i-mdi-check-circle text-green-200',
    label: 'COMPLETED',
  },
  ignored: {
    bgClass: 'bg-slate-500/80 border-slate-500',
    iconClass: 'i-mdi-eye-off text-slate-200',
    label: 'IGNORED',
  },
}

const currentPriorityConfig = computed(() => {
  if (!notificationStore.currentNotification) return priorityConfig.pending
  if (notificationStore.currentNotification.priority in priorityConfig) {
    return priorityConfig[notificationStore.currentNotification.priority]
  }
  return priorityConfig.pending
})

const formattedTime = computed(() => {
  if (!notificationStore.currentNotification) return ''
  const date = new Date(notificationStore.currentNotification.createdAt)
  return date.toLocaleString()
})

const canReply = computed(() => notificationStore.currentNotification?.priority === 'pending')
const canComplete = computed(() => notificationStore.currentNotification?.priority === 'replied')

function handleReply() {
  void notificationStore.replyCurrentTask()
}

function handleComplete(result: 'normal' | 'no_passenger') {
  void notificationStore.completeCurrentTask(result)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="notificationStore.hasNewNotification"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
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

          <div class="border-t border-[var(--app-border)] bg-[var(--app-surface-2)] p-3 space-y-2">
            <p v-if="notificationStore.taskActionError" class="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {{ notificationStore.taskActionError }}
            </p>

            <button
              v-if="canReply"
              type="button"
              class="w-full rounded-lg bg-sky-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
              :disabled="notificationStore.isTaskActionPending"
              @click="handleReply"
            >
              {{ notificationStore.isTaskActionPending ? 'Submitting...' : 'Reply (Take Task)' }}
            </button>

            <div v-if="canComplete" class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-60"
                :disabled="notificationStore.isTaskActionPending"
                @click="handleComplete('normal')"
              >
                Complete: Normal
              </button>

              <button
                type="button"
                class="rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-60"
                :disabled="notificationStore.isTaskActionPending"
                @click="handleComplete('no_passenger')"
              >
                Complete: No Passenger
              </button>
            </div>

            <p v-if="!canReply && !canComplete" class="px-2 py-1 text-sm text-[var(--app-muted)]">
              Waiting for updated task status...
            </p>
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
