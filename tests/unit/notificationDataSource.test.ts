import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchNotifications } from '@/services/notificationDataSource'

const invokeMock = vi.hoisted(() => vi.fn())
const getApiAuthTokenMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@/services/apiClient', () => ({
  getApiAuthToken: getApiAuthTokenMock,
}))

describe('notificationDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApiAuthTokenMock.mockReturnValue('token')
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
})
