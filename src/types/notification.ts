export type NotificationPriority = 'pending' | 'replied' | 'completed' | 'ignored'

export type NotificationStatus = 'pending' | 'shown' | 'dismissed'

export interface EmergencyNotification {
  id: string
  title: string
  body: string
  priority: NotificationPriority
  createdAt: string
  receivedAt: string
  category?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
}

export interface NotificationState extends EmergencyNotification {
  status: NotificationStatus
  dismissedAt?: string
}

export interface NotificationApiResponse {
  notifications: EmergencyNotification[]
  serverTime: string
  nextPollHint?: number
}
