import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ManagedStreamPlayer from './ManagedStreamPlayer.vue'

const mockStreamStore = {
  status: 'idle',
  stats: null,
  lastError: null,
  isPlaying: false,
  muted: false,
  isPending: false,
  init: vi.fn(),
  loadStream: vi.fn().mockResolvedValue(undefined),
  attachVideoElement: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn().mockResolvedValue(undefined),
  toggleMute: vi.fn(),
  dispose: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@/stores/streamStore', () => ({
  useStreamStore: vi.fn(() => mockStreamStore),
}))

describe('ManagedStreamPlayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('initializes the store and loads the provided stream config', async () => {
    mount(ManagedStreamPlayer, {
      props: {
        streamConfig: {
          sourceType: 'hls',
          sourceUrl: 'https://example.com/live.m3u8',
        },
      },
    })

    await flushPromises()

    expect(mockStreamStore.init).toHaveBeenCalledTimes(1)
    expect(mockStreamStore.loadStream).toHaveBeenCalledWith(
      {
        sourceType: 'hls',
        sourceUrl: 'https://example.com/live.m3u8',
      },
      false
    )
  })

  test('wires player interactions into the stream store', async () => {
    const wrapper = mount(ManagedStreamPlayer, {
      props: {
        streamConfig: {
          sourceType: 'hls',
          sourceUrl: 'https://example.com/live.m3u8',
        },
      },
    })

    await flushPromises()

    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('play')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('retry')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('toggleMute')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('pause')
    await wrapper.findComponent({ name: 'StreamPlayer' }).vm.$emit('stop')

    expect(mockStreamStore.play).toHaveBeenCalledTimes(1)
    expect(mockStreamStore.retry).toHaveBeenCalledTimes(1)
    expect(mockStreamStore.toggleMute).toHaveBeenCalledTimes(1)
    expect(mockStreamStore.pause).toHaveBeenCalledTimes(1)
    expect(mockStreamStore.stop).toHaveBeenCalledTimes(1)
  })
})
