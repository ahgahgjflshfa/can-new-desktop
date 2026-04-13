import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import StreamControls from './StreamControls.vue'

describe('StreamControls', () => {
  test('keeps play available when stream is live but currently paused', () => {
    const wrapper = mount(StreamControls, {
      props: {
        status: 'live',
        isPlaying: false,
      },
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0]?.attributes('disabled')).toBeUndefined()
    expect(buttons[1]?.attributes('disabled')).toBeDefined()
  })
})
