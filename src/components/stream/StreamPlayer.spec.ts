import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import StreamPlayer from './StreamPlayer.vue'

describe('StreamPlayer', () => {
  test('emits videoReady with the underlying video element', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        status: 'idle',
      },
    })

    const emitted = wrapper.emitted('videoReady')

    expect(emitted).toHaveLength(1)
    expect(emitted?.[0]?.[0]).toBeInstanceOf(HTMLVideoElement)
  })

  test('renders retry affordance for retryable error state', () => {
    const wrapper = mount(StreamPlayer, {
      props: {
        status: 'error',
        error: {
          code: 'network_timeout',
          message: 'Timed out while loading segments',
          retryable: true,
          timestamp: Date.now(),
        },
      },
    })

    expect(wrapper.text()).toContain('Playback interrupted')
    expect(wrapper.text()).toContain('Timed out while loading segments')
    expect(wrapper.text()).toContain('Retry Stream')
  })
})
