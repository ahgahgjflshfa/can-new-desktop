import Hls from 'hls.js'
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
  }

  detach(): void {
    if (this.removeVideoListeners) {
      this.removeVideoListeners()
      this.removeVideoListeners = null
    }

    this.videoEl = null
  }

  async load(config: StreamConfig, options: { autoplay?: boolean } = {}): Promise<void> {
    this.config = config
    this.shouldAutoplay = options.autoplay ?? false
    this.currentLoadToken += 1
    const loadToken = this.currentLoadToken

    this.startupStartedAt = Date.now()
    this.recoveryAttempts = 0
    this.patchState({
      status: 'loading',
      error: null,
      hasLoadedSource: false,
      stats: this.state.stats,
    })

    this.destroyHls()

    if (!this.videoEl) {
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

        if (this.shouldAutoplay) {
          await this.tryPlay(this.videoEl)
        }
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (loadToken !== this.currentLoadToken) {
          return
        }

        if (!data?.fatal) {
          return
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR || data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          this.handleRecoverableError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network_timeout' : 'unknown')

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad()
          } else {
            hls.recoverMediaError()
          }

          return
        }

        this.fail(this.mapHlsError(data), data?.details ?? 'HLS playback error', false)
      })

      hls.loadSource(config.sourceUrl)
      hls.attachMedia(this.videoEl)
      this.hls = hls
      return
    }

    if (this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
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
      throw new Error('video element is not attached')
    }

    if (!this.config) {
      throw new Error('stream source is not loaded')
    }

    if (this.state.status === 'stopped' || this.state.status === 'error' || !this.state.hasLoadedSource) {
      await this.load(this.config, { autoplay: true })
      return
    }

    await this.tryPlay(this.videoEl)
  }

  pause(): void {
    this.videoEl?.pause()
  }

  async stop(): Promise<void> {
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
      throw new Error('stream source is not loaded')
    }

    this.reconnectCount += 1
    this.patchState({ status: 'reconnecting', error: null })
    await this.load(this.config, { autoplay: true })
  }

  async dispose(): Promise<void> {
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
      this.patchState({ status: 'live', error: null, hasLoadedSource: true })
    }

    const onPlaying = () => {
      if (this.isStopping) {
        return
      }

      this.recoveryAttempts = 0
      this.patchState({ status: 'live', error: null, hasLoadedSource: true })
    }

    const onWaiting = () => {
      if (this.isStopping || this.state.status === 'paused') {
        return
      }

      this.bufferCount += 1
      this.patchState({ status: this.state.hasLoadedSource ? 'buffering' : 'loading' })
    }

    const onPause = () => {
      if (this.isStopping) {
        return
      }

      this.patchState({ status: 'paused' })
    }

    const onEnded = () => {
      this.patchState({ status: 'stopped' })
    }

    const onError = () => {
      if (this.isStopping) {
        return
      }

      const mediaError = videoEl.error
      const unsupportedCode = typeof MediaError === 'undefined' ? 4 : MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      const code: StreamErrorCode = mediaError?.code === unsupportedCode ? 'unsupported_format' : 'unknown'
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
      await videoEl.play()
    } catch (error) {
      this.fail('unknown', error instanceof Error ? error.message : 'Unable to start video playback', false)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  private handleRecoverableError(code: StreamErrorCode): void {
    this.recoveryAttempts += 1

    if (this.recoveryAttempts >= HlsPlayerController.MAX_RECOVERY_ATTEMPTS) {
      this.fail(code, 'Playback recovery attempts exceeded', true)
      return
    }

    this.reconnectCount += 1
    this.patchState({
      status: this.state.hasLoadedSource ? 'buffering' : 'reconnecting',
      error: null,
    })
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
    this.state = {
      ...this.state,
      ...patch,
      stats: {
        startupTimeMs: this.startupStartedAt > 0 ? Date.now() - this.startupStartedAt : 0,
        reconnectCount: this.reconnectCount,
        bufferCount: this.bufferCount,
      },
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

    this.hls.detachMedia()
    this.hls.destroy()
    this.hls = null
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
