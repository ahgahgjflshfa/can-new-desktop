import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import StreamControls from './StreamControls.vue'

describe('StreamControls', () => {
  test('switches primary action to pause while live', () => {
    const wrapper = mount(StreamControls, {
      props: {
        status: 'live',
      },
    })

    expect(wrapper.findAll('button')[0]?.text()).toContain('暫停')
  })

  test('keeps play available when paused', () => {
    const wrapper = mount(StreamControls, {
      props: {
        status: 'paused',
      },
    })

    expect(wrapper.findAll('button')[0]?.text()).toContain('播放')
  })
})
