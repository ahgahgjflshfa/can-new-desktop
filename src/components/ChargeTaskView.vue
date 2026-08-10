<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import SystemSettingsPanel from '@/components/SystemSettingsPanel.vue'

const notificationStore = useNotificationStore()
const activeTab = ref<'active' | 'completed' | 'settings'>('active')
const activeTasks = computed(() => notificationStore.chargeActiveTasks)
const completedTasks = computed(() => notificationStore.chargeCompletedTasks)
const tasks = computed(() => activeTab.value === 'active' ? activeTasks.value : completedTasks.value)
const isLoading = computed(() => notificationStore.chargeRequestInFlight)
const error = computed(() => notificationStore.chargePollingLastError)
const actionError = ref<string | null>(null)
const isActionPending = ref(false)

function formatDate(value: string) { const diff = Date.now() - new Date(value).getTime(); const mins = Math.floor(diff / 60000); if (mins < 1) return '剛剛'; if (mins < 60) return `${mins} 分鐘前`; const hours = Math.floor(mins / 60); if (hours < 24) return `${hours} 小時前`; return new Date(value).toLocaleDateString() }
async function refresh() { await notificationStore.refreshChargeTasks() }
async function updateTask(serialNumber: number, isDone: boolean) { if (isActionPending.value) return; isActionPending.value = true; actionError.value = null; try { await notificationStore.completeChargeTask(serialNumber, isDone) } catch (error) { actionError.value = error instanceof Error ? error.message : (typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)) } finally { isActionPending.value = false } }
</script>

<template>
  <div class="min-h-full">
    <div class="sticky top-0 z-10 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 md:px-8"><div class="mx-auto flex max-w-5xl items-center justify-center gap-6 overflow-x-auto">
      <button type="button" class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold" :class="activeTab === 'active' ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)]'" @click="activeTab = 'active'">進行中任務 ({{ activeTasks.length }})<span v-if="activeTab === 'active'" class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]" /></button>
      <button type="button" class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold" :class="activeTab === 'completed' ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)]'" @click="activeTab = 'completed'">已完成任務<span v-if="activeTab === 'completed'" class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]" /></button>
      <button type="button" class="relative whitespace-nowrap px-2 pb-5 pt-4 text-lg font-semibold" :class="activeTab === 'settings' ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)]'" @click="activeTab = 'settings'">設定<span v-if="activeTab === 'settings'" class="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[var(--app-primary)]" /></button>
    </div></div>
    <div class="mx-auto max-w-5xl px-6 py-6 md:px-8 md:py-8">
      <SystemSettingsPanel v-if="activeTab === 'settings'" system="charge" />
      <div v-else class="overflow-hidden rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)]">
        <div class="flex items-center justify-between border-b border-[var(--app-border)] p-4"><h2 class="flex items-center gap-2 text-xl font-semibold"><span class="i-mdi-ev-station text-[var(--app-primary-strong)]" />{{ activeTab === 'active' ? '進行中' : '已完成' }}</h2><button type="button" class="rounded-lg px-3 py-1.5 text-[var(--app-muted)] hover:bg-[var(--app-hover)]" @click="refresh"><span class="i-mdi-refresh" /></button></div>
        <div v-if="error" class="mx-4 mt-4 rounded-lg border border-[var(--app-danger)]/20 bg-[var(--app-danger)]/10 px-3 py-2 text-sm text-[var(--app-danger)]">{{ error }}</div><div v-if="actionError" class="mx-4 mt-4 rounded-lg border border-[var(--app-danger)]/20 bg-[var(--app-danger)]/10 px-3 py-2 text-sm text-[var(--app-danger)]">{{ actionError }}</div>
        <div v-if="tasks.length === 0 && isLoading" class="p-12 text-center text-[var(--app-muted)]">載入中...</div><div v-else-if="tasks.length === 0" class="p-12 text-center text-[var(--app-muted)]">目前沒有{{ activeTab === 'active' ? '進行中' : '已完成' }}的任務</div>
        <div v-else class="divide-y divide-[var(--app-border)]"><div v-for="task in tasks" :key="task.serialNumber" class="border-l-4 p-4" :class="task.isDone ? 'border-l-[var(--app-success)] opacity-80' : 'border-l-[var(--app-danger)]'"><div class="flex items-start gap-3"><span class="mt-0.5 text-xl" :class="task.isDone ? 'i-mdi-check-circle text-[var(--app-success)]' : 'i-mdi-alert-circle text-[var(--app-danger)]'" /><div class="min-w-0 flex-1"><div class="mb-1 flex items-center gap-2"><h3 class="truncate font-semibold">{{ task.deviceCode }}</h3><span class="rounded px-2 py-0.5 text-xs" :class="task.isDone ? 'bg-[var(--app-success)]/10 text-[var(--app-success)]' : 'bg-[var(--app-danger)]/10 text-[var(--app-danger)]'">{{ task.isDone ? '已完成' : '待處理' }}</span></div><div class="text-sm text-[var(--app-muted)]">{{ task.station }}</div><div class="mt-2 text-xs text-[var(--app-muted-2)]"><span class="i-mdi-clock-outline mr-1" />{{ formatDate(task.createdAt) }}<span v-if="task.cleanAt"> · 清理：{{ formatDate(task.cleanAt) }}</span><span v-if="task.informTime > 0"> · 通知 {{ task.informTime }} 次</span></div><div class="mt-3"><button type="button" class="rounded-full px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" :class="task.isDone ? 'bg-[var(--app-warning)]' : 'bg-[var(--app-success)]'" :disabled="isActionPending" @click="updateTask(task.serialNumber, !task.isDone)">{{ task.isDone ? '重新開啟' : '已完成' }}</button></div></div></div></div></div>
      </div>
    </div>
  </div>
</template>
