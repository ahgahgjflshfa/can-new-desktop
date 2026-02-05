import type { EmergencyNotification, NotificationApiResponse, NotificationPriority } from '@/types/notification'

export const MOCK_SERVER_URL = 'https://mock-emergency-server.example.com/api/notifications'

const MOCK_SCENARIOS: Array<{
  title: string
  body: string
  priority: NotificationPriority
  category: string
}> = [
  {
    title: 'Server Outage Detected',
    body: 'Production server cluster-01 is experiencing downtime. All engineers should check their on-call status immediately.',
    priority: 'critical',
    category: 'infrastructure',
  },
  {
    title: 'Security Alert',
    body: 'Unusual login activity detected from IP 192.168.1.100. Please verify if this is authorized access.',
    priority: 'high',
    category: 'security',
  },
  {
    title: 'Database Performance Warning',
    body: 'Query execution times have increased by 300% in the last 15 minutes. Investigation recommended.',
    priority: 'medium',
    category: 'performance',
  },
  {
    title: 'Scheduled Maintenance Reminder',
    body: 'System maintenance window begins in 30 minutes. Please save all work and prepare for brief downtime.',
    priority: 'low',
    category: 'maintenance',
  },
  {
    title: 'Critical: Payment System Failure',
    body: 'Payment processing service is returning errors. Customer transactions are failing. Immediate action required!',
    priority: 'critical',
    category: 'payments',
  },
  {
    title: 'API Rate Limit Exceeded',
    body: 'Third-party API rate limits have been reached. Some features may be degraded until limits reset.',
    priority: 'high',
    category: 'integration',
  },
]

let mockNotificationCounter = 0
let lastGeneratedTime = 0

function generateNotificationId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export async function fetchNotificationsFromMockServer(_lastSyncTime?: string): Promise<NotificationApiResponse> {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200))

  const now = Date.now()
  const notifications: EmergencyNotification[] = []

  const shouldGenerate = Math.random() < 0.3 && now - lastGeneratedTime > 5000

  if (shouldGenerate) {
    lastGeneratedTime = now
    const scenarioIndex = mockNotificationCounter % MOCK_SCENARIOS.length
    const scenario = MOCK_SCENARIOS[scenarioIndex]!
    mockNotificationCounter++

    notifications.push({
      id: generateNotificationId(),
      title: scenario.title,
      body: scenario.body,
      priority: scenario.priority,
      category: scenario.category,
      createdAt: new Date(now).toISOString(),
      receivedAt: new Date(now).toISOString(),
    })
  }

  return {
    notifications,
    serverTime: new Date(now).toISOString(),
  }
}

export async function fetchNotifications(
  serverUrl: string = MOCK_SERVER_URL,
  lastSyncTime?: string
): Promise<NotificationApiResponse> {
  void serverUrl
  return fetchNotificationsFromMockServer(lastSyncTime)
}

export function generateTestNotification(priority: NotificationPriority = 'high'): EmergencyNotification {
  const foundScenario = MOCK_SCENARIOS.find(s => s.priority === priority)
  const scenario = foundScenario ?? MOCK_SCENARIOS[0]!
  const now = Date.now()

  return {
    id: generateNotificationId(),
    title: scenario.title,
    body: scenario.body,
    priority: scenario.priority,
    category: scenario.category,
    createdAt: new Date(now).toISOString(),
    receivedAt: new Date(now).toISOString(),
  }
}

export function resetMockState(): void {
  mockNotificationCounter = 0
  lastGeneratedTime = 0
}
