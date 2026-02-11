import { invoke } from '@tauri-apps/api/core'
import { getApiAuthToken } from '@/services/apiClient'
import type { EmergencyNotification, NotificationApiResponse, NotificationPriority } from '@/types/notification'

export const OFFICIAL_SERVER_URL = 'https://www-u.tymetro.com.tw/station_services/api'

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
    return new Date().toISOString()
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

function createServerNotificationDataSource(): NotificationDataSource {
  return {
    async fetchNotifications(_serverUrl?: string, _lastSyncTime?: string) {
      const token = getApiAuthToken()
      if (!token) {
        throw new Error('Missing authentication token')
      }

      const tasks = await invoke<TaskItem[]>('fetch_tasks', { token })
      return {
        notifications: tasks.map(mapTaskToNotification),
        serverTime: new Date().toISOString(),
      }
    },
  }
}

function createMockNotificationDataSource(): NotificationDataSource {
  return {
    async fetchNotifications() {
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
  if (mode === 'mock') {
    return createMockNotificationDataSource()
  }
  return createServerNotificationDataSource()
}

const dataSource = createNotificationDataSource(getSourceMode())

export async function fetchNotifications(serverUrl?: string, lastSyncTime?: string): Promise<NotificationApiResponse> {
  return dataSource.fetchNotifications(serverUrl, lastSyncTime)
}
