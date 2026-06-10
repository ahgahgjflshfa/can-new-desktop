<script setup lang="ts">
import { computed, ref } from 'vue'
import { exportAppLogs } from '@/services/logExportService'
import { getAppLogs, logAppEvent } from '@/services/appLogger'
import { openCameraViewer } from '@/services/cameraViewerService'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'
import { useSystemStore } from '@/stores/systemStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { isTauriRuntime } from '@/tauri/window'

const store = useStore()
const authStore = useAuthStore()
const systemStore = useSystemStore()
const notificationStore = useNotificationStore()

const minimizeOnClose = computed({
  get: () => store.minimizeToTrayOnClose,
  set: value => store.setMinimizeToTrayOnClose(value),
})

  const pollingEnabled = computed({
    get: () => notificationStore.pollingEnabled,
    set: value => notificationStore.setPollingEnabled(value),
  })

  const canPollingEnabled = computed({
    get: () => notificationStore.canPollingEnabled,
    set: value => notificationStore.setCanPollingEnabled(value),
  })

  const autoLaunch = computed({
    get: () => store.autoLaunchEnabled,
    set: value => store.setAutoLaunchEnabled(value),
  })

const pollingInterval = ref(notificationStore.pollingIntervalSeconds)
const canPollingInterval = ref(notificationStore.canPollingIntervalSeconds)
const logEntryCount = ref(getAppLogs().length)
const exportPath = ref<string | null>(null)
const exportError = ref<string | null>(null)
const isExportingLogs = ref(false)
const cameraViewerError = ref<string | null>(null)
const isOpeningCameraViewer = ref(false)

const cameraViewerUrl = computed({
  get: () => store.cameraViewerUrl,
  set: value => store.setCameraViewerUrl(value),
})

const debugInfo = computed(() => {
  const storage: Record<string, string | null> = {}
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('tauri-app')) {
        storage[key] = localStorage.getItem(key)
      }
    }
  }

  const isCanUser = authStore.user && 'station' in authStore.user
  const lmaRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tauri-app:auth:lma') : null
  const canRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tauri-app:auth:can') : null
  const oldRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tauri-app:auth') : null

  return {
    version: store.version,
    environment: isTauriRuntime() ? 'Tauri' : 'Browser',
    mode: import.meta.env.MODE,
    currentSystem: systemStore.currentView,
    currentSystemLabel: systemStore.currentSystemLabel,
    lmaAuthenticated: systemStore.isLmaAuthenticated,
    canAuthenticated: systemStore.isCanAuthenticated,
    authStore: {
      isAuthenticated: authStore.isAuthenticated,
      currentSystem: authStore.currentSystem,
      displayName: authStore.displayName,
      userType: isCanUser ? 'CAN' : 'LMA',
      user: authStore.user,
      tokenPreview: authStore.token ? `${authStore.token.slice(0, 20)}...` : null,
      isHydrated: authStore.isHydrated,
      isSubmitting: authStore.isSubmitting,
      lastError: authStore.lastError,
    },
    polling: {
      isPolling: notificationStore.isPolling,
      pollingEnabled: notificationStore.pollingEnabled,
      canPollingEnabled: notificationStore.canPollingEnabled,
      pollingIntervalMs: notificationStore.pollingIntervalMs,
      canPollingIntervalMs: notificationStore.canPollingIntervalMs,
      stats: notificationStore.pollingStats,
      lastError: notificationStore.lastError,
    },
    localStorage: storage,
    rawStorage: {
      lma: lmaRaw,
      can: canRaw,
      old: oldRaw,
    },
  }
})

const showDebugPanel = ref(false)
const isCopied = ref(false)

async function copyDebugInfo() {
  const text = JSON.stringify(debugInfo.value, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    isCopied.value = true
    setTimeout(() => isCopied.value = false, 2000)
  } catch {
    logAppEvent('warn', 'settings', 'failed to copy debug info to clipboard')
  }
}

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

function handleCanIntervalChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const seconds = parseInt(target.value, 10)
  canPollingInterval.value = seconds
  notificationStore.setCanPollingInterval(seconds)
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

