export type StreamStatus = 'idle' | 'connecting' | 'buffering' | 'live' | 'reconnecting' | 'error' | 'stopped'

export type StreamErrorCode =
  | 'auth_failed'
  | 'network_timeout'
  | 'source_unavailable'
  | 'unsupported_format'
  | 'unknown'

export type StreamSourceType = 'mock' | 'webrtc' | 'hls'

export type StreamError = {
  code: StreamErrorCode
  message: string
  retryable: boolean
  timestamp: number
}

export type StreamStats = {
  startupTimeMs: number
  reconnectCount: number
  bufferCount: number
}

export type StreamConfig = {
  sourceType: StreamSourceType
  sourceUrl: string
}
