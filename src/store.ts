import { acceptHMRUpdate, defineStore } from 'pinia'

import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'

import { hideCurrentWindow } from './tauri/window'

const SETTINGS_STORAGE_KEY = 'tauri-app:settings'

type ThemePreference = 'dark' | 'light' | 'system'
type EffectiveTheme = 'dark' | 'light'

let systemThemeMediaQuery: MediaQueryList | null = null
let systemThemeListener: ((event: MediaQueryListEvent) => void) | null = null

function getSystemPreferredTheme(): EffectiveTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeToDocument(theme: EffectiveTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

function setSystemThemeListenerEnabled(enabled: boolean, onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  if (!systemThemeMediaQuery) {
    systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  }

  if (!enabled) {
    if (systemThemeListener && systemThemeMediaQuery) {
      systemThemeMediaQuery.removeEventListener('change', systemThemeListener)
    }
    systemThemeListener = null
    return
  }

  if (systemThemeListener) return

  systemThemeListener = () => onChange()
  systemThemeMediaQuery.addEventListener('change', systemThemeListener)
}

async function syncMinimizeToTraySettingToBackend(enabled: boolean): Promise<void> {
  try {
    await invoke('set_minimize_to_tray_on_close', { enabled })
  } catch (err) {
    // Non-Tauri runtime or command not available.
    logAppEvent('warn', 'settings', 'failed to sync minimize-to-tray setting to backend', err)
    console.warn('failed to sync minimize-to-tray setting to backend', err)
  }
}

const versionString =
  import.meta.env.MODE === 'development' ? `${import.meta.env.VITE_APP_VERSION}-dev` : import.meta.env.VITE_APP_VERSION

export const useStore = defineStore('main', {
  state: () => ({
    debug: import.meta.env.MODE === 'development',
    version: versionString,
    isInitialized: false,
    currentView: 'notifications' as 'home' | 'settings' | 'notifications' | 'stream-test',
    minimizeToTrayOnClose: false,
    themePreference: 'system' as ThemePreference,
  }),

  actions: {
    initApp() {
      this.loadSettingsFromStorage()
      this.applyThemePreference()
      void syncMinimizeToTraySettingToBackend(this.minimizeToTrayOnClose)
      this.isInitialized = true
      logAppEvent('info', 'app', 'application initialized', {
        themePreference: this.themePreference,
        minimizeToTrayOnClose: this.minimizeToTrayOnClose,
      })
      console.log('app initialized!')
    },

    setMinimizeToTrayOnClose(enabled: boolean) {
      this.minimizeToTrayOnClose = enabled
      this.saveSettingsToStorage()
      logAppEvent('info', 'settings', 'updated minimize-to-tray preference', { enabled })
      void syncMinimizeToTraySettingToBackend(enabled)
    },

    setThemePreference(preference: ThemePreference) {
      this.themePreference = preference
      this.saveSettingsToStorage()
      this.applyThemePreference()
      logAppEvent('info', 'settings', 'updated theme preference', { preference })
    },

    applyThemePreference() {
      const preference = this.themePreference
      const effectiveTheme: EffectiveTheme =
        preference === 'system' ? getSystemPreferredTheme() : preference === 'light' ? 'light' : 'dark'

      applyThemeToDocument(effectiveTheme)
      setSystemThemeListenerEnabled(preference === 'system', () => this.applyThemePreference())
    },

    async hideToTrayNow() {
      await hideCurrentWindow()
    },

    loadSettingsFromStorage() {
      if (typeof localStorage === 'undefined') return

      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (!raw) return

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        logAppEvent('warn', 'settings', 'failed to parse persisted settings', err)
        console.warn('failed to parse settings, ignoring', err)
        return
      }

      if (typeof parsed !== 'object' || parsed === null) return
      const record = parsed as Record<string, unknown>

      const minimizeToTrayOnClose = record.minimizeToTrayOnClose
      if (typeof minimizeToTrayOnClose === 'boolean') {
        this.minimizeToTrayOnClose = minimizeToTrayOnClose
      }
      const themePreference = record.themePreference
      if (themePreference === 'dark' || themePreference === 'light' || themePreference === 'system') {
        this.themePreference = themePreference
      }

      // Backward compatibility (previous key).
      const minimizeOnClose = record.minimizeOnClose
      if (typeof minimizeOnClose === 'boolean') {
        this.minimizeToTrayOnClose = minimizeOnClose
      }
    },

    saveSettingsToStorage() {
      if (typeof localStorage === 'undefined') return

      const payload = {
        minimizeToTrayOnClose: this.minimizeToTrayOnClose,
        themePreference: this.themePreference,
      }

      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
      } catch (err) {
        logAppEvent('warn', 'settings', 'failed to save settings', err)
        console.warn('failed to save settings', err)
      }
    },
  },

  getters: {
    isReady: state => {
      return !state.isInitialized
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStore, import.meta.hot))
}
