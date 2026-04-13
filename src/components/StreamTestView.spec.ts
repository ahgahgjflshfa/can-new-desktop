import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import StreamTestView from './StreamTestView.vue'

describe('StreamTestView', () => {
  test('renders the stream test page shell', () => {
    const wrapper = mount(StreamTestView, {
      global: {
        stubs: {
          ManagedStreamPlayer: {
            template: '<div data-testid="managed-player" />',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Stream Test')
    expect(wrapper.find('input[type="url"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="managed-player"]').exists()).toBe(true)
  })

  test('updates the active stream url when loading a new source', async () => {
    const wrapper = mount(StreamTestView, {
      global: {
        stubs: {
          ManagedStreamPlayer: {
            props: ['streamConfig'],
            template: '<div data-testid="managed-player">{{ streamConfig.sourceUrl }}</div>',
          },
        },
      },
    })

    await wrapper.find('input[type="url"]').setValue('https://example.com/updated.m3u8')
    await wrapper.find('button').trigger('click')

    expect(wrapper.find('[data-testid="managed-player"]').text()).toContain('https://example.com/updated.m3u8')
  })
})
