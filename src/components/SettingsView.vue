<script setup lang="ts">
import { computed, ref } from 'vue'
import { exportAppLogs } from '@/services/logExportService'
import { getAppLogs, logAppEvent } from '@/services/appLogger'
import { useStore } from '@/store'
import { isTauriRuntime } from '@/tauri/window'

const store = useStore()

const minimizeOnClose = computed({
  get: () => store.minimizeToTrayOnClose,
  set: value => store.setMinimizeToTrayOnClose(value),
})

const autoLaunch = computed({
  get: () => store.autoLaunchEnabled,
  set: value => store.setAutoLaunchEnabled(value),
})

const logEntryCount = ref(getAppLogs().length)
const exportPath = ref<string | null>(null)
const exportError = ref<string | null>(null)
const isExportingLogs = ref(false)
const showDebugPanel = ref(false)
const isCopied = ref(false)

const debugInfo = computed(() => ({
  version: store.version,
  environment: isTauriRuntime() ? 'Tauri' : 'Browser',
  mode: import.meta.env.MODE,
  sharedSettings: {
    autoLaunchEnabled: store.autoLaunchEnabled,
    minimizeToTrayOnClose: store.minimizeToTrayOnClose,
  },
  logEntryCount: logEntryCount.value,
}))

async function copyDebugInfo() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(debugInfo.value, null, 2))
    isCopied.value = true
    setTimeout(() => {
      isCopied.value = false
    }, 2000)
  } catch (err) {
    logAppEvent('warn', 'settings', 'failed to copy shared debug info to clipboard', err)
  }
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
      <p class="mt-1 text-sm text-[var(--app-muted)]">管理共用的視窗行為與應用程式紀錄。</p>
    </div>

    <div class="space-y-6">
      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold text-[var(--app-fg)]">
          <span class="i-mdi-window-maximize inline-flex shrink-0 text-[1.2rem] leading-none text-[var(--app-primary-strong)]" />
          視窗行為
        </h2>

        <div class="space-y-4">
          <div class="flex items-center justify-between gap-6 py-2">
            <div class="flex flex-col">
              <label for="autostart-toggle" class="text-base font-medium text-[var(--app-fg)]">開機自動啟動</label>
              <span class="text-sm text-[var(--app-muted)]">系統開機時自動啟動應用程式</span>
            </div>

            <label class="relative inline-flex cursor-pointer items-center">
              <input id="autostart-toggle" type="checkbox" v-model="autoLaunch" class="peer sr-only" />
              <div class="h-6 w-11 rounded-full bg-[var(--app-control-bg)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--app-border)] after:bg-[var(--app-control-knob)] after:transition-all after:content-[''] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] peer-checked:bg-[var(--app-primary-strong)] peer-checked:after:translate-x-full" />
            </label>
          </div>

          <div class="flex items-center justify-between gap-6 py-2">
            <div class="flex flex-col">
              <label for="minimize-toggle" class="text-base font-medium text-[var(--app-fg)]">關閉時縮小到系統匣</label>
              <span class="text-sm text-[var(--app-muted)]">關閉視窗後仍讓應用程式在系統匣中持續執行</span>
            </div>

            <label class="relative inline-flex cursor-pointer items-center">
              <input id="minimize-toggle" type="checkbox" v-model="minimizeOnClose" class="peer sr-only" />
              <div class="h-6 w-11 rounded-full bg-[var(--app-control-bg)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--app-border)] after:bg-[var(--app-control-knob)] after:transition-all after:content-[''] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] peer-checked:bg-[var(--app-primary-strong)] peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>
      </div>

      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="mb-4 flex items-center gap-2 text-xl font-semibold text-[var(--app-fg)]">
          <span class="i-mdi-file-document-outline inline-flex shrink-0 text-[1.2rem] leading-none text-[var(--app-primary-strong)]" />
          診斷資訊
        </h2>

        <div class="flex items-center justify-between gap-6 py-2">
          <div class="flex flex-col">
            <span class="text-base font-medium text-[var(--app-fg)]">應用程式紀錄</span>
            <span class="mt-1 text-sm text-[var(--app-muted)]">目前保留 {{ logEntryCount }} 筆本機紀錄</span>
            <span v-if="exportPath" class="mt-2 break-all text-xs text-[var(--app-muted)]">上次匯出：{{ exportPath }}</span>
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

        <div class="mt-4 border-t border-[var(--app-border)] pt-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-base font-semibold text-[var(--app-fg)]">應用程式狀態</h3>
              <p class="mt-1 text-xs text-[var(--app-muted)]">只包含共用設定；各系統帳號與輪詢狀態請到各系統頁面查看。</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-full bg-[var(--app-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
                @click="showDebugPanel = !showDebugPanel"
              >
                {{ showDebugPanel ? '收起' : '展開' }}
              </button>
              <button
                type="button"
                class="rounded-full bg-[var(--app-primary-strong)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-primary)]"
                @click="copyDebugInfo"
              >
                {{ isCopied ? '已複製 ✓' : '複製' }}
              </button>
            </div>
          </div>

          <div v-if="showDebugPanel" class="mt-4 grid gap-2 md:grid-cols-3">
            <div class="rounded-xl bg-[var(--app-surface-2)] p-3 text-center">
              <div class="mb-1 text-[0.65rem] uppercase tracking-wider text-[var(--app-muted)]">版本</div>
              <div class="text-sm font-semibold text-[var(--app-fg)]">{{ debugInfo.version }}</div>
            </div>
            <div class="rounded-xl bg-[var(--app-surface-2)] p-3 text-center">
              <div class="mb-1 text-[0.65rem] uppercase tracking-wider text-[var(--app-muted)]">環境</div>
              <div class="text-sm font-semibold text-[var(--app-fg)]">{{ debugInfo.environment }}</div>
              <div class="text-[0.65rem] text-[var(--app-muted)]">{{ debugInfo.mode }}</div>
            </div>
            <div class="rounded-xl bg-[var(--app-surface-2)] p-3 text-center">
              <div class="mb-1 text-[0.65rem] uppercase tracking-wider text-[var(--app-muted)]">紀錄</div>
              <div class="text-sm font-semibold text-[var(--app-fg)]">{{ debugInfo.logEntryCount }} 筆</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
