import Hls from 'hls.js'
import { logAppEvent } from '@/services/appLogger'
import type { StreamConfig, StreamError, StreamErrorCode, StreamStats } from '@/types/stream'

export type PlayerStatus = 'idle' | 'loading' | 'live' | 'buffering' | 'paused' | 'reconnecting' | 'error' | 'stopped'

export interface PlayerState {
  status: PlayerStatus
  error: StreamError | null
  stats: StreamStats | null
  hasLoadedSource: boolean
}

export class HlsPlayerController {
  private static readonly STALL_TIMEOUT_MS = 12000
  private static readonly MAX_RECOVERY_ATTEMPTS = 3
  private static readonly LOG_SOURCE = 'stream-player'

  private videoEl: HTMLVideoElement | null = null
  private hls: Hls | null = null
  private config: StreamConfig | null = null
  private state: PlayerState = this.createInitialState()
  private listeners = new Set<(state: PlayerState) => void>()
  private removeVideoListeners: (() => void) | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private startupStartedAt = 0
  private reconnectCount = 0
  private bufferCount = 0
  private recoveryAttempts = 0
  private shouldAutoplay = false
  private isStopping = false
  private currentLoadToken = 0

  attach(videoEl: HTMLVideoElement): void {
    this.detach()
    this.videoEl = videoEl
    this.bindVideoListeners(videoEl)
    this.logInfo('Attached video element')
  }

  detach(): void {
    if (this.removeVideoListeners) {
      this.removeVideoListeners()
      this.removeVideoListeners = null
    }

    this.videoEl = null
    this.logInfo('Detached video element')
  }

  async load(config: StreamConfig, options: { autoplay?: boolean } = {}): Promise<void> {
    this.config = config
    this.shouldAutoplay = options.autoplay ?? false
    this.currentLoadToken += 1
    const loadToken = this.currentLoadToken

    this.startupStartedAt = Date.now()
    this.recoveryAttempts = 0
    this.logInfo('Loading stream source', {
      sourceType: config.sourceType,
      sourceUrl: config.sourceUrl,
      autoplay: this.shouldAutoplay,
      loadToken,
    })
    this.patchState({
      status: 'loading',
      error: null,
      hasLoadedSource: false,
      stats: this.state.stats,
    })

    this.destroyHls()

    if (!this.videoEl) {
      this.logWarn('Skipped stream load because video element is not attached', { loadToken })
      return
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })

      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        if (loadToken !== this.currentLoadToken || !this.videoEl) {
          return
        }

        this.logInfo('HLS manifest parsed', {
          sourceUrl: config.sourceUrl,
          autoplay: this.shouldAutoplay,
          loadToken,
        })

        if (this.shouldAutoplay) {
          await this.tryPlay(this.videoEl)
        }
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (loadToken !== this.currentLoadToken) {
          return
        }

        if (!data?.fatal) {
          this.logWarn('Received non-fatal HLS error', {
            type: data?.type,
            details: data?.details,
            responseCode: data?.response?.code,
            fatal: data?.fatal,
          })
          return
        }

