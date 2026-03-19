export type StreamAdapterConfig = {}

export type AdapterEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'buffering' }
  | { type: 'error'; code: 'network_timeout' | 'unauthorized' | 'unknown'; message: string }

// connect -> attach -> start -> stop -> detach -> disconnect
export interface StreamAdapter {
  connect(config: StreamAdapterConfig): Promise<void>,
  disconnect(): Promise<void>,
  attach(videoEl: HTMLVideoElement): void,
  detach(): void,
  start(): Promise<void>,
  stop(): Promise<void>,
  onEvent(handler: (event: AdapterEvent) => void): () => void,
}
