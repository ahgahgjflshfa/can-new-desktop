import { acceptHMRUpdate, defineStore } from 'pinia'
import type { PlayerState } from '@/services/stream/playerCore'
import type { StreamConfig } from '@/types/stream'

const STREAM_STORAGE_KEY = 'tauri-app:stream'

interface StoredStreamState {
  currentConfig: StreamConfig | null
  muted: boolean
}

function createInitialPlayerState(): PlayerState {
  return {
    status: 'idle',
    error: null,
    stats: {
      startupTimeMs: 0,
      reconnectCount: 0,
      bufferCount: 0,
    },
    hasLoadedSource: false,
  }
}

export const useStreamStore = defineStore('stream', {
  state: () => ({
    currentConfig: null as StreamConfig | null,
    playerState: createInitialPlayerState(),
    muted: false,
    isHydrated: false,
  }),

  getters: {
    hasSource: state => state.currentConfig !== null,
    canRetry: state => state.playerState.error?.retryable ?? false,
  },

  actions: {
    init() {
      this.loadFromStorage()
      this.isHydrated = true
    },

    setCurrentConfig(config: StreamConfig) {
      this.currentConfig = config
      this.persistToStorage()
    },

    setPlayerState(state: PlayerState) {
      this.playerState = state
    },

    resetPlayerState() {
      this.playerState = createInitialPlayerState()
    },

    toggleMute() {
      this.muted = !this.muted
      this.persistToStorage()
    },

    setMuted(muted: boolean) {
      this.muted = muted
      this.persistToStorage()
    },

    loadFromStorage() {
      if (typeof localStorage === 'undefined') {
        return
      }

      const raw = localStorage.getItem(STREAM_STORAGE_KEY)
      if (!raw) {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        console.warn('failed to parse stream state', err)
        return
      }

      if (typeof parsed !== 'object' || parsed === null) {
        return
      }

      const record = parsed as Partial<StoredStreamState>

      if (typeof record.muted === 'boolean') {
        this.muted = record.muted
      }

      const config = record.currentConfig
      if (
        config &&
        typeof config === 'object' &&
        (config.sourceType === 'mock' || config.sourceType === 'webrtc' || config.sourceType === 'hls') &&
        typeof config.sourceUrl === 'string'
      ) {
        this.currentConfig = {
          sourceType: config.sourceType,
          sourceUrl: config.sourceUrl,
        }
      }
    },

    persistToStorage() {
      if (typeof localStorage === 'undefined') {
        return
      }

      try {
        localStorage.setItem(
          STREAM_STORAGE_KEY,
          JSON.stringify({
            currentConfig: this.currentConfig,
            muted: this.muted,
          } satisfies StoredStreamState)
        )
      } catch (err) {
        console.warn('failed to persist stream state', err)
      }
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStreamStore, import.meta.hot))
}
