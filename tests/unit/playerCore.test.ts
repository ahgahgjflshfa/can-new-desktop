import { beforeEach, describe, expect, test, vi } from 'vitest'
import Hls from 'hls.js'
import { HlsPlayerController } from '@/services/stream/playerCore'

type HlsHandler = (event?: unknown, data?: any) => void

const { FakeHls, hlsInstances } = vi.hoisted(() => {
  const instances: FakeHls[] = []

  class FakeHls {
    static isSupported = vi.fn(() => true)
    static Events = {
      MANIFEST_PARSED: 'manifestParsed',
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

  return { FakeHls, hlsInstances: instances }
})

vi.mock('hls.js', () => ({ default: FakeHls }))

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'play', { value: vi.fn().mockResolvedValue(undefined), configurable: true })
  Object.defineProperty(video, 'pause', { value: vi.fn(), configurable: true })
  Object.defineProperty(video, 'load', { value: vi.fn(), configurable: true })
  Object.defineProperty(video, 'canPlayType', { value: vi.fn(() => ''), configurable: true })
  return video
}

describe('HlsPlayerController', () => {
  beforeEach(() => {
    hlsInstances.length = 0
    vi.clearAllMocks()
    FakeHls.isSupported.mockReturnValue(true)
  })

  test('load with autoplay enters live after playing event', async () => {
    const controller = new HlsPlayerController()
    const video = createVideoElement()
    controller.attach(video)

    await controller.load({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' }, { autoplay: true })
    hlsInstances[0]?.emit(FakeHls.Events.MANIFEST_PARSED)
    video.dispatchEvent(new Event('playing'))

    expect(controller.getState().status).toBe('live')
  })

  test('pause moves player into paused state', async () => {
    const controller = new HlsPlayerController()
    const video = createVideoElement()
    controller.attach(video)

    await controller.load({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' }, { autoplay: true })
    hlsInstances[0]?.emit(FakeHls.Events.MANIFEST_PARSED)
    video.dispatchEvent(new Event('playing'))
    controller.pause()
    video.dispatchEvent(new Event('pause'))

    expect(controller.getState().status).toBe('paused')
  })

  test('stall timeout retries playback after buffering persists', async () => {
    vi.useFakeTimers()

    const controller = new HlsPlayerController()
    const video = createVideoElement()
    controller.attach(video)

    await controller.load({ sourceType: 'hls', sourceUrl: 'https://example.com/live.m3u8' }, { autoplay: true })
    video.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(12000)

    expect(hlsInstances.length).toBeGreaterThan(1)
    vi.useRealTimers()
  })
})
