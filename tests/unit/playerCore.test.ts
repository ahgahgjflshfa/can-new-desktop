import { describe, expect, test, vi } from 'vitest'
import type { StreamAdapter } from '@/services/stream/adapters/types'
import { DefaultPlayerCore } from '@/services/stream/playerCore'

function createAdapterMock(): StreamAdapter {
  const handlers = new Set<(event: any) => void>()

  return {
    connect: vi.fn().mockImplementation(async () => {
      handlers.forEach(handler => handler({ type: 'connected' }))
    }),
    disconnect: vi.fn().mockImplementation(async () => {
      handlers.forEach(handler => handler({ type: 'disconnected' }))
    }),
    attach: vi.fn(),
    detach: vi.fn(),
    start: vi.fn().mockImplementation(async () => {
      handlers.forEach(handler => handler({ type: 'buffering' }))
      handlers.forEach(handler => handler({ type: 'started' }))
    }),
    stop: vi.fn().mockImplementation(async () => {
      handlers.forEach(handler => handler({ type: 'stopped' }))
    }),
    onEvent: vi.fn().mockImplementation(handler => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }),
  }
}

describe('DefaultPlayerCore', () => {
  test('load then play moves status to live', async () => {
    const adapter = createAdapterMock()
    const core = new DefaultPlayerCore(() => adapter)
    const statuses: string[] = []

    core.onEvent(event => {
      if (event.type === 'status') {
        statuses.push(event.status)
      }
    })

    await core.load({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })
    await core.play()

    expect(statuses).toEqual(['connecting', 'buffering', 'live'])
    expect(core.getStatus()).toBe('live')
  })

  test('reconnect restarts the same source', async () => {
    const adapter = createAdapterMock()
    const core = new DefaultPlayerCore(() => adapter)

    await core.load({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' })
    await core.reconnect()

    expect(adapter.stop).toHaveBeenCalledTimes(1)
    expect(adapter.disconnect).toHaveBeenCalledTimes(1)
    expect(adapter.connect).toHaveBeenNthCalledWith(1, { sourceUrl: 'https://example.com/live.m3u8' })
    expect(adapter.connect).toHaveBeenNthCalledWith(2, { sourceUrl: 'https://example.com/live.m3u8' })
  })
})
