import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStreamStore } from '@/stores/streamStore'
import type { PlayerCore, PlayerCoreEvent } from '@/services/stream/playerCore'
import type { StreamStatus } from '@/types/stream'

const handlers = new Set<(event: PlayerCoreEvent) => void>()

const mockPlayerCore: PlayerCore = {
  load: vi.fn(),
  attach: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  reconnect: vi.fn(),
  dispose: vi.fn(),
  getStatus: vi.fn<() => StreamStatus>(() => 'idle'),
  getLastError: vi.fn(() => null),
  onEvent: vi.fn(handler => {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }),
}

vi.mock('@/services/stream/playerCore', () => ({
  createPlayerCore: vi.fn(() => mockPlayerCore),
}))

function emitPlayerEvent(event: PlayerCoreEvent) {
  handlers.forEach(handler => handler(event))
}

describe('streamStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    handlers.clear()

    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key]
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(storage)) {
          delete storage[key]
        }
      }),
    })
  })

  test('init creates and subscribes player core', () => {
    const store = useStreamStore()

    store.init()

    expect(store.isHydrated).toBe(true)
    expect(mockPlayerCore.onEvent).toHaveBeenCalledTimes(1)
  })

  test('loadStream stores config and calls player core load', async () => {
    const store = useStreamStore()
    store.init()

    await store.loadStream({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })

    expect(store.currentConfig).toEqual({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })
    expect(mockPlayerCore.load).toHaveBeenCalledWith({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })
  })

  test('attachVideoElement forwards video element and applies muted state', () => {
    const store = useStreamStore()
    store.init()
    const video = document.createElement('video')

    store.setMuted(true)
    store.attachVideoElement(video)

    expect(mockPlayerCore.attach).toHaveBeenCalledWith(video)
    expect(video.muted).toBe(true)
  })

  test('player events update status, stats, and error state', () => {
    const store = useStreamStore()
    store.init()

    emitPlayerEvent({ type: 'status', status: 'buffering' })
    emitPlayerEvent({ type: 'stats', stats: { startupTimeMs: 900, reconnectCount: 1, bufferCount: 2 } })
    emitPlayerEvent({
      type: 'error',
      error: {
        code: 'network_timeout',
        message: 'Timed out',
        retryable: true,
        timestamp: Date.now(),
      },
    })

    expect(store.status).toBe('error')
    expect(store.stats).toEqual({ startupTimeMs: 900, reconnectCount: 1, bufferCount: 2 })
    expect(store.lastError?.code).toBe('network_timeout')
    expect(store.canRetry).toBe(true)
  })

  test('retry reconnects the current source and clears the previous error', async () => {
    const store = useStreamStore()
    store.init()
    store.currentConfig = { sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' }
    store.lastError = {
      code: 'network_timeout',
      message: 'Timed out',
      retryable: true,
      timestamp: Date.now(),
    }

    await store.retry()

    expect(mockPlayerCore.reconnect).toHaveBeenCalledTimes(1)
    expect(store.lastError).toBeNull()
  })
})
