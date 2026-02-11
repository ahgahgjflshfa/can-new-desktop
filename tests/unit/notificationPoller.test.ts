import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNotificationPoller, type NotificationPollerCallbacks } from '@/services/notificationPoller'
import * as notificationDataSource from '@/services/notificationDataSource'
import type { EmergencyNotification, NotificationApiResponse } from '@/types/notification'

vi.mock('@/services/notificationDataSource', () => ({
  OFFICIAL_SERVER_URL: 'https://www-u.tymetro.com.tw/station_services/api',
  fetchNotifications: vi.fn(),
}))

describe('notificationPoller', () => {
  const mockFetchNotifications = vi.mocked(notificationDataSource.fetchNotifications)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createMockNotification(overrides: Partial<EmergencyNotification> = {}): EmergencyNotification {
    return {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: 'Test Notification',
      body: 'This is a test notification body',
      priority: 'pending',
      createdAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  function createMockResponse(notifications: EmergencyNotification[] = []): NotificationApiResponse {
    return {
      notifications,
      serverTime: new Date().toISOString(),
    }
  }

  describe('start', () => {
    test('polls immediately on start', async () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse())
      const poller = createNotificationPoller({ intervalMs: 10000 })
      const callbacks: NotificationPollerCallbacks = {
        onNewNotifications: vi.fn(),
        onError: vi.fn(),
      }

      poller.start(callbacks)

      await vi.advanceTimersByTimeAsync(0)

      expect(mockFetchNotifications).toHaveBeenCalledTimes(1)

      poller.stop()
    })

    test('polls at configured interval', async () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse())
      const poller = createNotificationPoller({ intervalMs: 5000 })
      const callbacks: NotificationPollerCallbacks = {
        onNewNotifications: vi.fn(),
      }

      poller.start(callbacks)

      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(3)

      poller.stop()
    })

    test('calls onNewNotifications when notifications arrive', async () => {
      const notification = createMockNotification()
      mockFetchNotifications.mockResolvedValue(createMockResponse([notification]))

      const poller = createNotificationPoller()
      const onNewNotifications = vi.fn()

      poller.start({ onNewNotifications })

      await vi.advanceTimersByTimeAsync(0)

      expect(onNewNotifications).toHaveBeenCalledWith([notification])

      poller.stop()
    })

    test('does not call onNewNotifications when no notifications', async () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse([]))

      const poller = createNotificationPoller()
      const onNewNotifications = vi.fn()

      poller.start({ onNewNotifications })

      await vi.advanceTimersByTimeAsync(0)

      expect(onNewNotifications).not.toHaveBeenCalled()

      poller.stop()
    })
  })

  describe('stop', () => {
    test('stops polling', async () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse())
      const poller = createNotificationPoller({ intervalMs: 1000 })
      const callbacks: NotificationPollerCallbacks = {
        onNewNotifications: vi.fn(),
      }

      poller.start(callbacks)
      await vi.advanceTimersByTimeAsync(0)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(1)

      poller.stop()

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(1)
    })

    test('isActive returns false after stop', () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse())
      const poller = createNotificationPoller()
      const callbacks: NotificationPollerCallbacks = {
        onNewNotifications: vi.fn(),
      }

      poller.start(callbacks)
      expect(poller.isActive()).toBe(true)

      poller.stop()
      expect(poller.isActive()).toBe(false)
    })
  })

  describe('error handling', () => {
    test('calls onError when fetch fails', async () => {
      const error = new Error('Network error')
      mockFetchNotifications.mockRejectedValue(error)

      const poller = createNotificationPoller()
      const onError = vi.fn()

      poller.start({
        onNewNotifications: vi.fn(),
        onError,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onError).toHaveBeenCalledWith(error)

      poller.stop()
    })

    test('continues polling after error', async () => {
      mockFetchNotifications.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue(createMockResponse())

      const poller = createNotificationPoller({ intervalMs: 1000 })
      const onError = vi.fn()

      poller.start({
        onNewNotifications: vi.fn(),
        onError,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(onError).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(2)

      poller.stop()
    })
  })

  describe('updateConfig', () => {
    test('restarts with new config when polling', async () => {
      mockFetchNotifications.mockResolvedValue(createMockResponse())
      const poller = createNotificationPoller({ intervalMs: 10000 })
      const callbacks: NotificationPollerCallbacks = {
        onNewNotifications: vi.fn(),
      }

      poller.start(callbacks)
      await vi.advanceTimersByTimeAsync(0)

      poller.updateConfig({ intervalMs: 2000 })

      await vi.advanceTimersByTimeAsync(2000)
      expect(mockFetchNotifications).toHaveBeenCalledTimes(3)

      poller.stop()
    })

    test('getConfig returns current config', () => {
      const poller = createNotificationPoller({ intervalMs: 5000 })

      const config = poller.getConfig()

      expect(config.intervalMs).toBe(5000)
    })
  })
})
