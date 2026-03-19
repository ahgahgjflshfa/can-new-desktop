export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export type StreamErrorCode = 'unauthorized' | 'network_timeout' | 'source_unavailable' | 'unknown';

export type StreamSourceType = 'mock' | 'webrtc' | 'hls';

export type StreamError = {
  code: StreamErrorCode,
  message: string,
  retryable: boolean,
  timestamp: number,
}

export type StreamStats = {
  startupTimeMs: number,
  reconnectCount: number,
  bufferCount: number,
}

export type StreamConfig = {
  sourceType: StreamSourceType,
}
