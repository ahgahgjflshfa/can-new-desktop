<script setup lang="ts">
import { computed, ref } from 'vue'
import { exportAppLogs } from '@/services/logExportService'
import { getAppLogs, logAppEvent } from '@/services/appLogger'
import { useStore } from '@/store'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useStore()
const notificationStore = useNotificationStore()

const minimizeOnClose = computed({
  get: () => store.minimizeToTrayOnClose,
  set: value => store.setMinimizeToTrayOnClose(value),
})

const pollingEnabled = computed({
  get: () => notificationStore.pollingEnabled,
  set: value => notificationStore.setPollingEnabled(value),
})

const pollingInterval = ref(notificationStore.pollingIntervalSeconds)
const logEntryCount = ref(getAppLogs().length)
const exportPath = ref<string | null>(null)
const exportError = ref<string | null>(null)
const isExportingLogs = ref(false)

const intervalOptions = [
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分鐘' },
  { value: 120, label: '2 分鐘' },
  { value: 300, label: '5 分鐘' },
]

function handleIntervalChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const seconds = parseInt(target.value, 10)
  pollingInterval.value = seconds
  notificationStore.setPollingInterval(seconds)
}

async function handleExportLogs() {
  if (isExportingLogs.value) return

  isExportingLogs.value = true
  exportError.value = null

  try {
    exportPath.value = await exportAppLogs()
    logEntryCount.value = getAppLogs().length
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'settings', 'failed to export application logs', err)
  } finally {
    isExportingLogs.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-6 md:px-8 md:py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight text-[var(--app-fg-strong)]">設定</h1>
      <p class="mt-1 text-sm text-[var(--app-muted)]">管理通知、視窗行為與應用程式紀錄。</p>
    </div>

    <div class="space-y-6">
      <!-- Section: Notifications -->
      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-bell-ring inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          通知
        </h2>

        <div class="space-y-4">
          <div class="flex items-center justify-between py-2">
            <div class="flex flex-col">
              <label for="polling-toggle" class="text-base font-medium text-[var(--app-fg)]">啟用輪詢</label>
              <span class="text-sm text-[var(--app-muted)]">自動向伺服器檢查是否有新的警示</span>
            </div>

            <label class="relative inline-flex items-center cursor-pointer">
              <input id="polling-toggle" type="checkbox" v-model="pollingEnabled" class="sr-only peer" />
              <div
                class="w-11 h-6 bg-[var(--app-control-bg)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--app-control-knob)] after:border-[var(--app-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--app-primary-strong)]"
              ></div>
            </label>
          </div>

          <div class="flex items-center justify-between py-2">
            <div class="flex flex-col">
              <span class="text-base font-medium text-[var(--app-fg)]">輪詢間隔</span>
              <span class="text-sm text-[var(--app-muted)]">檢查新警示的頻率</span>
            </div>

            <select
              :value="pollingInterval"
              :disabled="!pollingEnabled"
              class="px-3 py-2 rounded-lg bg-[var(--app-surface-2)] border border-[var(--app-border)] text-[var(--app-fg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
              @change="handleIntervalChange"
            >
              <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div v-if="notificationStore.isPolling" class="flex items-center gap-2 text-sm text-[var(--app-muted)] pt-2">
            <span class="w-2 h-2 rounded-full bg-[var(--app-success)] animate-pulse" />
            <span>輪詢中</span>
            <span class="text-[var(--app-muted-2)]">•</span>
            <span>已完成 {{ notificationStore.pollingStats.pollCount }} 次輪詢</span>
          </div>

          <div
            v-if="notificationStore.lastError"
            class="rounded-lg border border-[color:rgba(196,91,91,0.35)] bg-[color:rgba(196,91,91,0.08)] p-3 text-sm text-[var(--app-danger)]"
          >
            <span class="i-mdi-alert-circle mr-2" />
            {{ notificationStore.lastError }}
          </div>
        </div>
      </div>

      <!-- Section: Window Behavior -->
      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-window-maximize inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          視窗行為
        </h2>

        <div class="flex items-center justify-between py-2">
          <div class="flex flex-col">
            <label for="minimize-toggle" class="text-base font-medium text-[var(--app-fg)]">關閉時縮小到系統匣</label>
            <span class="text-sm text-[var(--app-muted)]">關閉視窗後仍讓應用程式在系統匣中持續執行</span>
          </div>

          <label class="relative inline-flex items-center cursor-pointer">
            <input id="minimize-toggle" type="checkbox" v-model="minimizeOnClose" class="sr-only peer" />
            <div
              class="w-11 h-6 bg-[var(--app-control-bg)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--app-control-knob)] after:border-[var(--app-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--app-primary-strong)]"
            ></div>
          </label>
        </div>
      </div>

      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-file-document-outline inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          診斷資訊
        </h2>

        <div class="flex items-center justify-between gap-6 py-2">
          <div class="flex flex-col">
            <span class="text-base font-medium text-[var(--app-fg)]">應用程式紀錄</span>
            <span v-if="exportPath" class="mt-2 text-xs text-[var(--app-muted)] break-all"
              >上次匯出：{{ exportPath }}</span
            >
            <span v-if="exportError" class="mt-2 text-xs text-[var(--app-danger)]">{{ exportError }}</span>
          </div>

          <button
            type="button"
            class="rounded-full bg-[var(--app-primary-strong)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--app-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="isExportingLogs"
            @click="handleExportLogs"
          >
            {{ isExportingLogs ? 'Exporting…' : 'Export Log' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
