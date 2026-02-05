import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchNotificationsFromMockServer,
  fetchNotifications,
  generateTestNotification,
  resetMockState,
  MOCK_SERVER_URL,
} from '@/services/mockServer'

describe('mockServer', () => {
  beforeEach(() => {
    resetMockState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('fetchNotificationsFromMockServer', () => {
    test('returns NotificationApiResponse structure', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const responsePromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const response = await responsePromise

      expect(response).toHaveProperty('notifications')
      expect(response).toHaveProperty('serverTime')
      expect(Array.isArray(response.notifications)).toBe(true)
      expect(typeof response.serverTime).toBe('string')
    })

    test('may generate notification when random < 0.3 and time threshold passed', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1)
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))

      const responsePromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const response = await responsePromise

      expect(response.notifications.length).toBe(1)

      const notification = response.notifications[0]!
      expect(notification).toHaveProperty('id')
      expect(notification).toHaveProperty('title')
      expect(notification).toHaveProperty('body')
      expect(notification).toHaveProperty('priority')
      expect(notification).toHaveProperty('createdAt')
      expect(notification).toHaveProperty('receivedAt')
    })

    test('does not generate notification when random >= 0.3', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const responsePromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const response = await responsePromise

      expect(response.notifications.length).toBe(0)
    })

    test('respects 5 second cooldown between notifications', async () => {
      const randomMock = vi.spyOn(Math, 'random').mockReturnValue(0.1)
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))

      const firstPromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const firstResponse = await firstPromise

      expect(firstResponse.notifications.length).toBe(1)

      vi.setSystemTime(new Date('2024-01-01T10:00:02Z'))
      randomMock.mockReturnValue(0.1)

      const secondPromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const secondResponse = await secondPromise

      expect(secondResponse.notifications.length).toBe(0)

      vi.setSystemTime(new Date('2024-01-01T10:00:06Z'))
      randomMock.mockReturnValue(0.1)

      const thirdPromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const thirdResponse = await thirdPromise

      expect(thirdResponse.notifications.length).toBe(1)
    })
  })

  describe('fetchNotifications', () => {
    test('calls mock server implementation', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const responsePromise = fetchNotifications(MOCK_SERVER_URL)
      await vi.advanceTimersByTimeAsync(300)
      const response = await responsePromise

      expect(response).toHaveProperty('notifications')
      expect(response).toHaveProperty('serverTime')
    })

    test('accepts custom server URL', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const responsePromise = fetchNotifications('https://custom-server.com/api')
      await vi.advanceTimersByTimeAsync(300)
      const response = await responsePromise

      expect(response).toBeDefined()
    })
  })

  describe('generateTestNotification', () => {
    test('generates notification with specified priority', () => {
      const critical = generateTestNotification('critical')
      expect(critical.priority).toBe('critical')

      const high = generateTestNotification('high')
      expect(high.priority).toBe('high')

      const medium = generateTestNotification('medium')
      expect(medium.priority).toBe('medium')

      const low = generateTestNotification('low')
      expect(low.priority).toBe('low')
    })

    test('generates notification with required fields', () => {
      const notification = generateTestNotification()

      expect(notification.id).toMatch(/^notif_/)
      expect(typeof notification.title).toBe('string')
      expect(typeof notification.body).toBe('string')
      expect(typeof notification.createdAt).toBe('string')
      expect(typeof notification.receivedAt).toBe('string')
      expect(['critical', 'high', 'medium', 'low']).toContain(notification.priority)
    })

    test('generates IDs with expected format', () => {
      const notification = generateTestNotification()
      expect(notification.id).toMatch(/^notif_\d+_[a-z0-9]+$/)
    })
  })

  describe('resetMockState', () => {
    test('resets notification counter and timing', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1)
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))

      const firstPromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const firstResponse = await firstPromise
      const firstTitle = firstResponse.notifications[0]?.title

      resetMockState()

      vi.setSystemTime(new Date('2024-01-01T10:00:10Z'))
      const secondPromise = fetchNotificationsFromMockServer()
      await vi.advanceTimersByTimeAsync(300)
      const secondResponse = await secondPromise
      const secondTitle = secondResponse.notifications[0]?.title

      expect(firstTitle).toBe(secondTitle)
    })
  })
})
