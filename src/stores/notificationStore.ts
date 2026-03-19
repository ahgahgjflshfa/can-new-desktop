import { defineStore } from 'pinia'
import type { EmergencyNotification, NotificationState, NotificationPriority } from '@/types/notification'
import { getNotificationPoller, convertToNotificationState, type PollingStats } from '@/services/notificationPoller'
import { completeTask, replyTask, type CompletionResult } from '@/services/taskActionService'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauriRuntime } from '@/tauri/window'

const NOTIFICATION_STORAGE_KEY = 'tauri-app:notifications'
const SETTINGS_STORAGE_KEY = 'tauri-app:notification-settings'
const MAX_STORED_NOTIFICATIONS = 100
const DEFAULT_POLLING_INTERVAL = 10000
const IN_APP_REMINDER_MS = 4000
const REPLIED_ESCALATION_MS = 15 * 60 * 1000

let _dismissEventUnlisten: UnlistenFn | null = null
let _popupClosedUnlisten: UnlistenFn | null = null
let inAppReminderTimeoutId: ReturnType<typeof setTimeout> | null = null

function clearInAppReminderTimeout(): void {
  if (inAppReminderTimeoutId !== null) {
    clearTimeout(inAppReminderTimeoutId)
    inAppReminderTimeoutId = null
  }
}

function isMainWindowActive(): boolean {
  if (typeof document === 'undefined') return false

  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true
  return document.visibilityState === 'visible' && hasFocus
}

interface DismissPayload {
  notificationId: string | null
  dismissAll: boolean
}

function normalizePriority(value: unknown): NotificationPriority {
  if (value === 'pending' || value === 'replied' || value === 'completed' || value === 'ignored') {
    return value
  }

  if (value === 'critical') return 'pending'
  if (value === 'high') return 'replied'
  if (value === 'medium') return 'completed'
  if (value === 'low') return 'ignored'

  return 'pending'
}

function normalizeNotificationStatus(value: unknown): NotificationState['status'] {
  if (value === 'pending' || value === 'shown' || value === 'dismissed') {
    return value
  }
  return 'pending'
}

function normalizeStoredNotification(input: unknown): NotificationState | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Partial<NotificationState>

  if (typeof record.id !== 'string' || record.id.length === 0) return null
  if (typeof record.title !== 'string') return null
  if (typeof record.body !== 'string') return null
  if (typeof record.createdAt !== 'string') return null
  if (typeof record.receivedAt !== 'string') return null

  return {
    id: record.id,
    title: record.title,
    body: record.body,
    priority: normalizePriority(record.priority),
    createdAt: record.createdAt,
    receivedAt: record.receivedAt,
    status: normalizeNotificationStatus(record.status),
    dismissedAt: typeof record.dismissedAt === 'string' ? record.dismissedAt : undefined,
    repliedAt: typeof record.repliedAt === 'string' ? record.repliedAt : undefined,
    category: typeof record.category === 'string' ? record.category : undefined,
    actionUrl: typeof record.actionUrl === 'string' ? record.actionUrl : undefined,
    metadata:
      record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : undefined,
  }
}

