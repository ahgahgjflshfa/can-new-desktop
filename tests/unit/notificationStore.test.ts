import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotificationStore } from '@/stores/notificationStore'
import type { EmergencyNotification } from '@/types/notification'

// Create a shared mock poller instance that persists across calls
const mockPoller = {
  start: vi.fn(),
  stop: vi.fn(),
  isActive: vi.fn(() => false),
  updateConfig: vi.fn(),
  getConfig: vi.fn(() => ({ serverUrl: 'mock', intervalMs: 10000 })),
  getStats: vi.fn(() => ({
    lastPollTime: null,
    nextPollTime: null,
    pollCount: 0,
    successCount: 0,
    errorCount: 0,
    lastError: null,
    isConnected: false,
  })),
}

vi.mock('@/services/notificationPoller', () => ({
  getNotificationPoller: vi.fn(() => mockPoller),
  convertToNotificationState: vi.fn((notification: EmergencyNotification) => ({
    ...notification,
    status: 'pending',
  })),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@/tauri/window', () => ({
  isTauriRuntime: vi.fn(() => false),
}))

describe('notificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Mock localStorage
    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key]
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(storage)) {
          delete storage[key]
        }
      }),
    })
  })

  function createMockNotification(overrides: Partial<EmergencyNotification> = {}): EmergencyNotification {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    return {
      id,
      title: 'Test Alert',
      body: 'Test notification body',
      priority: 'pending',
      createdAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  function storeLmaAuthToken() {
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token' }))
  }

  describe('init', () => {
    test('starts polling by default when lma is logged in', async () => {
      storeLmaAuthToken()
      const store = useNotificationStore()

      await store.init()

      expect(mockPoller.start).toHaveBeenCalled()
      expect(store.isPolling).toBe(true)
    })

    test('does not start polling before lma login', async () => {
      const store = useNotificationStore()

      await store.init()

      expect(mockPoller.start).not.toHaveBeenCalled()
      expect(store.isPolling).toBe(false)
      expect(store.lastError).toBeNull()
    })

    test('clamps invalid persisted polling interval', async () => {
      storeLmaAuthToken()
      localStorage.setItem(
        'tauri-app:notification-settings',
        JSON.stringify({ pollingEnabled: true, pollingIntervalMs: 0 })
      )
      const store = useNotificationStore()

      await store.init()

      expect(store.pollingIntervalMs).toBe(5000)
      expect(mockPoller.updateConfig).toHaveBeenCalledWith({ intervalMs: 5000 })
    })
  })

  describe('handleNewNotifications', () => {
    test('adds new notifications to the list', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])

      expect(store.notifications.length).toBe(1)
      expect(store.notifications[0]!.title).toBe(notification.title)
    })

    test('does not add duplicate notifications', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])
      store.handleNewNotifications([notification])

      expect(store.notifications.length).toBe(1)
    })

    test('shows first notification automatically', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])

      expect(store.currentNotification).not.toBeNull()
      expect(store.currentNotification?.id).toBe(notification.id)
    })

    test('queues subsequent notifications', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: 'first' })
      const second = createMockNotification({ id: 'second' })

      store.handleNewNotifications([first, second])

      expect(store.currentNotification?.id).toBe('first')
      expect(store.notifications.length).toBe(2)
    })

    test('dismisses current notification when polling reports it completed remotely', () => {
      const store = useNotificationStore()
      const notification = createMockNotification({ id: '1', priority: 'pending' })

      store.handleNewNotifications([notification])
      store.handleNewNotifications([{ ...notification, priority: 'completed', category: 'completed' }])

      expect(store.currentNotification).toBeNull()
      expect(store.notifications[0]!.priority).toBe('completed')
      expect(store.notifications[0]!.status).toBe('dismissed')
      expect(store.notifications[0]!.dismissedAt).toBeDefined()
    })

    test('does not create a new local notification for already completed remote tasks', () => {
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: '1', priority: 'completed' })])

      expect(store.notifications).toHaveLength(0)
      expect(store.currentNotification).toBeNull()
    })

    test('dismisses unresolved local notifications missing from a full polling result', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1', priority: 'pending' })
      const second = createMockNotification({ id: '2', priority: 'pending' })

      store.handleNewNotifications([first, second])
      store.handleNewNotifications([second])

      const missing = store.notifications.find(notification => notification.id === '1')
      expect(missing?.status).toBe('dismissed')
      expect(missing?.dismissedAt).toBeDefined()
      expect(store.currentNotification?.id).toBe('2')
    })
  })

  describe('dismissCurrentNotification', () => {
    test('marks current notification as dismissed', async () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      await store.dismissCurrentNotification()

      expect(store.currentNotification).toBeNull()
      expect(store.notifications[0]!.status).toBe('dismissed')
      expect(store.notifications[0]!.dismissedAt).toBeDefined()
    })

    test('shows next pending notification', async () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: 'first' })
      const second = createMockNotification({ id: 'second' })

      store.handleNewNotifications([first, second])

      await store.dismissCurrentNotification()

      expect(store.currentNotification?.id).toBe('second')
    })
  })

  describe('dismissAllNotifications', () => {
    test('dismisses all notifications', () => {
      const store = useNotificationStore()
      store.handleNewNotifications([
        createMockNotification({ id: '1' }),
        createMockNotification({ id: '2' }),
        createMockNotification({ id: '3' }),
      ])

      store.dismissAllNotifications()

      expect(store.currentNotification).toBeNull()
      expect(store.notifications.every(n => n.status === 'dismissed')).toBe(true)
    })
  })

  describe('deleteNotification', () => {
    test('removes notification from list', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      store.deleteNotification(notification.id)

      expect(store.notifications.length).toBe(0)
    })

    test('clears current notification if deleted', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      store.deleteNotification(notification.id)

      expect(store.currentNotification).toBeNull()
    })
  })

  describe('clearHistory', () => {
    test('removes only dismissed notifications', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes 'shown', '2' stays pending

      // Find and dismiss notification '2' (which is at index 0 due to unshift)
      const notif2 = store.notifications.find(n => n.id === '2')
      if (notif2) notif2.status = 'dismissed'

      store.clearHistory()

      // Should keep '1' (shown) and remove '2' (dismissed)
      expect(store.notifications.length).toBe(1)
      expect(store.notifications[0]!.id).toBe('1')
    })
  })

  describe('getters', () => {
    test('pendingNotifications returns only pending', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes shown, '2' stays pending

      // '1' is shown, '2' is pending
      expect(store.pendingNotifications.length).toBe(1)
      expect(store.pendingNotifications[0]!.id).toBe('2')
    })

    test('dismissedNotifications returns only dismissed', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes shown, '2' stays pending

      // Dismiss the first one (which is 'shown')
      const notif1 = store.notifications.find(n => n.id === '1')
      if (notif1) notif1.status = 'dismissed'

      expect(store.dismissedNotifications.length).toBe(1)
      expect(store.dismissedNotifications[0]!.id).toBe('1')
    })

    test('hasNewNotification returns true when current exists', () => {
      const store = useNotificationStore()

      expect(store.hasNewNotification).toBe(false)

      store.handleNewNotifications([createMockNotification()])

      expect(store.hasNewNotification).toBe(true)
    })

    test('unreadCount returns non-dismissed count', () => {
      const store = useNotificationStore()
      store.handleNewNotifications([
        createMockNotification({ id: '1' }),
        createMockNotification({ id: '2' }),
        createMockNotification({ id: '3' }),
      ])

      // Dismiss one notification
      const notif1 = store.notifications.find(n => n.id === '1')
      if (notif1) notif1.status = 'dismissed'

      expect(store.unreadCount).toBe(2)
    })
  })

  describe('setPollingEnabled', () => {
    test('starts polling when enabled and lma is logged in', () => {
      storeLmaAuthToken()
      const store = useNotificationStore()

      store.setPollingEnabled(true)

      expect(mockPoller.start).toHaveBeenCalled()
    })

    test('does not start polling when enabled before lma login', () => {
      const store = useNotificationStore()

      store.setPollingEnabled(true)

      expect(mockPoller.start).not.toHaveBeenCalled()
      expect(store.isPolling).toBe(false)
      expect(store.lastError).toBeNull()
    })

    test('stops polling when disabled', () => {
      const store = useNotificationStore()

      store.isPolling = true
      store.setPollingEnabled(false)

      expect(mockPoller.stop).toHaveBeenCalled()
    })
  })
})
