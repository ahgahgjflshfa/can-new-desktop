import type { StreamConfig, StreamError, StreamStats, StreamStatus } from '@/types/stream'
import { AdapterFactory } from './adapters/factory'
import type { AdapterEvent, StreamAdapter } from './adapters/types'

export type PlayerCoreEvent =
  | { type: 'status'; status: StreamStatus }
  | { type: 'error'; error: StreamError }
  | { type: 'stats'; stats: StreamStats }

export interface PlayerCore {
  load(config: StreamConfig): Promise<void>
  attach(videoEl: HTMLVideoElement): void
  play(): Promise<void>
  pause(): void
  stop(): Promise<void>
  reconnect(): Promise<void>
  dispose(): Promise<void>
  getStatus(): StreamStatus
  getLastError(): StreamError | null
  onEvent(handler: (event: PlayerCoreEvent) => void): () => void
}

export class DefaultPlayerCore implements PlayerCore {
  constructor(private readonly createAdapter: typeof AdapterFactory = AdapterFactory) {}

  private adapter: StreamAdapter | null = null
  private config: StreamConfig | null = null
  private videoEl: HTMLVideoElement | null = null
  private status: StreamStatus = 'idle'
  private lastError: StreamError | null = null
  private unsubscribeAdapter: (() => void) | null = null
  private listeners = new Set<(event: PlayerCoreEvent) => void>()

  async load(config: StreamConfig): Promise<void> {
    await this.teardownCurrentAdapter()

    this.config = config
    this.adapter = this.createAdapter(config.sourceType)
    this.unsubscribeAdapter = this.adapter.onEvent(event => this.handleAdapterEvent(event))

    this.setStatus('connecting')
    await this.adapter.connect({ sourceUrl: config.sourceUrl })

    if (this.videoEl) {
      this.adapter.attach(this.videoEl)
    }
  }

  attach(videoEl: HTMLVideoElement): void {
    this.videoEl = videoEl

    if (this.adapter) {
      this.adapter.attach(videoEl)
    }
  }

  async play(): Promise<void> {
    if (!this.adapter) {
      throw new Error('load must be called before play')
    }

    await this.adapter.start()
  }

  pause(): void {
    this.videoEl?.pause()
  }

  async stop(): Promise<void> {
    if (!this.adapter) {
      return
    }

    await this.adapter.stop()
  }

  async reconnect(): Promise<void> {
    if (!this.adapter || !this.config) {
      throw new Error('load must be called before reconnect')
    }

    this.setStatus('reconnecting')
    await this.adapter.stop()
    await this.adapter.disconnect()
    await this.adapter.connect({ sourceUrl: this.config.sourceUrl })

    if (this.videoEl) {
      this.adapter.attach(this.videoEl)
    }

    await this.adapter.start()
  }

  async dispose(): Promise<void> {
    await this.teardownCurrentAdapter()
    this.videoEl = null
    this.status = 'idle'
    this.lastError = null
  }

  getStatus(): StreamStatus {
    return this.status
  }

  getLastError(): StreamError | null {
    return this.lastError
  }

  onEvent(handler: (event: PlayerCoreEvent) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private async teardownCurrentAdapter(): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect()
    }

    if (this.unsubscribeAdapter) {
      this.unsubscribeAdapter()
      this.unsubscribeAdapter = null
    }

    this.adapter = null
  }

  private handleAdapterEvent(event: AdapterEvent): void {
    if (event.type === 'buffering') {
      this.setStatus('buffering')
      return
    }

    if (event.type === 'started') {
      this.setStatus('live')
      return
    }

    if (event.type === 'stopped') {
      if (this.status === 'reconnecting') {
        return
      }

      this.setStatus('stopped')
      return
    }

    if (event.type === 'stats') {
      this.emit({ type: 'stats', stats: event.stats })
      return
    }

    if (event.type === 'error') {
      this.lastError = {
        code: event.code,
        message: event.message,
        retryable: event.code === 'network_timeout' || event.code === 'source_unavailable',
        timestamp: Date.now(),
      }
      this.setStatus('error')
      this.emit({ type: 'error', error: this.lastError })
    }
  }

  private setStatus(status: StreamStatus): void {
    this.status = status
    this.emit({ type: 'status', status })
  }

  private emit(event: PlayerCoreEvent): void {
    for (const handler of this.listeners) {
      handler(event)
    }
  }
}

export function createPlayerCore(): PlayerCore {
  return new DefaultPlayerCore()
}
