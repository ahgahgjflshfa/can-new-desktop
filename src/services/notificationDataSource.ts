import { invoke } from '@tauri-apps/api/core'
import { getApiAuthToken } from '@/services/apiClient'
import { logAppEvent } from '@/services/appLogger'
import type { EmergencyNotification, NotificationApiResponse, NotificationPriority } from '@/types/notification'

export const OFFICIAL_SERVER_URL = 'https://www-u.tymetro.com.tw/station_services/api'
const LOG_SOURCE = 'notification-data-source'
const MISSING_TIMESTAMP_ISO = new Date(0).toISOString()

type NotificationSourceMode = 'server' | 'mock'

interface NotificationDataSource {
  fetchNotifications: (serverUrl?: string, lastSyncTime?: string) => Promise<NotificationApiResponse>
}

interface TaskItem {
  id: number
  station_id: string
  station_name: string
  location_name: string
  location_code: string
  status: NotificationPriority
  created_at: number | null
  replied_at: number | null
  done_at: number | null
}

function timestampToIso(value: number | null): string {
  if (!value || value <= 0) {
    return MISSING_TIMESTAMP_ISO
  }
  return new Date(value).toISOString()
}

function mapTaskToNotification(task: TaskItem): EmergencyNotification {
  return {
    id: String(task.id),
    title: `${task.station_name} ${task.location_name}`,
    body: `Task #${task.id} (${task.location_code})`,
    priority: task.status,
    category: task.status,
    createdAt: timestampToIso(task.created_at),
    receivedAt: timestampToIso(task.created_at),
    metadata: {
      stationId: task.station_id,
      locationCode: task.location_code,
      repliedAt: task.replied_at,
      doneAt: task.done_at,
    },
  }
}

const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'

function getLmaAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(LMA_AUTH_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed?.token === 'string' ? parsed.token : null
  } catch {
    return null
  }
}

function createServerNotificationDataSource(): NotificationDataSource {
  return {
    async fetchNotifications(serverUrl?: string, lastSyncTime?: string) {
      const token = getLmaAuthToken()
      if (!token) {
        logAppEvent('error', LOG_SOURCE, 'Cannot fetch notifications because LMA auth token is missing')
        throw new Error('Missing authentication token')
      }

      logAppEvent('info', LOG_SOURCE, 'Fetching notifications from backend task command', {
        serverUrl,
        lastSyncTime,
      })

      try {
        const tasks = await invoke<TaskItem[]>('fetch_tasks', { token })
        const response = {
          notifications: tasks.map(mapTaskToNotification),
          serverTime: new Date().toISOString(),
        }

        logAppEvent('info', LOG_SOURCE, 'Fetched notifications from backend task command', {
          taskCount: tasks.length,
          serverTime: response.serverTime,
        })

        return response
      } catch (error) {
        logAppEvent('error', LOG_SOURCE, 'Failed to fetch notifications from backend task command', error)
        throw error
      }
    },
  }
}

function createMockNotificationDataSource(): NotificationDataSource {
  return {
    async fetchNotifications() {
      logAppEvent('info', LOG_SOURCE, 'Returning mock notification payload')
      return {
        notifications: [],
        serverTime: new Date().toISOString(),
      }
    },
  }
}

function getSourceMode(): NotificationSourceMode {
  const mode = import.meta.env.VITE_NOTIFICATION_DATA_SOURCE
  if (mode === 'mock') return 'mock'
  return 'server'
}

function createNotificationDataSource(mode: NotificationSourceMode): NotificationDataSource {
  logAppEvent('info', LOG_SOURCE, 'Creating notification data source', { mode })
  if (mode === 'mock') {
    return createMockNotificationDataSource()
  }
  return createServerNotificationDataSource()
}

const dataSource = createNotificationDataSource(getSourceMode())

export async function fetchNotifications(serverUrl?: string, lastSyncTime?: string): Promise<NotificationApiResponse> {
  return dataSource.fetchNotifications(serverUrl, lastSyncTime)
}
