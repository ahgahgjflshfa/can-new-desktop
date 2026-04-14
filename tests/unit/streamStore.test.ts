import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStreamStore } from '@/stores/streamStore'

describe('streamStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  test('init hydrates persisted state', () => {
    const store = useStreamStore()
    store.init()

    expect(store.isHydrated).toBe(true)
  })

  test('setCurrentConfig stores the current source', () => {
    const store = useStreamStore()

    store.setCurrentConfig({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })

    expect(store.currentConfig).toEqual({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })
  })

  test('setPlayerState replaces the mirrored player snapshot', () => {
    const store = useStreamStore()

    store.setPlayerState({
      status: 'live',
      error: null,
      stats: { startupTimeMs: 900, reconnectCount: 1, bufferCount: 2 },
      hasLoadedSource: true,
    })

    expect(store.playerState.status).toBe('live')
    expect(store.playerState.stats).toEqual({ startupTimeMs: 900, reconnectCount: 1, bufferCount: 2 })
  })

  test('toggleMute updates persisted mute preference', () => {
    const store = useStreamStore()

    store.toggleMute()

    expect(store.muted).toBe(true)
  })
})
