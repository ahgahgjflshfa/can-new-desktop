import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ManagedStreamPlayer from './ManagedStreamPlayer.vue'

const controllerState = {
  status: 'idle',
  error: null,
  stats: { startupTimeMs: 0, reconnectCount: 0, bufferCount: 0 },
  hasLoadedSource: false,
}

const mockController = {
  attach: vi.fn(),
  load: vi.fn().mockResolvedValue(undefined),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  setMuted: vi.fn(),
  getState: vi.fn(() => controllerState),
  onStateChange: vi.fn(() => vi.fn()),
}

vi.mock('@/services/stream/playerCore', () => ({
  createPlayerController: vi.fn(() => mockController),
}))

describe('ManagedStreamPlayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  test('initializes and loads the provided stream config when video becomes ready', async () => {
    const wrapper = mount(ManagedStreamPlayer, {
      props: {
        streamConfig: {
          sourceType: 'hls',
          sourceUrl: 'https://example.com/live.m3u8',
        },
      },
    })

    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('videoReady', document.createElement('video'))
    await flushPromises()

    expect(mockController.attach).toHaveBeenCalled()
    expect(mockController.load).toHaveBeenLastCalledWith(
      {
        sourceType: 'hls',
        sourceUrl: 'https://example.com/live.m3u8',
      },
      { autoplay: false }
    )
  })

  test('wires player interactions into the controller', async () => {
    const wrapper = mount(ManagedStreamPlayer, {
      props: {
        streamConfig: {
          sourceType: 'hls',
          sourceUrl: 'https://example.com/live.m3u8',
        },
      },
    })

    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('play')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('retry')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('toggleMute')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('pause')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('stop')

    expect(mockController.play).toHaveBeenCalledTimes(1)
    expect(mockController.retry).toHaveBeenCalledTimes(1)
    expect(mockController.setMuted).toHaveBeenCalled()
    expect(mockController.pause).toHaveBeenCalledTimes(1)
    expect(mockController.stop).toHaveBeenCalledTimes(1)
  })
})
