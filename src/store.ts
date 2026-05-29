import { acceptHMRUpdate, defineStore } from 'pinia'

import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import { isTauriRuntime } from '@/tauri/window'

import { hideCurrentWindow } from './tauri/window'

const SETTINGS_STORAGE_KEY = 'tauri-app:settings'

async function syncMinimizeToTraySettingToBackend(enabled: boolean): Promise<void> {
  try {
    await invoke('set_minimize_to_tray_on_close', { enabled })
  } catch (err) {
    logAppEvent('warn', 'settings', 'failed to sync minimize-to-tray setting to backend', err)
    console.warn('failed to sync minimize-to-tray setting to backend', err)
  }
}

async function syncAutostartToBackend(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return

  try {
    const autostart = await import('@tauri-apps/plugin-autostart')
    if (enabled) {
      await autostart.enable()
    } else {
      await autostart.disable()
    }
    logAppEvent('info', 'settings', 'synced autostart setting to backend', { enabled })
  } catch (err) {
    logAppEvent('warn', 'settings', 'failed to sync autostart setting to backend', err)
    console.warn('failed to sync autostart setting to backend', err)
  }
}

const versionString =
  import.meta.env.MODE === 'development' ? `${import.meta.env.VITE_APP_VERSION}-dev` : import.meta.env.VITE_APP_VERSION

export const useStore = defineStore('main', {
  state: () => ({
    debug: import.meta.env.MODE === 'development',
    version: versionString,
    isInitialized: false,
    currentView: 'notifications' as 'home' | 'settings' | 'notifications',
    minimizeToTrayOnClose: false,
    autoLaunchEnabled: true,
    cameraViewerUrl: '',
  }),

  actions: {
    initApp() {
      this.loadSettingsFromStorage()
      void syncMinimizeToTraySettingToBackend(this.minimizeToTrayOnClose)
      void syncAutostartToBackend(this.autoLaunchEnabled)
      this.isInitialized = true
      logAppEvent('info', 'app', 'application initialized', {
        minimizeToTrayOnClose: this.minimizeToTrayOnClose,
        autoLaunchEnabled: this.autoLaunchEnabled,
      })
      console.log('app initialized!')
    },

    setMinimizeToTrayOnClose(enabled: boolean) {
      this.minimizeToTrayOnClose = enabled
      this.saveSettingsToStorage()
      logAppEvent('info', 'settings', 'updated minimize-to-tray preference', { enabled })
      void syncMinimizeToTraySettingToBackend(enabled)
    },

    setAutoLaunchEnabled(enabled: boolean) {
      this.autoLaunchEnabled = enabled
      this.saveSettingsToStorage()
      logAppEvent('info', 'settings', 'updated autostart preference', { enabled })
      void syncAutostartToBackend(enabled)
    },

    setCameraViewerUrl(url: string) {
      this.cameraViewerUrl = url.trim()
      this.saveSettingsToStorage()
      logAppEvent('info', 'settings', 'updated camera viewer url', {
        hasUrl: this.cameraViewerUrl.length > 0,
      })
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

      const autoLaunchEnabled = record.autoLaunchEnabled
      if (typeof autoLaunchEnabled === 'boolean') {
        this.autoLaunchEnabled = autoLaunchEnabled
      }

      const cameraViewerUrl = record.cameraViewerUrl
      if (typeof cameraViewerUrl === 'string') {
        this.cameraViewerUrl = cameraViewerUrl
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
        autoLaunchEnabled: this.autoLaunchEnabled,
        cameraViewerUrl: this.cameraViewerUrl,
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
      return state.isInitialized
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStore, import.meta.hot))
}
