<script setup lang="ts">
import { computed, ref } from 'vue'
import { getAppLogs, logAppEvent } from '@/services/appLogger'
import type { AppLogEntry, AppLogLevel } from '@/services/appLogger'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import type { AuthUser } from '@/types/auth'
import type { CanAuthUser } from '@/types/can'
import type { ChargeAuthUser } from '@/types/charge'
import type { SystemType } from '@/types/system'

const props = defineProps<{
  system: SystemType
}>()

const authStore = useAuthStore()
const notificationStore = useNotificationStore()

const showDebugPanel = ref(false)
const isCopied = ref(false)
const isLoggingOut = ref(false)
const showLogs = ref(false)

const intervalOptions = [
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒' },
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分鐘' },
  { value: 120, label: '2 分鐘' },
  { value: 300, label: '5 分鐘' },
]

function getSystemName(system: SystemType): string {
  switch (system) {
    case 'lma': return '立碼幫幫忙'
    case 'can': return 'Q 潔淨立馬清'
    case 'charge': return '無線充故障'
  }
}

const systemName = computed(() => getSystemName(props.system))
const storageKey = computed(() => `tauri-app:auth:${props.system}`)
const pollingEnabled = computed({
  get: () => {
    switch (props.system) {
      case 'lma': return notificationStore.pollingEnabled
      case 'can': return notificationStore.canPollingEnabled
      case 'charge': return notificationStore.chargePollingEnabled
    }
  },
  set: value => {
    switch (props.system) {
      case 'lma': notificationStore.setPollingEnabled(value); break
      case 'can': notificationStore.setCanPollingEnabled(value); break
      case 'charge': notificationStore.setChargePollingEnabled(value); break
    }
  },
})
const pollingIntervalSeconds = computed(() => {
  switch (props.system) {
    case 'lma': return notificationStore.pollingIntervalSeconds
    case 'can': return notificationStore.canPollingIntervalSeconds
    case 'charge': return notificationStore.chargePollingIntervalSeconds
  }
})
const isPolling = computed(() => {
  switch (props.system) {
    case 'lma': return notificationStore.isPolling
    case 'can': return notificationStore.isCanPolling
    case 'charge': return notificationStore.isChargePolling
  }
})
const runtimeError = computed(() => {
  switch (props.system) {
    case 'lma': return notificationStore.lastError
    case 'can': return notificationStore.canPollingLastError
    case 'charge': return notificationStore.chargePollingLastError
  }
})
const storageValue = computed(() => {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(storageKey.value)
})

const systemSources = computed(() => {
  switch (props.system) {
    case 'lma': return ['notifications', 'notification-poller', 'notification-data-source', 'auth', 'auth-service', 'task-actions']
    case 'can': return ['can-task-service', 'can-auth-service']
    case 'charge': return ['charge-auth-service', 'charge-task-service']
  }
})

const systemLogs = computed(() => {
  const logs = getAppLogs()
  return logs.filter(log => systemSources.value.includes(log.source)).slice(-100)
})

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getLevelColor(level: AppLogLevel): string {
  if (level === 'error') return 'var(--app-danger)'
  if (level === 'warn') return 'var(--app-warning)'
  return 'var(--app-success)'
}

const systemSession = computed(() => authStore.getSystemSession(props.system))
const tokenPreview = computed(() => (systemSession.value?.token ? `${systemSession.value.token.slice(0, 20)}...` : '—'))

function isLmaUser(user: AuthUser | CanAuthUser | ChargeAuthUser | null): user is AuthUser {
  return Boolean(user && 'stationId' in user)
}

function isCanUser(user: AuthUser | CanAuthUser | ChargeAuthUser | null): user is CanAuthUser {
  return Boolean(user && 'station' in user && (!('system' in user) || user.system !== 'charge'))
}

