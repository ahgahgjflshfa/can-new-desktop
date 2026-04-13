import type { StreamErrorCode, StreamStats } from '@/types/stream'

export type StreamAdapterConfig = {
  sourceUrl: string
}

export type AdapterEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'buffering' }
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'stats'; stats: StreamStats }
  | { type: 'error'; code: StreamErrorCode; message: string }

// connect -> attach -> start -> stop -> detach -> disconnect
export interface StreamAdapter {
  connect(config: StreamAdapterConfig): Promise<void>
  disconnect(): Promise<void>
  attach(videoEl: HTMLVideoElement): void
  detach(): void
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(handler: (event: AdapterEvent) => void): () => void
}