async function handleOpenCameraViewer() {
  if (isOpeningCameraViewer.value) return

  const url = cameraViewerUrl.value.trim()
  if (!url) {
    cameraViewerError.value = '請先輸入攝影機觀看頁面網址'
    return
  }

  isOpeningCameraViewer.value = true
  cameraViewerError.value = null

  try {
    await openCameraViewer(url)
  } catch (err) {
    cameraViewerError.value = err instanceof Error ? err.message : String(err)
    logAppEvent('error', 'settings', 'failed to open camera viewer', err)
  } finally {
    isOpeningCameraViewer.value = false
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

          <div class="border-t border-[var(--app-border)] pt-4 mt-4">
            <h3 class="text-base font-semibold mb-3 text-[var(--app-fg)]">Q 潔淨立馬清 (CAN)</h3>

            <div class="flex items-center justify-between py-2">
              <div class="flex flex-col">
                <label for="can-polling-toggle" class="text-base font-medium text-[var(--app-fg)]">啟用輪詢</label>
                <span class="text-sm text-[var(--app-muted)]">自動向 CAN 伺服器檢查新任務</span>
              </div>

              <label class="relative inline-flex items-center cursor-pointer">
                <input id="can-polling-toggle" type="checkbox" v-model="canPollingEnabled" class="sr-only peer" />
                <div
                  class="w-11 h-6 bg-[var(--app-control-bg)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--app-control-knob)] after:border-[var(--app-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--app-primary-strong)]"
                ></div>
              </label>
            </div>

            <div class="flex items-center justify-between py-2">
              <div class="flex flex-col">
                <span class="text-base font-medium text-[var(--app-fg)]">輪詢間隔</span>
                <span class="text-sm text-[var(--app-muted)]">檢查新任務的頻率</span>
              </div>

              <select
                :value="canPollingInterval"
                :disabled="!canPollingEnabled"
                class="px-3 py-2 rounded-lg bg-[var(--app-surface-2)] border border-[var(--app-border)] text-[var(--app-fg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                @change="handleCanIntervalChange"
              >
                <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
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

        <div class="space-y-4">
          <div class="flex items-center justify-between py-2">
            <div class="flex flex-col">
              <label for="autostart-toggle" class="text-base font-medium text-[var(--app-fg)]">開機自動啟動</label>
              <span class="text-sm text-[var(--app-muted)]">系統開機時自動啟動應用程式</span>
            </div>

            <label class="relative inline-flex items-center cursor-pointer">
              <input id="autostart-toggle" type="checkbox" v-model="autoLaunch" class="sr-only peer" />
              <div
                class="w-11 h-6 bg-[var(--app-control-bg)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--app-control-knob)] after:border-[var(--app-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--app-primary-strong)]"
              ></div>
            </label>
          </div>

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
      </div>

      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-cctv inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          攝影機觀看頁面
        </h2>

        <div class="space-y-4">
          <div class="flex flex-col gap-2">
            <label for="camera-viewer-url" class="text-base font-medium text-[var(--app-fg)]">觀看頁面網址</label>
            <input
              id="camera-viewer-url"
              v-model="cameraViewerUrl"
              type="url"
              class="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 py-3 text-sm text-[var(--app-fg-strong)] outline-none transition-colors placeholder:text-[var(--app-muted-2)] focus:border-[var(--app-primary)]"
              placeholder="https://vendor.example.com/viewer"
              spellcheck="false"
            />
            <p class="text-sm text-[var(--app-muted)]">
              輸入攝影機系統提供的完整觀看頁面網址。系統會優先在 app 內開啟獨立視窗，失敗時改用瀏覽器。
            </p>
          </div>

          <div class="flex items-center justify-between gap-6 py-2">
            <div class="flex flex-col">
              <span class="text-base font-medium text-[var(--app-fg)]">開啟攝影機觀看頁面</span>
              <span class="text-sm text-[var(--app-muted)]">重複點擊時會聚焦既有視窗，不會持續建立新視窗</span>
              <span v-if="cameraViewerError" class="mt-2 text-xs text-[var(--app-danger)]">{{ cameraViewerError }}</span>
            </div>

            <button
              type="button"
              class="rounded-full bg-[var(--app-primary-strong)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--app-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isOpeningCameraViewer || !cameraViewerUrl.trim()"
              @click="handleOpenCameraViewer"
            >
              {{ isOpeningCameraViewer ? 'Opening…' : 'Open Viewer' }}
            </button>
          </div>
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

        <div class="border-t border-[var(--app-border)] pt-4 mt-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold text-[var(--app-fg)]">Debug 資訊</h3>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-full bg-[var(--app-surface-2)] px-3 py-1 text-xs font-medium text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
                @click="showDebugPanel = !showDebugPanel"
              >
                {{ showDebugPanel ? '收起' : '展開' }}
              </button>
              <button
                type="button"
                class="rounded-full bg-[var(--app-primary-strong)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--app-primary)]"
                @click="copyDebugInfo"
              >
                {{ isCopied ? '已複製' : '複製' }}
              </button>
            </div>
          </div>

          <div v-if="showDebugPanel" class="space-y-3">
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
                <div class="text-xs text-[var(--app-muted)] mb-1">版本</div>
                <div class="font-medium text-[var(--app-fg)]">{{ debugInfo.version }}</div>
              </div>
              <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
                <div class="text-xs text-[var(--app-muted)] mb-1">環境</div>
                <div class="font-medium text-[var(--app-fg)]">{{ debugInfo.environment }} / {{ debugInfo.mode }}</div>
              </div>
              <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
                <div class="text-xs text-[var(--app-muted)] mb-1">當前系統</div>
                <div class="font-medium text-[var(--app-fg)]">{{ debugInfo.currentSystemLabel }}</div>
              </div>
              <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
                <div class="text-xs text-[var(--app-muted)] mb-1">認證狀態</div>
                <div class="flex gap-2">
                  <span class="font-medium" :class="debugInfo.lmaAuthenticated ? 'text-[var(--app-success)]' : 'text-[var(--app-muted)]'">
                    立碼 {{ debugInfo.lmaAuthenticated ? '✓' : '✗' }}
                  </span>
                  <span class="font-medium" :class="debugInfo.canAuthenticated ? 'text-[var(--app-success)]' : 'text-[var(--app-muted)]'">
                    CAN {{ debugInfo.canAuthenticated ? '✓' : '✗' }}
                  </span>
                </div>
              </div>
            </div>

            <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
              <div class="text-xs text-[var(--app-muted)] mb-2">使用者資訊</div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div class="text-[var(--app-muted)]">類型</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.authStore.userType }}</div>
                <div class="text-[var(--app-muted)]">名稱</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.authStore.displayName || '—' }}</div>
                <div class="text-[var(--app-muted)]">站點</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.authStore.user && 'station' in debugInfo.authStore.user ? debugInfo.authStore.user.station : debugInfo.authStore.user && 'stationId' in debugInfo.authStore.user ? debugInfo.authStore.user.stationId : '—' }}</div>
                <div class="text-[var(--app-muted)]">Token</div>
                <div class="text-[var(--app-fg)] font-mono text-xs">{{ debugInfo.authStore.tokenPreview || '—' }}</div>
                <div class="text-[var(--app-muted)]">已登入</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.authStore.isAuthenticated ? '是' : '否' }}</div>
                <div class="text-[var(--app-muted)]">已 Hydrated</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.authStore.isHydrated ? '是' : '否' }}</div>
                <div v-if="debugInfo.authStore.lastError" class="text-[var(--app-danger)]">最近錯誤</div>
                <div v-if="debugInfo.authStore.lastError" class="text-[var(--app-danger)]">{{ debugInfo.authStore.lastError }}</div>
              </div>
            </div>

            <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
              <div class="text-xs text-[var(--app-muted)] mb-2">輪詢狀態</div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div class="text-[var(--app-muted)]">立碼輪詢</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.pollingEnabled ? '啟用' : '停用' }} / {{ debugInfo.polling.pollingIntervalMs / 1000 }}s</div>
                <div class="text-[var(--app-muted)]">CAN 輪詢</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.canPollingEnabled ? '啟用' : '停用' }} / {{ debugInfo.polling.canPollingIntervalMs / 1000 }}s</div>
                <div class="text-[var(--app-muted)]">正在輪詢</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.isPolling ? '是' : '否' }}</div>
                <div class="text-[var(--app-muted)]">輪詢次數</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.stats.pollCount }}</div>
                <div class="text-[var(--app-muted)]">成功次數</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.stats.successCount }}</div>
                <div class="text-[var(--app-muted)]">錯誤次數</div>
                <div class="text-[var(--app-fg)]">{{ debugInfo.polling.stats.errorCount }}</div>
                <div v-if="debugInfo.polling.lastError" class="text-[var(--app-danger)]">輪詢錯誤</div>
                <div v-if="debugInfo.polling.lastError" class="text-[var(--app-danger)]">{{ debugInfo.polling.lastError }}</div>
              </div>
            </div>

            <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
              <div class="text-xs text-[var(--app-muted)] mb-2">LocalStorage (tauri-app:)</div>
              <div class="space-y-1">
                <div v-for="(value, key) in debugInfo.localStorage" :key="key" class="text-sm">
                  <div class="text-[var(--app-muted)] text-xs">{{ key }}</div>
                  <div class="text-[var(--app-fg)] font-mono text-xs break-all">{{ value }}</div>
                </div>
                <div v-if="Object.keys(debugInfo.localStorage).length === 0" class="text-sm text-[var(--app-muted)]">
                  無 tauri-app 資料
                </div>
              </div>
            </div>

            <div class="rounded-lg bg-[var(--app-surface-2)] p-3">
              <div class="text-xs text-[var(--app-muted)] mb-2">原始認證資料</div>
              <div class="text-[var(--app-fg)] font-mono text-xs break-all">
                <div v-if="debugInfo.rawStorage.lma" class="mb-1">
                  <span class="text-[var(--app-muted)]">LMA:</span> {{ debugInfo.rawStorage.lma.slice(0, 100) }}...
                </div>
                <div v-if="debugInfo.rawStorage.can" class="mb-1">
                  <span class="text-[var(--app-muted)]">CAN:</span> {{ debugInfo.rawStorage.can.slice(0, 100) }}...
                </div>
                <div v-if="debugInfo.rawStorage.old" class="mb-1">
                  <span class="text-[var(--app-muted)]">Old:</span> {{ debugInfo.rawStorage.old.slice(0, 100) }}...
                </div>
                <div v-if="!debugInfo.rawStorage.lma && !debugInfo.rawStorage.can && !debugInfo.rawStorage.old" class="text-[var(--app-muted)]">
                  無儲存資料
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
