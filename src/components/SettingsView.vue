<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '@/store'
import { useNotificationStore } from '@/stores/notificationStore'

const store = useStore()
const notificationStore = useNotificationStore()

const minimizeOnClose = computed({
  get: () => store.minimizeToTrayOnClose,
  set: value => store.setMinimizeToTrayOnClose(value),
})

const themePreference = computed({
  get: () => store.themePreference,
  set: value => {
    if (value === 'dark' || value === 'light' || value === 'system') {
      store.setThemePreference(value)
    }
  },
})

const pollingEnabled = computed({
  get: () => notificationStore.pollingEnabled,
  set: value => notificationStore.setPollingEnabled(value),
})

const pollingInterval = ref(notificationStore.pollingIntervalSeconds)

const intervalOptions = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
]

function handleIntervalChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const seconds = parseInt(target.value, 10)
  pollingInterval.value = seconds
  notificationStore.setPollingInterval(seconds)
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-6 md:px-8 md:py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight text-[var(--app-fg-strong)]">Settings</h1>
      <p class="mt-1 text-sm text-[var(--app-muted)]">Control notifications, window behavior, and the app theme.</p>
    </div>

    <div class="space-y-6">
      <!-- Section: Notifications -->
      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-bell-ring inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          Notifications
        </h2>

        <div class="space-y-4">
          <div class="flex items-center justify-between py-2">
            <div class="flex flex-col">
              <label for="polling-toggle" class="text-base font-medium text-[var(--app-fg)]">Enable polling</label>
              <span class="text-sm text-[var(--app-muted)]">Automatically check for new alerts from the server</span>
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
              <span class="text-base font-medium text-[var(--app-fg)]">Polling interval</span>
              <span class="text-sm text-[var(--app-muted)]">How often to check for new alerts</span>
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
            <span>Polling active</span>
            <span class="text-[var(--app-muted-2)]">•</span>
            <span>{{ notificationStore.pollingStats.pollCount }} polls completed</span>
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
          Window Behavior
        </h2>

        <div class="flex items-center justify-between py-2">
          <div class="flex flex-col">
            <label for="minimize-toggle" class="text-base font-medium text-[var(--app-fg)]"
              >Minimize to tray on close</label
            >
            <span class="text-sm text-[var(--app-muted)]"
              >Keep the app running in the tray when you close the window</span
            >
          </div>

          <label class="relative inline-flex items-center cursor-pointer">
            <input id="minimize-toggle" type="checkbox" v-model="minimizeOnClose" class="sr-only peer" />
            <div
              class="w-11 h-6 bg-[var(--app-control-bg)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--app-primary)] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--app-control-knob)] after:border-[var(--app-border)] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--app-primary-strong)]"
            ></div>
          </label>
        </div>
      </div>

      <!-- Section: Appearance -->
      <div class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
        <h2 class="text-xl font-semibold mb-4 text-[var(--app-fg)] flex items-center gap-2">
          <span
            class="i-mdi-palette inline-flex shrink-0 text-[1.2rem] leading-none font-normal text-[var(--app-primary-strong)]"
          />
          Appearance
        </h2>

        <div class="flex items-center justify-between gap-6 py-2">
          <div class="flex flex-col">
            <span class="text-base font-medium text-[var(--app-fg)]">Theme</span>
            <span class="text-sm text-[var(--app-muted)]"
              >Choose a light or dark look, or follow the system setting</span
            >
          </div>

          <div class="shrink-0 inline-flex rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] p-1">
            <button
              type="button"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="
                themePreference === 'system'
                  ? 'bg-[var(--app-surface-2)] text-[var(--app-fg)]'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]'
              "
              aria-label="Use system theme"
              :aria-pressed="themePreference === 'system'"
              @click="themePreference = 'system'"
            >
              <span class="i-mdi-monitor text-base" />
              System
            </button>

            <button
              type="button"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="
                themePreference === 'light'
                  ? 'bg-[var(--app-surface-2)] text-[var(--app-fg)]'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]'
              "
              aria-label="Use light theme"
              :aria-pressed="themePreference === 'light'"
              @click="themePreference = 'light'"
            >
              <span class="i-mdi-white-balance-sunny text-base" />
              Light
            </button>

            <button
              type="button"
              class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="
                themePreference === 'dark'
                  ? 'bg-[var(--app-surface-2)] text-[var(--app-fg)]'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]'
              "
              aria-label="Use dark theme"
              :aria-pressed="themePreference === 'dark'"
              @click="themePreference = 'dark'"
            >
              <span class="i-mdi-weather-night text-base" />
              Dark
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
