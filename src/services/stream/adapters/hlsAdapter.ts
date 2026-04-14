import Hls from 'hls.js'
import type { StreamErrorCode } from '@/types/stream'
import type { AdapterEvent, StreamAdapter, StreamAdapterConfig } from './types'

type AdapterState = 'idle' | 'connected' | 'streaming' | 'stopped'

export class HLSAdapter implements StreamAdapter {
  private state: AdapterState = 'idle'
  private config: StreamAdapterConfig | null = null
  private videoEl: HTMLVideoElement | null = null
  private hls: Hls | null = null
  private listeners = new Set<(event: AdapterEvent) => void>()
  private removeVideoListeners: (() => void) | null = null
  private startupStartedAt = 0
  private reconnectCount = 0
  private bufferCount = 0
  private isPlaybackActive = false

  async connect(config: StreamAdapterConfig): Promise<void> {
    if (!config.sourceUrl) {
      throw new Error('sourceUrl is required')
    }

    this.config = config
    this.state = 'connected'
    this.emit({ type: 'connected' })
  }

  attach(videoEl: HTMLVideoElement): void {
    this.detach()
    this.videoEl = videoEl

    this.bindVideoListeners(videoEl)
  }

  private bindVideoListeners(videoEl: HTMLVideoElement): void {
    if (this.removeVideoListeners) {
      this.removeVideoListeners()
      this.removeVideoListeners = null
    }

    const onWaiting = () => {
      this.isPlaybackActive = false
      this.bufferCount += 1
      this.emit({ type: 'buffering' })
      this.emitStats()
    }

    const markStarted = () => {
      if (this.isPlaybackActive) {
        return
      }

      this.isPlaybackActive = true
      this.state = 'streaming'
      this.emit({ type: 'started' })
      this.emitStats()
    }

    const onPlay = () => {
      markStarted()
    }

    const onPlaying = () => {
      markStarted()
    }

    const onError = () => {
      this.emitVideoError()
    }

    videoEl.addEventListener('waiting', onWaiting)
    videoEl.addEventListener('play', onPlay)
    videoEl.addEventListener('playing', onPlaying)
    videoEl.addEventListener('error', onError)

    this.removeVideoListeners = () => {
      videoEl.removeEventListener('waiting', onWaiting)
      videoEl.removeEventListener('play', onPlay)
      videoEl.removeEventListener('playing', onPlaying)
      videoEl.removeEventListener('error', onError)
    }
  }

  async start(): Promise<void> {
    if (this.state === 'idle' || !this.config) {
      throw new Error('connect must be called before start')
    }

    this.startupStartedAt = Date.now()
    this.isPlaybackActive = false
    this.emit({ type: 'buffering' })

    if (this.videoEl) {
      if (!this.removeVideoListeners) {
        this.bindVideoListeners(this.videoEl)
      }

      await this.startPlayback(this.videoEl)
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle') {
      return
    }

    if (this.hls) {
      this.hls.detachMedia()
      this.hls.destroy()
      this.hls = null
    }

    if (this.videoEl) {
      this.videoEl.pause()
      this.videoEl.removeAttribute('src')
      this.videoEl.load()
    }

    if (this.removeVideoListeners) {
      this.removeVideoListeners()
      this.removeVideoListeners = null
    }

    this.state = 'stopped'
    this.isPlaybackActive = false
    this.emit({ type: 'stopped' })
  }

  async disconnect(): Promise<void> {
    await this.stop()
    this.detach()
    this.config = null
    this.state = 'idle'
    this.emit({ type: 'disconnected' })
  }

  detach(): void {
    if (this.hls) {
      this.hls.detachMedia()
    }

    if (this.removeVideoListeners) {
      this.removeVideoListeners()
      this.removeVideoListeners = null
    }

    this.videoEl = null
  }

  onEvent(handler: (event: AdapterEvent) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private async startPlayback(videoEl: HTMLVideoElement): Promise<void> {
    if (!this.config) {
      throw new Error('connect must be called before startPlayback')
    }

    this.destroyHlsInstance()

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      })

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) {
          return
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          this.reconnectCount += 1
          this.emit({ type: 'buffering' })
          hls.startLoad()
          this.emitStats()
          return
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          this.emit({ type: 'buffering' })
          hls.recoverMediaError()
          return
        }

        const code = this.mapHlsError(data)
        this.emit({ type: 'error', code, message: data?.details ?? 'HLS playback error' })

        this.destroyHlsInstance()
      })

      hls.loadSource(this.config.sourceUrl)
      hls.attachMedia(videoEl)
      this.hls = hls
      await this.tryPlay(videoEl)
      return
    }

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = this.config.sourceUrl
      videoEl.load()
      await this.tryPlay(videoEl)
      return
    }

    const message = 'This environment does not support HLS playback'
    this.emit({ type: 'error', code: 'unsupported_format', message })
    throw new Error(message)
  }

  private async tryPlay(videoEl: HTMLVideoElement): Promise<void> {
    try {
      await videoEl.play()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start video playback'
      this.emit({ type: 'error', code: 'unknown', message })
      throw error instanceof Error ? error : new Error(message)
    }
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

  private emitVideoError(): void {
    const mediaError = this.videoEl?.error
    const unsupportedCode = typeof MediaError === 'undefined' ? 4 : MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
    const code = mediaError?.code === unsupportedCode ? 'unsupported_format' : 'unknown'
    const message = mediaError?.message || 'Video element playback error'
    this.emit({ type: 'error', code, message })
  }

  private emitStats(): void {
    this.emit({
      type: 'stats',
      stats: {
        startupTimeMs: this.startupStartedAt > 0 ? Date.now() - this.startupStartedAt : 0,
        reconnectCount: this.reconnectCount,
        bufferCount: this.bufferCount,
      },
    })
  }

  private destroyHlsInstance(): void {
    if (!this.hls) {
      return
    }

    this.hls.detachMedia()
    this.hls.destroy()
    this.hls = null
  }

  private emit(event: AdapterEvent): void {
    for (const handler of this.listeners) {
      handler(event)
    }
  }
}
