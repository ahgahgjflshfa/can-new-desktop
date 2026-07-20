import { describe, expect, test, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import NotificationsView from '@/components/NotificationsView.vue'

const notificationState = {
  notifications: [
    { id: 'lma', title: 'LMA visible', body: 'lma body', priority: 'pending', status: 'pending', createdAt: '2026-01-01', metadata: { system: 'lma' } },
    { id: 'charge', title: 'Charge hidden', body: 'charge body', priority: 'pending', status: 'pending', createdAt: '2026-01-01', metadata: { system: 'charge' } },
  ],
  dismissedNotifications: [], isPolling: false, taskActionError: null, isTaskActionPending: false, unreadCount: 1,
  manualRefresh: vi.fn(), deleteNotification: vi.fn(), clearHistory: vi.fn(), replyTaskById: vi.fn(), completeTaskById: vi.fn(),
}

vi.mock('@/stores/notificationStore', () => ({ useNotificationStore: () => notificationState }))

describe('NotificationsView source filtering', () => {
  test('excludes charge notifications from the LMA list', () => {
    const wrapper = shallowMount(NotificationsView, {
      global: { stubs: { SystemSettingsPanel: true } },
    })
    expect(wrapper.text()).toContain('LMA visible')
    expect(wrapper.text()).not.toContain('Charge hidden')
  })
})
