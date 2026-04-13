import { acceptHMRUpdate, defineStore } from 'pinia'
import { createPlayerCore, type PlayerCoreEvent } from '@/services/stream/playerCore'
import type { StreamConfig, StreamError, StreamStats, StreamStatus } from '@/types/stream'

const STREAM_STORAGE_KEY = 'tauri-app:stream'

interface StoredStreamState {
  currentConfig: StreamConfig | null
  muted: boolean
}

export const useStreamStore = defineStore('stream', {
  state: () => ({
    playerCore: null as ReturnType<typeof createPlayerCore> | null,
    unsubscribeCore: null as (() => void) | null,
    videoElement: null as HTMLVideoElement | null,
    currentConfig: null as StreamConfig | null,
    status: 'idle' as StreamStatus,
    lastError: null as StreamError | null,
    stats: null as StreamStats | null,
    muted: false,
    isPlaying: false,
    isHydrated: false,
    isPending: false,
  }),

  getters: {
    hasSource: state => state.currentConfig !== null,
    canRetry: state => state.lastError?.retryable ?? false,
  },

  actions: {
    init() {
      if (this.playerCore) {
        return
      }

      this.playerCore = createPlayerCore()
      this.unsubscribeCore = this.playerCore.onEvent(event => this.handlePlayerEvent(event))
      this.loadFromStorage()
      this.isHydrated = true
    },

    attachVideoElement(videoElement: HTMLVideoElement) {
      if (!this.playerCore) {
        this.init()
      }

      this.videoElement = videoElement
      this.applyMutedState()
      this.playerCore?.attach(videoElement)
    },

    async loadStream(config: StreamConfig, autoplay = false) {
      if (!this.playerCore) {
        this.init()
      }

      this.isPending = true
      this.lastError = null
      this.currentConfig = config
      this.persistToStorage()

      try {
        await this.playerCore?.load(config)
        this.applyMutedState()

        if (autoplay) {
          await this.play()
        } else {
          this.isPlaying = false
        }
      } catch (err) {
        this.lastError = this.toStreamError(err)
        this.status = 'error'
        throw err
      } finally {
        this.isPending = false
      }
    },

    async play() {
      if (!this.playerCore || !this.currentConfig) {
        throw new Error('stream source is not loaded')
      }

      this.isPending = true
      this.lastError = null

      try {
        if (this.videoElement && this.status === 'live' && !this.isPlaying) {
          await this.videoElement.play()
          this.isPlaying = true
          return
        }

        await this.playerCore.play()
        this.isPlaying = true
      } catch (err) {
        this.lastError = this.toStreamError(err)
        this.status = 'error'
        this.isPlaying = false
        throw err
      } finally {
        this.isPending = false
      }
    },

    pause() {
      this.playerCore?.pause()
      this.isPlaying = false
    },

    async stop() {
      if (!this.playerCore) {
        return
      }

      this.isPending = true

      try {
        await this.playerCore.stop()
        this.isPlaying = false
      } finally {
        this.isPending = false
      }
    },

    async retry() {
      if (!this.playerCore || !this.currentConfig) {
        throw new Error('stream source is not loaded')
      }

      this.isPending = true
      this.lastError = null

      try {
        await this.playerCore.reconnect()
        this.isPlaying = true
      } catch (err) {
        this.lastError = this.toStreamError(err)
        this.status = 'error'
        this.isPlaying = false
        throw err
      } finally {
        this.isPending = false
      }
    },

    toggleMute() {
      this.muted = !this.muted
      this.applyMutedState()
      this.persistToStorage()
    },

    setMuted(muted: boolean) {
      this.muted = muted
      this.applyMutedState()
      this.persistToStorage()
    },

    async dispose() {
      if (this.unsubscribeCore) {
        this.unsubscribeCore()
        this.unsubscribeCore = null
      }

      await this.playerCore?.dispose()
      this.playerCore = null
      this.videoElement = null
      this.isPlaying = false
      this.status = 'idle'
      this.lastError = null
      this.stats = null
    },

    handlePlayerEvent(event: PlayerCoreEvent) {
      if (event.type === 'status') {
        this.status = event.status

        if (event.status === 'idle' || event.status === 'stopped' || event.status === 'error') {
          this.isPlaying = false
        }

        if (event.status === 'live') {
          this.isPlaying = true
        }

        return
      }

      if (event.type === 'stats') {
        this.stats = event.stats
        return
      }

      this.lastError = event.error
      this.status = 'error'
      this.isPlaying = false
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

    applyMutedState() {
      if (!this.videoElement) {
        return
      }

      this.videoElement.muted = this.muted
    },

    toStreamError(err: unknown): StreamError {
      return {
        code: 'unknown',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
        timestamp: Date.now(),
      }
    },
  },
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStreamStore, import.meta.hot))
}
