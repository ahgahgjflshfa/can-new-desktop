import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import type { PlayerState } from '@/services/stream/playerCore'
import StreamPlayer from './StreamPlayer.vue'

function createState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    status: 'idle',
    error: null,
    stats: { startupTimeMs: 0, reconnectCount: 0, bufferCount: 0 },
    hasLoadedSource: false,
    ...overrides,
  }
}

describe('StreamPlayer', () => {
  test('emits videoReady with the underlying video element', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        state: createState(),
      },
    })

    expect(wrapper.emitted('videoReady')?.[0]?.[0]).toBeInstanceOf(HTMLVideoElement)
  })

  test('renders retry affordance for retryable error state', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        state: createState({
          status: 'error',
          error: {
            code: 'network_timeout',
            message: 'Timed out while loading segments',
            retryable: true,
            timestamp: Date.now(),
          },
        }),
      },
    })

    expect(wrapper.text()).toContain('Playback interrupted')
    expect(wrapper.text()).toContain('Retry Stream')
  })

  test('shows compact buffering during playback without blocking overlay text', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        state: createState({
          status: 'buffering',
          hasLoadedSource: true,
        }),
      },
    })

    expect(wrapper.text()).toContain('Buffering')
    expect(wrapper.text()).not.toContain('Loading video')
  })

  test('shows a resume overlay when paused', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        state: createState({
          status: 'paused',
          hasLoadedSource: true,
        }),
      },
    })

    expect(wrapper.text()).toContain('Paused')
    expect(wrapper.text()).toContain('Resume')
  })
})
