<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/authStore'
import { fetchCanTasks, completeCanTask } from '@/services/canTaskService'
import { logAppEvent } from '@/services/appLogger'
import type { CanTask } from '@/types/can'

const authStore = useAuthStore()
const tasks = ref<CanTask[]>([])
const activeTab = ref<'active' | 'completed'>('active')
const isLoading = ref(false)
const error = ref<string | null>(null)
const isActionPending = ref(false)
const actionError = ref<string | null>(null)
let pollInterval: ReturnType<typeof setInterval> | null = null

const activeTasks = computed(() => tasks.value.filter(t => !t.isDone))
const completedTasks = computed(() => tasks.value.filter(t => t.isDone))
const visibleTasks = computed(() => activeTab.value === 'active' ? activeTasks.value : completedTasks.value)

const userStation = computed(() => {
  if (authStore.user && 'station' in authStore.user) {
    return authStore.user.station
  }
  return ''
})

async function loadTasks() {
  if (!authStore.token || !userStation.value) return
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchCanTasks(authStore.token, userStation.value)
    tasks.value = result
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'can-task-view', 'failed to load tasks', err)
  } finally {
    isLoading.value = false
  }
}

function startPolling() {
  if (pollInterval) return
  void loadTasks()
  pollInterval = setInterval(() => {
    void loadTasks()
  }, 10000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function handleComplete(serialNumber: number, resolutionType: number) {
  if (!authStore.token || isActionPending.value) return
  isActionPending.value = true
  actionError.value = null
  try {
    await completeCanTask(authStore.token, serialNumber, true, resolutionType)
    const task = tasks.value.find(t => t.serialNumber === serialNumber)
    if (task) {
      task.isDone = true
      task.resolutionType = resolutionType
    }
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'can-task-view', 'failed to complete task', err)
  } finally {
    isActionPending.value = false
  }
}

async function handleMarkIncomplete(serialNumber: number) {
  if (!authStore.token || isActionPending.value) return
  isActionPending.value = true
  actionError.value = null
  try {
    await completeCanTask(authStore.token, serialNumber, false)
    const task = tasks.value.find(t => t.serialNumber === serialNumber)
    if (task) {
      task.isDone = false
      task.resolutionType = 0
    }
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'can-task-view', 'failed to mark incomplete', err)
  } finally {
    isActionPending.value = false
  }
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

onMounted(() => {
  if (authStore.isAuthenticated && userStation.value) {
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})

watch(() => authStore.isAuthenticated, (isAuth) => {
  if (isAuth && userStation.value) {
    startPolling()
  } else {
    stopPolling()
    tasks.value = []
  }
})
</script>

<template>
  <div class="min-h-full">
    <div class="sticky top-0 z-10 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 md:px-8">
      <div class="mx-auto flex max-w-5xl items-center justify-center gap-10 overflow-x-auto">
        <div v-if="activeTasks.length > 0" class="absolute right-6 hidden md:block lg:right-8">
          <span class="rounded-full bg-[var(--app-danger)]/10 px-3 py-1 text-sm font-medium text-[var(--app-danger)]">
            {{ activeTasks.length }} 筆待處理
          </span>
        </div>

        <div class="flex items-center gap-6 overflow-x-auto">
          <button
            type="button"
            class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold transition-colors"
            :class="activeTab === 'active' ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)] hover:text-[var(--app-fg)]'"
            @click="activeTab = 'active'"
          >
            進行中任務 ({{ activeTasks.length }})
            <span v-if="activeTab === 'active'" class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]" />
          </button>

          <button
            type="button"
            class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold transition-colors"
            :class="activeTab === 'completed' ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)] hover:text-[var(--app-fg)]'"
            @click="activeTab = 'completed'"
          >
            已完成任務
            <span v-if="activeTab === 'completed'" class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]" />
          </button>
        </div>
      </div>
    </div>

    <div class="mx-auto max-w-5xl px-6 py-6 md:px-8 md:py-8">
      <div class="overflow-hidden rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)]">
        <div class="flex items-center justify-between border-b border-[var(--app-border)] p-4">
          <h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--app-fg)]">
            <div class="i-mdi-broom text-[var(--app-primary-strong)]" />
            {{ activeTab === 'active' ? '進行中' : '已完成' }}
          </h2>
          <div v-if="isLoading" class="text-sm text-[var(--app-muted)]">載入中...</div>
        </div>

        <div v-if="error" class="mx-4 mt-4 rounded-lg border border-[var(--app-danger)]/20 bg-[var(--app-danger)]/10 px-3 py-2 text-sm text-[var(--app-danger)]">
          {{ error }}
        </div>

        <div v-if="actionError" class="mx-4 mt-4 rounded-lg border border-[var(--app-danger)]/20 bg-[var(--app-danger)]/10 px-3 py-2 text-sm text-[var(--app-danger)]">
          {{ actionError }}
        </div>

        <div v-if="visibleTasks.length === 0 && !isLoading" class="p-12 text-center">
          <div class="mx-auto mb-3 text-4xl text-[var(--app-muted-2)] i-mdi-broom" />
          <p class="text-[var(--app-muted)]">
            {{ activeTab === 'active' ? '目前沒有進行中的任務' : '目前沒有已完成任務' }}
          </p>
          <p class="text-sm text-[var(--app-muted-2)]">
            {{ activeTab === 'active' ? '新的溢滿回報任務會顯示在這裡' : '完成的任務會顯示在這裡' }}
          </p>
        </div>

        <div v-else class="divide-y divide-[var(--app-border)]">
          <div
            v-for="task in visibleTasks"
            :key="task.serialNumber"
            class="border-l-4 p-4 transition-colors hover:bg-[var(--app-hover)]"
            :class="[
              task.isDone ? 'border-l-[var(--app-success)]' : 'border-l-[var(--app-danger)]',
              task.isDone ? 'opacity-80' : '',
            ]"
          >
            <div class="flex items-start gap-3">
              <span :class="task.isDone ? 'i-mdi-check-circle text-[var(--app-success)]' : 'i-mdi-alert-circle text-[var(--app-danger)]'" class="mt-0.5 shrink-0 text-xl" />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-semibold truncate text-[var(--app-fg)]">
                    {{ task.station }} {{ task.trashBin }}
                  </h3>
                  <span class="shrink-0 px-2 py-0.5 text-xs font-medium rounded" :class="task.isDone ? 'bg-[var(--app-success)]/10 text-[var(--app-success)]' : 'bg-[var(--app-danger)]/10 text-[var(--app-danger)]'">
                    {{ task.isDone ? '已完成' : '待處理' }}
                  </span>
                </div>

                <div class="flex items-center gap-4 text-xs text-[var(--app-muted-2)]">
                  <span>
                    <span class="i-mdi-clock-outline mr-1" />
                    {{ formatDate(task.createdAt) }}
                  </span>
                  <span v-if="task.informTime > 0">
                    通知 {{ task.informTime }} 次
                  </span>
                </div>

                <div v-if="!task.isDone" class="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="rounded-full bg-[var(--app-success)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    :disabled="isActionPending"
                    @click="handleComplete(task.serialNumber, 1)"
                  >
                    已完成
                  </button>
                  <button
                    type="button"
                    class="rounded-full bg-[var(--app-warning)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    :disabled="isActionPending"
                    @click="handleComplete(task.serialNumber, 2)"
                  >
                    無髒污
                  </button>
                </div>

                <div v-else class="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="rounded-full bg-[var(--app-muted)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    :disabled="isActionPending"
                    @click="handleMarkIncomplete(task.serialNumber)"
                  >
                    標記未完成
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