const accountRows = computed(() => {
  const user = systemSession.value?.user ?? null
  if (props.system === 'lma' && isLmaUser(user)) {
    return [
      { label: '名稱', value: user.name },
      { label: '站點', value: user.stationId },
      { label: '角色', value: user.role },
    ]
  }

  if (props.system === 'can' && isCanUser(user)) {
    return [
      { label: '名稱', value: user.name },
      { label: '站點', value: user.station },
      { label: '主題', value: user.topic },
    ]
  }

  if (props.system === 'charge' && user && 'system' in user && user.system === 'charge') {
    return [
      { label: '帳號', value: user.account },
      { label: '站點', value: user.station },
      { label: '主題', value: user.topic },
      { label: '工作階段', value: '已建立' },
    ]
  }

  return [{ label: '登入狀態', value: '未登入' }]
})

const debugInfo = computed(() => ({
  system: systemName.value,
  authenticated: authStore.isSystemAuthenticated(props.system),
  user: systemSession.value?.user ?? null,
  tokenPreview: tokenPreview.value,
  polling: {
    enabled: pollingEnabled.value,
    intervalSeconds: pollingIntervalSeconds.value,
    running: isPolling.value,
    stats: props.system === 'lma' ? notificationStore.pollingStats : null,
    lastError: runtimeError.value,
  },
  storage: {
    key: storageKey.value,
    saved: Boolean(storageValue.value),
    size: storageValue.value?.length ?? 0,
  },
}))

function handleIntervalChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const seconds = parseInt(target.value, 10)
  switch (props.system) {
    case 'lma':
      notificationStore.setPollingInterval(seconds)
      break
    case 'can':
      notificationStore.setCanPollingInterval(seconds)
      break
    case 'charge':
      notificationStore.setChargePollingInterval(seconds)
      break
  }
}

function getPollingDescription(system: SystemType): string {
  switch (system) {
    case 'lma': return '自動檢查新的警示與任務'
    case 'can': return '自動檢查新的清潔任務'
    case 'charge': return ''
  }
}

async function handleLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  try {
    await authStore.logout(props.system)
  } finally {
    isLoggingOut.value = false
  }
}

async function copyDebugInfo() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(debugInfo.value, null, 2))
    isCopied.value = true
    setTimeout(() => {
      isCopied.value = false
    }, 2000)
  } catch (err) {
    logAppEvent('warn', 'system-settings', 'failed to copy system debug info', err)
  }
}
</script>

