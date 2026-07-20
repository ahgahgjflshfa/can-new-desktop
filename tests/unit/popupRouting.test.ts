import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PopupApp from '@/PopupApp.vue'

const eventState = vi.hoisted(() => ({ listener: null as ((event: { payload: unknown }) => void) | null }))
const emitMock = vi.hoisted(() => vi.fn())
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn(async (_name: string, callback: (event: { payload: unknown }) => void) => {
    eventState.listener = callback
    return vi.fn()
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

describe('Popup source routing', () => {
  beforeEach(() => {
    eventState.listener = null
    emitMock.mockReset()
    invokeMock.mockReset().mockResolvedValue(null)
  })
  afterEach(() => eventState.listener = null)

  async function show(metadata?: Record<string, unknown>) {
    const wrapper = mount(PopupApp)
    await Promise.resolve()
    eventState.listener?.({ payload: {
      id: 'n1', title: 'title', body: 'body', priority: 'pending', createdAt: '2026-01-01', unreadCount: 1, metadata,
    } })
    await wrapper.vm.$nextTick()
    await wrapper.get('button').trigger('click')
    return wrapper
  }

  test('routes charge notifications explicitly to charge', async () => {
    await show({ system: 'charge' })
    expect(emitMock).toHaveBeenCalledWith('open-notification-system', { system: 'charge' })
  })

  test('preserves CAN routing and maps legacy missing source to LMA', async () => {
    await show({ system: 'can' })
    expect(emitMock).toHaveBeenCalledWith('open-notification-system', { system: 'can' })
    emitMock.mockReset()
    await show()
    expect(emitMock).toHaveBeenCalledWith('open-notification-system', { system: 'lma' })
  })

  test('does not fall back to LMA for unknown explicit systems', async () => {
    await show({ system: 'unknown-system' })
    expect(emitMock).not.toHaveBeenCalled()
  })
})
