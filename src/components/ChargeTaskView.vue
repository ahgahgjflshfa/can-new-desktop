<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotificationStore } from '@/stores/notificationStore'
import SystemSettingsPanel from '@/components/SystemSettingsPanel.vue'

const notificationStore = useNotificationStore()
const tasks = computed(() => notificationStore.chargeActiveTasks)
const presentationError = ref<string | null>(null)

async function refresh() {
  presentationError.value = null
  try { await notificationStore.refreshChargeTasks() } catch (error) { presentationError.value = error instanceof Error ? error.message : String(error) }
}
async function complete(serialNumber: number) {
  presentationError.value = null
  try { await notificationStore.completeChargeTask(serialNumber) } catch (error) { presentationError.value = error instanceof Error ? error.message : String(error) }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-6 md:px-8 md:py-8">
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-[var(--app-fg-strong)]">無線充故障</h1>
        <p class="mt-1 text-sm text-[var(--app-muted)]">無線充故障任務</p>
      </div>
      <button type="button" class="rounded-full bg-[var(--app-primary-strong)] px-4 py-2 text-sm font-semibold text-white" @click="refresh">重新整理</button>
    </div>
    <p v-if="presentationError" class="mb-4 text-sm text-[var(--app-danger)]">{{ presentationError }}</p>
    <p v-if="notificationStore.chargePollingLastError" class="mb-4 text-sm text-[var(--app-danger)]">{{ notificationStore.chargePollingLastError }}</p>
    <div v-if="tasks.length === 0" class="rounded-2xl bg-[var(--app-surface)] p-8 text-center text-[var(--app-muted)]">目前沒有無線充故障任務</div>
    <div v-else class="space-y-3">
      <article v-for="task in tasks" :key="task.serialNumber" class="rounded-2xl bg-[var(--app-surface)] p-4">
        <div class="font-semibold">{{ task.deviceCode }} · {{ task.faultDescription }}</div>
        <div class="mt-1 text-sm text-[var(--app-muted)]">{{ task.station }} · {{ task.faultType }}</div>
        <button type="button" class="mt-3 rounded-full bg-[var(--app-success)] px-3 py-1.5 text-xs font-semibold text-white" @click="complete(task.serialNumber)">完成</button>
      </article>
    </div>
    <SystemSettingsPanel system="charge" />
  </div>
</template>