<template>
  <section class="mt-6 rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="flex items-center gap-2 text-xl font-semibold text-[var(--app-fg)]">
          <span class="i-mdi-tune-variant text-[var(--app-primary-strong)]" />
          {{ systemName }} 設定
        </h2>
        <p class="mt-1 text-sm text-[var(--app-muted)]">管理此系統的帳號、輪詢與排查資訊。</p>
      </div>
      <button
        type="button"
        class="rounded-full border border-[color:rgba(196,91,91,0.35)] px-4 py-2 text-sm font-semibold text-[var(--app-danger)] transition-colors hover:bg-[color:rgba(196,91,91,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="isLoggingOut"
        @click="handleLogout"
      >
        {{ isLoggingOut ? '登出中…' : '登出' }}
      </button>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-2xl bg-[var(--app-surface-2)] p-4">
        <h3 class="mb-3 text-base font-semibold text-[var(--app-fg)]">帳號</h3>
        <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <template v-for="row in accountRows" :key="row.label">
            <div class="text-[var(--app-muted)]">{{ row.label }}</div>
            <div class="break-all text-[var(--app-fg)]">{{ row.value || '—' }}</div>
          </template>
          <div class="text-[var(--app-muted)]">Token</div>
          <div class="font-mono text-xs text-[var(--app-fg)]">{{ tokenPreview }}</div>
        </div>
      </div>

      <div class="rounded-2xl bg-[var(--app-surface-2)] p-4">
        <h3 class="mb-3 text-base font-semibold text-[var(--app-fg)]">輪詢</h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-[var(--app-fg)]">啟用輪詢</div>
              <div class="text-xs text-[var(--app-muted)]">
                {{ getPollingDescription(props.system) }}
              </div>
            </div>
            <label class="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" v-model="pollingEnabled" class="peer sr-only" />
              <div class="h-6 w-11 rounded-full bg-[var(--app-control-bg)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[var(--app-border)] after:bg-[var(--app-control-knob)] after:transition-all after:content-[''] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] peer-checked:bg-[var(--app-primary-strong)] peer-checked:after:translate-x-full" />
            </label>
          </div>

          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-[var(--app-fg)]">輪詢間隔</div>
              <div class="text-xs text-[var(--app-muted)]">目前每 {{ pollingIntervalSeconds }} 秒檢查一次</div>
            </div>
            <select
              :value="pollingIntervalSeconds"
              :disabled="!pollingEnabled"
              class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[var(--app-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              @change="handleIntervalChange"
            >
              <option v-for="option in intervalOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="flex items-center gap-2 text-sm text-[var(--app-muted)]">
            <span
              class="h-2 w-2 rounded-full"
              :class="isPolling ? 'animate-pulse bg-[var(--app-success)]' : pollingEnabled ? 'bg-[var(--app-primary)]' : 'bg-[var(--app-muted-2)]'"
            />
            <span v-if="isPolling && props.system === 'lma'">輪詢中，已完成 {{ notificationStore.pollingStats.pollCount }} 次輪詢</span>
            <span v-else-if="isPolling">輪詢中</span>
            <span v-else-if="pollingEnabled">已啟用；進入此系統或登入後會開始輪詢</span>
            <span v-else>已停用輪詢</span>
          </div>
        </div>
        <div v-if="props.system === 'charge' && !notificationStore.chargePollingEnabled" class="flex min-h-[150px] items-center gap-3 rounded-2xl bg-[var(--app-surface-2)] px-4 py-5 text-sm text-[var(--app-muted)]">
          <span class="i-mdi-clock-outline shrink-0 text-[var(--app-primary-strong)]" />
          <p>無線充故障目前未啟用輪詢；工作內容與輪詢狀態將在功能啟用後顯示。</p>
        </div>
      </div>
    </div>

    <div class="mt-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-2)] p-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="text-base font-semibold text-[var(--app-fg)]">排查資訊</h3>
          <p class="mt-1 text-xs text-[var(--app-muted)]">顯示摘要；需要完整內容時可複製給維護人員。</p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="rounded-full bg-[var(--app-surface)] px-3 py-1.5 text-xs font-medium text-[var(--app-muted)] hover:text-[var(--app-fg)]" @click="showDebugPanel = !showDebugPanel">
            {{ showDebugPanel ? '收起' : '展開' }}
          </button>
          <button type="button" class="rounded-full bg-[var(--app-primary-strong)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--app-primary)]" @click="copyDebugInfo">
            {{ isCopied ? '已複製 ✓' : '複製' }}
          </button>
        </div>
      </div>

      <div v-if="showDebugPanel" class="mt-4 space-y-4">
        <!-- Logs -->
        <div>
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-[var(--app-fg)]">系統紀錄</h4>
            <button
              type="button"
              class="text-xs text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
              @click="showLogs = !showLogs"
            >
              {{ showLogs ? '收起' : '展開' }}
            </button>
          </div>
          <div v-if="showLogs" class="rounded-xl bg-[var(--app-surface)] p-3">
            <div class="max-h-60 overflow-y-auto space-y-1">
              <div
                v-for="log in systemLogs"
                :key="log.id"
                class="flex items-start gap-2 text-xs"
              >
                <span class="text-[var(--app-muted)] shrink-0">{{ formatTime(log.timestamp) }}</span>
                <span
                  class="shrink-0 rounded px-1 py-0.5 font-medium"
                  :style="{ backgroundColor: `color-mix(in srgb, ${getLevelColor(log.level)} 15%, transparent)`, color: getLevelColor(log.level) }"
                >
                  {{ log.level.toUpperCase() }}
                </span>
                <span class="text-[var(--app-fg)]">{{ log.message }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
