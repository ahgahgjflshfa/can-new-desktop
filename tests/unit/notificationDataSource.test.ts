import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchNotifications } from '@/services/notificationDataSource'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'
const AUTH_STORAGE_KEY = 'tauri-app:auth'

describe('notificationDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    localStorage.setItem(LMA_AUTH_STORAGE_KEY, JSON.stringify({ token: 'lma-test-token' }))
  })

  afterEach(() => {
    localStorage.removeItem(LMA_AUTH_STORAGE_KEY)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    vi.unstubAllGlobals()
  })


  test('does not map missing task timestamps to current time', async () => {
    invokeMock.mockResolvedValue([
      {
        id: 1,
        station_id: 'A1',
        station_name: 'Station',
        location_name: 'Gate',
        location_code: 'G1',
        status: 'pending',
        created_at: 0,
        replied_at: null,
        done_at: null,
      },
    ])

    const response = await fetchNotifications()

    expect(response.notifications[0]?.createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(response.notifications[0]?.receivedAt).toBe('1970-01-01T00:00:00.000Z')
  })

  test('falls back to the legacy auth storage key when fetching LMA tasks', async () => {
    localStorage.removeItem(LMA_AUTH_STORAGE_KEY)
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: 'legacy-lma-token' }))
    invokeMock.mockResolvedValue([])

    await fetchNotifications()

    expect(invokeMock).toHaveBeenCalledWith('fetch_tasks', { token: 'legacy-lma-token' })
  })
})
