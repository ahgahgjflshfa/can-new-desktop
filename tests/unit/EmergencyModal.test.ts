import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import EmergencyModal from '@/components/EmergencyModal.vue'
import { useNotificationStore } from '@/stores/notificationStore'
import type { NotificationState } from '@/types/notification'

vi.mock('@/services/notificationPoller', () => ({
  getNotificationPoller: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(() => false),
  })),
  convertToNotificationState: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/tauri/window', () => ({
  isTauriRuntime: vi.fn(() => false),
}))

describe('EmergencyModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  function createMockNotificationState(overrides: Partial<NotificationState> = {}): NotificationState {
    return {
      id: `notif_${Date.now()}`,
      title: 'Emergency Alert',
      body: 'This is a test emergency notification',
      priority: 'pending',
      createdAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      status: 'shown',
      ...overrides,
    }
  }

  test('mounts without errors', () => {
    const wrapper = mount(EmergencyModal, {
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })
    expect(wrapper.exists()).toBe(true)
  })

  test('store getter hasNewNotification is false by default', () => {
    const store = useNotificationStore()
    expect(store.hasNewNotification).toBe(false)
  })

  test('store getter hasNewNotification is true when notification set', () => {
    const store = useNotificationStore()
    store.currentNotification = createMockNotificationState()
    expect(store.hasNewNotification).toBe(true)
  })

  test('unreadCount returns correct count', () => {
    const store = useNotificationStore()
    store.notifications = [
      createMockNotificationState({ id: '1', status: 'shown' }),
      createMockNotificationState({ id: '2', status: 'pending' }),
      createMockNotificationState({ id: '3', status: 'dismissed' }),
    ]
    expect(store.unreadCount).toBe(2)
  })
})
