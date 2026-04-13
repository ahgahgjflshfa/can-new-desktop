import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HLSAdapter } from '@/services/stream/adapters/hlsAdapter'

type HlsHandler = (event?: unknown, data?: any) => void

const { FakeHls, hlsInstances } = vi.hoisted(() => {
  const instances: FakeHls[] = []

  class FakeHls {
    static isSupported = vi.fn(() => true)
    static Events = {
      ERROR: 'error',
    }
    static ErrorTypes = {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
      OTHER_ERROR: 'otherError',
    }

    public destroy = vi.fn()
    public detachMedia = vi.fn()
    public attachMedia = vi.fn()
    public loadSource = vi.fn()
    public startLoad = vi.fn()
    public recoverMediaError = vi.fn()
    private handlers = new Map<string, HlsHandler[]>()

    constructor(_config?: unknown) {
      instances.push(this)
    }

    on(event: string, handler: HlsHandler): void {
      const handlers = this.handlers.get(event) ?? []
      handlers.push(handler)
      this.handlers.set(event, handlers)
    }

    emit(event: string, data?: any): void {
      const handlers = this.handlers.get(event) ?? []
      handlers.forEach(handler => handler(undefined, data))
    }
  }

  return {
    FakeHls,
    hlsInstances: instances,
  }
})

vi.mock('hls.js', () => ({
  default: FakeHls,
}))

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  const canPlayType = vi.fn(() => '')

  Object.defineProperty(video, 'play', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  })
  Object.defineProperty(video, 'pause', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(video, 'load', {
    value: vi.fn(),
    configurable: true,
  })
  Object.defineProperty(video, 'canPlayType', {
    value: canPlayType,
    configurable: true,
  })
  return video
}

describe('HLSAdapter', () => {
  beforeEach(() => {
    hlsInstances.length = 0
    vi.clearAllMocks()
    FakeHls.isSupported.mockReturnValue(true)
  })

  test('connect attach start emits expected lifecycle', async () => {
    const adapter = new HLSAdapter()
    const video = createVideoElement()
    const events: string[] = []

    adapter.onEvent(event => {
      events.push(event.type)
    })

    await adapter.connect({ sourceUrl: 'https://example.com/live.m3u8' })
    adapter.attach(video)
    await adapter.start()
    video.dispatchEvent(new Event('playing'))

    expect(events).toEqual(['connected', 'buffering', 'started', 'stats'])
    expect(hlsInstances).toHaveLength(1)
    expect(hlsInstances[0]?.loadSource).toHaveBeenCalledWith('https://example.com/live.m3u8')
    expect(hlsInstances[0]?.attachMedia).toHaveBeenCalledWith(video)
  })

  test('unsubscribe stops receiving events', async () => {
    const adapter = new HLSAdapter()
    const video = createVideoElement()
    const handler = vi.fn()

    const unsubscribe = adapter.onEvent(handler)

    await adapter.connect({ sourceUrl: 'https://example.com/live.m3u8' })
    unsubscribe()
    adapter.attach(video)
    await adapter.start()
    video.dispatchEvent(new Event('playing'))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ type: 'connected' })
  })

  test('fatal network errors emit retryable error and restart loading', async () => {
    const adapter = new HLSAdapter()
    const video = createVideoElement()
    const events: Array<{ type: string; code?: string }> = []

    adapter.onEvent(event => {
      if (event.type === 'error') {
        events.push({ type: event.type, code: event.code })
        return
      }

      events.push({ type: event.type })
    })

    await adapter.connect({ sourceUrl: 'https://example.com/live.m3u8' })
    adapter.attach(video)
    await adapter.start()

    hlsInstances[0]?.emit(FakeHls.Events.ERROR, {
      fatal: true,
      type: FakeHls.ErrorTypes.NETWORK_ERROR,
      details: 'manifest load failed',
    })

    expect(events).toContainEqual({ type: 'error', code: 'network_timeout' })
    expect(hlsInstances[0]?.startLoad).toHaveBeenCalled()
  })

  test('non-fatal hls warnings do not emit playback errors', async () => {
    const adapter = new HLSAdapter()
    const video = createVideoElement()
    const errorHandler = vi.fn()

    adapter.onEvent(event => {
      if (event.type === 'error') {
        errorHandler(event)
      }
    })

    await adapter.connect({ sourceUrl: 'https://example.com/live.m3u8' })
    adapter.attach(video)
    await adapter.start()

    hlsInstances[0]?.emit(FakeHls.Events.ERROR, {
      fatal: false,
      type: FakeHls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferSeekOverHole',
    })

    expect(errorHandler).not.toHaveBeenCalled()
  })

  test('falls back to native hls when MSE is unavailable', async () => {
    FakeHls.isSupported.mockReturnValue(false)

    const adapter = new HLSAdapter()
    const video = createVideoElement()
    const canPlayType = video.canPlayType as unknown as ReturnType<typeof vi.fn>
    canPlayType.mockReturnValue('probably')

    await adapter.connect({ sourceUrl: 'https://example.com/live.m3u8' })
    adapter.attach(video)
    await adapter.start()

    expect(video.src).toContain('https://example.com/live.m3u8')
    expect(video.load).toHaveBeenCalled()
    expect(video.play).toHaveBeenCalled()
  })
})