export const useNotificationStore = defineStore('notifications', {
  state: () => ({
    notifications: [] as NotificationState[],
    currentNotification: null as NotificationState | null,
    isPolling: false,
    lastError: null as string | null,
    pollingEnabled: true,
    pollingIntervalMs: DEFAULT_POLLING_INTERVAL,
    pollingStats: {
      lastPollTime: null as Date | null,
      nextPollTime: null as Date | null,
      pollCount: 0,
      successCount: 0,
      errorCount: 0,
      lastError: null as string | null,
      isConnected: false,
    } as PollingStats,
    isTaskActionPending: false,
    taskActionError: null as string | null,
    inAppReminderVisible: false,
    inAppReminderCount: 0,
  }),

  getters: {
    pendingNotifications: state => state.notifications.filter(n => n.status === 'pending'),

    shownNotifications: state => state.notifications.filter(n => n.status === 'shown'),

    dismissedNotifications: state => state.notifications.filter(n => n.status === 'dismissed'),

    hasNewNotification: state => state.currentNotification !== null,

    notificationCount: state => state.notifications.length,

    unreadCount: state => state.notifications.filter(n => n.status !== 'dismissed').length,

    alertsToday: state => {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      return state.notifications.filter(n => new Date(n.receivedAt) >= todayStart).length
    },

    alertsThisWeek: state => {
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 7)
      weekStart.setHours(0, 0, 0, 0)
      return state.notifications.filter(n => new Date(n.receivedAt) >= weekStart).length
    },

    countByPriority: state => {
      const counts: Record<NotificationPriority, number> = {
        pending: 0,
        replied: 0,
        completed: 0,
        ignored: 0,
      }
      for (const n of state.notifications) {
        if (n.status !== 'dismissed') {
          counts[n.priority]++
        }
      }
      return counts
    },

    recentNotifications: state => {
      return state.notifications.slice(0, 10)
    },

    pendingAlertCount: state => {
      return state.notifications.filter(n => n.priority === 'pending' && n.status !== 'dismissed').length
    },

    pollingIntervalSeconds: state => {
      return state.pollingIntervalMs / 1000
    },
  },

  actions: {
    async init() {
      this.loadFromStorage()
      await this.setupDismissListener()
      if (this.pollingEnabled) {
        this.startPolling()
      }
    },

    isTaskUnresolved(notification: NotificationState) {
      return notification.priority === 'pending' || notification.priority === 'replied'
    },

    getUnresolvedNotifications() {
      return this.notifications.filter(
        notification => notification.status !== 'dismissed' && this.isTaskUnresolved(notification)
      )
    },

    isRepliedEscalated(notification: NotificationState) {
      if (notification.priority !== 'replied') return false

      const repliedAtMs = notification.repliedAt ? new Date(notification.repliedAt).getTime() : Number.NaN
      if (!Number.isFinite(repliedAtMs)) return false

      return Date.now() - repliedAtMs >= REPLIED_ESCALATION_MS
    },

    showInAppReminder(count: number) {
      this.inAppReminderVisible = true
      this.inAppReminderCount = count

      clearInAppReminderTimeout()
      inAppReminderTimeoutId = setTimeout(() => {
        this.inAppReminderVisible = false
      }, IN_APP_REMINDER_MS)
    },

    hideInAppReminder() {
      this.inAppReminderVisible = false
      clearInAppReminderTimeout()
    },

    clearReminderSignals() {
      this.hideInAppReminder()
    },

    updateExistingNotification(existing: NotificationState, incoming: EmergencyNotification) {
      const previousPriority = existing.priority

      existing.title = incoming.title
      existing.body = incoming.body
      existing.priority = incoming.priority
      existing.category = incoming.category
      existing.createdAt = incoming.createdAt
      existing.receivedAt = incoming.receivedAt
      existing.metadata = incoming.metadata

      if (incoming.priority === 'replied') {
        if (previousPriority !== 'replied' || !existing.repliedAt) {
          existing.repliedAt = new Date().toISOString()
        }
      } else {
        existing.repliedAt = undefined
      }

      if (existing.status === 'dismissed' && this.isTaskUnresolved(existing)) {
        existing.status = 'pending'
        existing.dismissedAt = undefined
      }
    },

    getReminderTarget(unresolved: NotificationState[]): NotificationState | null {
      if (unresolved.length === 0) return null

      const current = this.currentNotification
      if (current && unresolved.some(notification => notification.id === current.id)) {
        return current
      }

      return unresolved[0] ?? null
    },

    getReminderCandidates() {
      const pending = this.notifications.filter(
        notification => notification.status !== 'dismissed' && notification.priority === 'pending'
      )
      if (pending.length > 0) {
        return pending
      }

      return this.notifications.filter(
        notification => notification.status !== 'dismissed' && this.isRepliedEscalated(notification)
      )
    },

    getNextPendingNotification() {
      return this.notifications.find(notification => notification.status === 'pending') ?? null
    },

    async runReminderCycle() {
      const candidates = this.getReminderCandidates()
      const target = this.getReminderTarget(candidates)
      if (!target) {
        this.clearReminderSignals()
        await this.hidePopup()
        return
      }

      if (isMainWindowActive()) {
        await this.hidePopup()
        this.showInAppReminder(candidates.length)
        this.currentNotification = target
        return
      }

      this.hideInAppReminder()
      await this.showNotification(target.id)
    },

    async setupDismissListener() {
      if (!isTauriRuntime()) return
      if (_dismissEventUnlisten) return

      try {
        _dismissEventUnlisten = await listen<DismissPayload>('dismiss-notification', event => {
          if (event.payload.dismissAll) {
            this.dismissAllNotificationsInternal()
          } else if (event.payload.notificationId) {
            this.dismissNotificationById(event.payload.notificationId)
          }
        })

        _popupClosedUnlisten = await listen('popup-closed', () => {})
      } catch (err) {
        console.warn('Failed to setup dismiss listener:', err)
      }
    },

    startPolling() {
      const poller = getNotificationPoller()

      poller.updateConfig({ intervalMs: this.pollingIntervalMs })

      poller.start({
        onNewNotifications: (newNotifications: EmergencyNotification[]) => {
          this.handleNewNotifications(newNotifications)
        },
        onError: (error: Error) => {
          this.lastError = error.message
          console.error('Notification polling error:', error)
        },
        onPollComplete: (stats: PollingStats) => {
          this.pollingStats = stats
        },
      })

      this.isPolling = true
    },

    stopPolling() {
      const poller = getNotificationPoller()
      poller.stop()
      this.isPolling = false
    },

    handleNewNotifications(newNotifications: EmergencyNotification[]) {
      for (const notification of newNotifications) {
        const existingIndex = this.notifications.findIndex(n => n.id === notification.id)
        if (existingIndex !== -1) {
          const existing = this.notifications[existingIndex]
          if (existing) {
            this.updateExistingNotification(existing, notification)
          }
          continue
        }

        const notificationState = convertToNotificationState(notification)
        if (notificationState.priority === 'replied') {
          notificationState.repliedAt = new Date().toISOString()
        }
        this.notifications.unshift(notificationState)

        if (!this.currentNotification) {
          this.showNotification(notificationState.id)
        }
      }

      void this.runReminderCycle().catch(err => {
        console.warn('Reminder cycle failed:', err)
      })

      this.pruneOldNotifications()
      this.saveToStorage()
    },

    async showNotification(notificationId: string) {
      const notification = this.notifications.find(n => n.id === notificationId)
      if (!notification) return

      notification.status = 'shown'
      this.currentNotification = notification

      if (isTauriRuntime()) {
        try {
          await invoke('show_alert_popup', {
            notification: {
              id: notification.id,
              title: notification.title,
              body: notification.body,
              priority: notification.priority,
              category: notification.category,
              createdAt: notification.createdAt,
              unreadCount: this.unreadCount,
            },
          })
        } catch (err) {
          console.warn('Failed to show alert popup:', err)
        }
      }
    },

    setTaskStatus(notificationId: string, priority: NotificationPriority) {
      const notification = this.notifications.find(n => n.id === notificationId)
      if (!notification) return

      const previousPriority = notification.priority

      notification.priority = priority
      notification.category = priority

      if (priority === 'replied') {
        if (previousPriority !== 'replied') {
          notification.repliedAt = new Date().toISOString()
        }
      } else {
        notification.repliedAt = undefined
      }

      if (this.currentNotification?.id === notificationId) {
        this.currentNotification.priority = priority
        this.currentNotification.category = priority
        this.currentNotification.repliedAt = notification.repliedAt
      }
    },

    getTaskId(notificationId: string): number | null {
      const taskId = Number(notificationId)
      return Number.isFinite(taskId) ? taskId : null
    },

    async replyTaskById(notificationId: string) {
      const taskId = this.getTaskId(notificationId)
      if (taskId === null) {
        this.taskActionError = 'Invalid task id'
        return
      }

      this.isTaskActionPending = true
      this.taskActionError = null

      try {
        const status = await replyTask(taskId)
        if (status === 'replied' || status === 'completed' || status === 'ignored' || status === 'pending') {
          this.setTaskStatus(notificationId, status)
        } else {
          this.setTaskStatus(notificationId, 'replied')
        }
        this.saveToStorage()
      } catch (err) {
        this.taskActionError = err instanceof Error ? err.message : String(err)
      } finally {
        this.isTaskActionPending = false
      }
    },

    async completeTaskById(notificationId: string, result: CompletionResult) {
      const taskId = this.getTaskId(notificationId)
      if (taskId === null) {
        this.taskActionError = 'Invalid task id'
        return
      }

      this.isTaskActionPending = true
      this.taskActionError = null

      try {
        await completeTask(taskId, result)
        this.setTaskStatus(notificationId, 'completed')
        this.dismissNotificationById(notificationId)
      } catch (err) {
        this.taskActionError = err instanceof Error ? err.message : String(err)
      } finally {
        this.isTaskActionPending = false
      }
    },

    async replyCurrentTask() {
      if (!this.currentNotification) return
      await this.replyTaskById(this.currentNotification.id)
    },

    async completeCurrentTask(result: CompletionResult) {
      if (!this.currentNotification) return
      await this.completeTaskById(this.currentNotification.id, result)
    },

    dismissNotificationById(notificationId: string) {
      const notification = this.notifications.find(n => n.id === notificationId)
      if (notification) {
        notification.status = 'dismissed'
        notification.dismissedAt = new Date().toISOString()
      }

      if (this.currentNotification?.id === notificationId) {
        this.currentNotification = null

        const nextPending = this.getNextPendingNotification()
        if (nextPending) {
          this.showNotification(nextPending.id)
        } else {
          this.hidePopup()
        }
      }

      this.saveToStorage()
    },

    async dismissCurrentNotification() {
      if (!this.currentNotification) return
      this.dismissNotificationById(this.currentNotification.id)
    },

    dismissAllNotificationsInternal() {
      const now = new Date().toISOString()
      for (const notification of this.notifications) {
        if (notification.status !== 'dismissed') {
          notification.status = 'dismissed'
          notification.dismissedAt = now
        }
      }
      this.currentNotification = null
      this.hideInAppReminder()
      this.hidePopup()
      this.saveToStorage()
    },

    async dismissAllNotifications() {
      this.dismissAllNotificationsInternal()
    },

    async hidePopup() {
      if (isTauriRuntime()) {
        try {
          await invoke('hide_alert_popup')
        } catch (err) {
          console.warn('Failed to hide alert popup:', err)
        }
      }
    },

    clearHistory() {
      this.notifications = this.notifications.filter(n => n.status !== 'dismissed')
      this.saveToStorage()
    },

    deleteNotification(notificationId: string) {
      const index = this.notifications.findIndex(n => n.id === notificationId)
      if (index !== -1) {
        if (this.currentNotification?.id === notificationId) {
          this.currentNotification = null
        }
        this.notifications.splice(index, 1)
        this.saveToStorage()
      }
    },

    pruneOldNotifications() {
      if (this.notifications.length > MAX_STORED_NOTIFICATIONS) {
        const dismissedToRemove = this.notifications
          .filter(n => n.status === 'dismissed')
          .slice(MAX_STORED_NOTIFICATIONS / 2)

        for (const notification of dismissedToRemove) {
          const index = this.notifications.findIndex(n => n.id === notification.id)
          if (index !== -1) {
            this.notifications.splice(index, 1)
          }
        }
      }
    },

    setPollingEnabled(enabled: boolean) {
      this.pollingEnabled = enabled
      if (enabled && !this.isPolling) {
        this.startPolling()
      } else if (!enabled && this.isPolling) {
        this.stopPolling()
      }
      this.saveSettings()
    },

    setPollingInterval(seconds: number) {
      const clampedSeconds = Math.max(5, Math.min(300, seconds))
      this.pollingIntervalMs = clampedSeconds * 1000

      const poller = getNotificationPoller()
      poller.updateConfig({ intervalMs: this.pollingIntervalMs })

      this.saveSettings()
    },

    loadFromStorage() {
      if (typeof localStorage === 'undefined') return

      const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            this.notifications = parsed
              .map(normalizeStoredNotification)
              .filter((item): item is NotificationState => item !== null)
          }
        } catch (err) {
          console.warn('Failed to parse stored notifications:', err)
        }
      }

      const settingsRaw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (settingsRaw) {
        try {
          const settings = JSON.parse(settingsRaw) as { pollingEnabled?: boolean; pollingIntervalMs?: number }
          if (typeof settings.pollingEnabled === 'boolean') {
            this.pollingEnabled = settings.pollingEnabled
          }
          if (typeof settings.pollingIntervalMs === 'number') {
            this.pollingIntervalMs = settings.pollingIntervalMs
          }
        } catch (err) {
          console.warn('Failed to parse stored settings:', err)
        }
      }
    },

    saveToStorage() {
      if (typeof localStorage === 'undefined') return

      try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(this.notifications))
      } catch (err) {
        console.warn('Failed to save notifications:', err)
      }
    },

    saveSettings() {
      if (typeof localStorage === 'undefined') return

      try {
        localStorage.setItem(
          SETTINGS_STORAGE_KEY,
          JSON.stringify({
            pollingEnabled: this.pollingEnabled,
            pollingIntervalMs: this.pollingIntervalMs,
          })
        )
      } catch (err) {
        console.warn('Failed to save settings:', err)
      }
    },
  },
})