        this.logWarn('Received fatal HLS error', {
          type: data?.type,
          details: data?.details,
          responseCode: data?.response?.code,
          fatal: data?.fatal,
          recoveryAttempts: this.recoveryAttempts,
        })

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          const canRecover = this.handleRecoverableError(
            data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network_timeout' : 'unknown'
          )
          if (!canRecover) {
            return
          }

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            this.logWarn('Restarting HLS network load after fatal network error', {
              sourceUrl: config.sourceUrl,
              loadToken,
            })
            hls.startLoad()
          } else {
            this.logWarn('Recovering HLS media error', {
              sourceUrl: config.sourceUrl,
              loadToken,
            })
            hls.recoverMediaError()
          }

          return
        }

        this.fail(this.mapHlsError(data), data?.details ?? 'HLS playback error', false)
      })

      hls.loadSource(config.sourceUrl)
      hls.attachMedia(this.videoEl)
      this.hls = hls
      this.logInfo('Initialized HLS playback engine', {
        sourceUrl: config.sourceUrl,
        lowLatencyMode: true,
      })
      return
    }

    if (this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      this.logInfo('Using native HLS playback fallback', {
        sourceUrl: config.sourceUrl,
        autoplay: this.shouldAutoplay,
      })
      this.videoEl.src = config.sourceUrl
      this.videoEl.load()

      if (this.shouldAutoplay) {
        await this.tryPlay(this.videoEl)
      }

      return
    }

    this.fail('unsupported_format', 'This environment does not support HLS playback', false)
  }

  async play(): Promise<void> {
    if (!this.videoEl) {
      this.logError('Play requested without attached video element')
      throw new Error('video element is not attached')
    }

    if (!this.config) {
      this.logError('Play requested before stream source was loaded')
      throw new Error('stream source is not loaded')
    }

    if (this.state.status === 'stopped' || this.state.status === 'error' || !this.state.hasLoadedSource) {
      this.logInfo('Play requested while source was not ready; reloading stream', {
        status: this.state.status,
        hasLoadedSource: this.state.hasLoadedSource,
      })
      await this.load(this.config, { autoplay: true })
      return
    }

    this.logInfo('Resuming stream playback', {
      status: this.state.status,
      hasLoadedSource: this.state.hasLoadedSource,
    })
    await this.tryPlay(this.videoEl)
  }

  pause(): void {
    this.logInfo('Pausing stream playback')
    this.videoEl?.pause()
  }

  async stop(): Promise<void> {
    this.logInfo('Stopping stream playback', {
      status: this.state.status,
      hasLoadedSource: this.state.hasLoadedSource,
    })
    this.isStopping = true
    this.clearStallTimer()
    this.shouldAutoplay = false
    this.recoveryAttempts = 0

    this.destroyHls()

    if (this.videoEl) {
      this.videoEl.pause()
      this.videoEl.removeAttribute('src')
      this.videoEl.load()
    }

    this.patchState({ status: 'stopped', error: null, hasLoadedSource: true })
    this.isStopping = false
  }

  async retry(): Promise<void> {
    if (!this.config) {
      this.logError('Retry requested before stream source was loaded')
      throw new Error('stream source is not loaded')
    }

    this.reconnectCount += 1
    this.logWarn('Retrying stream playback', {
      reconnectCount: this.reconnectCount,
      previousStatus: this.state.status,
      sourceUrl: this.config.sourceUrl,
    })
    this.patchState({ status: 'reconnecting', error: null })
    await this.load(this.config, { autoplay: true })
  }

  async dispose(): Promise<void> {
    this.logInfo('Disposing stream controller')
    this.clearStallTimer()
    this.shouldAutoplay = false
    this.recoveryAttempts = 0
    this.destroyHls()

    if (this.videoEl) {
      this.videoEl.pause()
      this.videoEl.removeAttribute('src')
      this.videoEl.load()
    }

    this.detach()
    this.state = this.createInitialState()
  }

  setMuted(muted: boolean): void {
    if (this.videoEl) {
      this.videoEl.muted = muted
    }

    this.logInfo('Updated stream mute state', { muted })
  }

  getState(): PlayerState {
    return this.cloneState()
  }

  onStateChange(handler: (state: PlayerState) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private bindVideoListeners(videoEl: HTMLVideoElement): void {
    const onPlay = () => {
      if (this.isStopping) {
        return
      }

      this.recoveryAttempts = 0
      this.logInfo('Video element emitted play event')
      this.patchState({ status: 'live', error: null, hasLoadedSource: true })
    }

    const onPlaying = () => {
      if (this.isStopping) {
        return
      }

      this.recoveryAttempts = 0
      this.logInfo('Video element emitted playing event')
      this.patchState({ status: 'live', error: null, hasLoadedSource: true })
    }

    const onWaiting = () => {
      if (this.isStopping || this.state.status === 'paused') {
        return
      }

      this.bufferCount += 1
      this.logWarn('Video element entered waiting state', {
        hasLoadedSource: this.state.hasLoadedSource,
        bufferCount: this.bufferCount,
      })
      this.patchState({ status: this.state.hasLoadedSource ? 'buffering' : 'loading' })
    }

    const onPause = () => {
      if (this.isStopping) {
        return
      }

      this.logInfo('Video element emitted pause event')
      this.patchState({ status: 'paused' })
    }

    const onEnded = () => {
      this.logInfo('Video playback ended')
      this.patchState({ status: 'stopped' })
    }

    const onError = () => {
      if (this.isStopping) {
        return
      }

      const mediaError = videoEl.error
      const unsupportedCode = typeof MediaError === 'undefined' ? 4 : MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      const code: StreamErrorCode = mediaError?.code === unsupportedCode ? 'unsupported_format' : 'unknown'
      this.logError('Video element emitted playback error', {
        code,
        mediaErrorCode: mediaError?.code,
        mediaErrorMessage: mediaError?.message,
      })
      this.fail(code, mediaError?.message || 'Video element playback error', false)
    }

    videoEl.addEventListener('play', onPlay)
    videoEl.addEventListener('playing', onPlaying)
    videoEl.addEventListener('waiting', onWaiting)
    videoEl.addEventListener('pause', onPause)
    videoEl.addEventListener('ended', onEnded)
    videoEl.addEventListener('error', onError)

    this.removeVideoListeners = () => {
      videoEl.removeEventListener('play', onPlay)
      videoEl.removeEventListener('playing', onPlaying)
      videoEl.removeEventListener('waiting', onWaiting)
      videoEl.removeEventListener('pause', onPause)
      videoEl.removeEventListener('ended', onEnded)
      videoEl.removeEventListener('error', onError)
    }
  }

  private async tryPlay(videoEl: HTMLVideoElement): Promise<void> {
    try {
      this.logInfo('Attempting to start video playback', {
        muted: videoEl.muted,
        readyState: videoEl.readyState,
        networkState: videoEl.networkState,
      })
      await videoEl.play()
    } catch (error) {
      this.logError('Failed to start video playback', error)
      this.fail('unknown', error instanceof Error ? error.message : 'Unable to start video playback', false)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private handleRecoverableError(code: StreamErrorCode): boolean {
    this.recoveryAttempts += 1
    this.logWarn('Attempting playback recovery', {
      code,
      recoveryAttempts: this.recoveryAttempts,
      maxRecoveryAttempts: HlsPlayerController.MAX_RECOVERY_ATTEMPTS,
      hasLoadedSource: this.state.hasLoadedSource,
    })

    if (this.recoveryAttempts >= HlsPlayerController.MAX_RECOVERY_ATTEMPTS) {
      this.fail(code, 'Playback recovery attempts exceeded', true)
      return false
    }

    this.reconnectCount += 1
    this.patchState({
      status: this.state.hasLoadedSource ? 'buffering' : 'reconnecting',
      error: null,
    })
    return true
  }

  private mapHlsError(
    data: { response?: { code?: number }; details?: string; type?: string } | undefined
  ): StreamErrorCode {
    if (data?.response?.code === 401 || data?.response?.code === 403) {
      return 'auth_failed'
    }

    if (data?.type === Hls.ErrorTypes.NETWORK_ERROR) {
      return 'network_timeout'
    }

    if (data?.details?.toLowerCase().includes('manifest')) {
      return 'source_unavailable'
    }

    return 'unknown'
  }

  private fail(code: StreamErrorCode, message: string, retryable: boolean): void {
    this.clearStallTimer()
    this.logError('Playback failed', {
      code,
      message,
      retryable,
      stats: this.state.stats,
      status: this.state.status,
      sourceUrl: this.config?.sourceUrl,
    })
    this.patchState({
      status: 'error',
      error: {
        code,
        message,
        retryable,
        timestamp: Date.now(),
      },
    })
  }

  private patchState(patch: Partial<PlayerState>): void {
    const previousState = this.state
    this.state = {
      ...this.state,
      ...patch,
      stats: {
        startupTimeMs: this.startupStartedAt > 0 ? Date.now() - this.startupStartedAt : 0,
        reconnectCount: this.reconnectCount,
        bufferCount: this.bufferCount,
      },
    }

    if (previousState.status !== this.state.status) {
      this.logInfo('Playback status changed', {
        from: previousState.status,
        to: this.state.status,
        stats: this.state.stats,
      })
    }

    this.syncStallTimer()
    const snapshot = this.cloneState()
    for (const handler of this.listeners) {
      handler(snapshot)
    }
  }

  private syncStallTimer(): void {
    if (!['loading', 'buffering', 'reconnecting'].includes(this.state.status)) {
      this.clearStallTimer()
      return
    }

    this.clearStallTimer()
    this.stallTimer = setTimeout(() => {
      void this.handleStallTimeout()
    }, HlsPlayerController.STALL_TIMEOUT_MS)
  }

  private clearStallTimer(): void {
    if (!this.stallTimer) {
      return
    }

    clearTimeout(this.stallTimer)
    this.stallTimer = null
  }

  private async handleStallTimeout(): Promise<void> {
    this.clearStallTimer()

    if (!this.config || !['loading', 'buffering', 'reconnecting'].includes(this.state.status)) {
      return
    }

    this.logWarn('Playback stall timer elapsed', {
      status: this.state.status,
      sourceUrl: this.config.sourceUrl,
      stallTimeoutMs: HlsPlayerController.STALL_TIMEOUT_MS,
      stats: this.state.stats,
    })

    if (this.state.status === 'reconnecting') {
      this.fail('network_timeout', 'Playback stalled during reconnect', true)
      return
    }

    await this.retry()
  }

  private destroyHls(): void {
    if (!this.hls) {
      return
    }

    this.logInfo('Destroying HLS playback engine')
    this.hls.detachMedia()
    this.hls.destroy()
    this.hls = null
  }

  private logInfo(message: string, details?: unknown): void {
    logAppEvent('info', HlsPlayerController.LOG_SOURCE, message, details)
  }

  private logWarn(message: string, details?: unknown): void {
    logAppEvent('warn', HlsPlayerController.LOG_SOURCE, message, details)
  }

  private logError(message: string, details?: unknown): void {
    logAppEvent('error', HlsPlayerController.LOG_SOURCE, message, details)
  }

  private createInitialState(): PlayerState {
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

  private cloneState(): PlayerState {
    return {
      ...this.state,
      error: this.state.error ? { ...this.state.error } : null,
      stats: this.state.stats ? { ...this.state.stats } : null,
    }
  }
}

export function createPlayerController(): HlsPlayerController {
  return new HlsPlayerController()
}
