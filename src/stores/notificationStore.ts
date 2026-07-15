import { defineStore } from 'pinia'
import type { EmergencyNotification, NotificationState, NotificationPriority } from '@/types/notification'
import { getNotificationPoller, convertToNotificationState, type PollingStats } from '@/services/notificationPoller'
import { completeTask, replyTask, type CompletionResult } from '@/services/taskActionService'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauriRuntime } from '@/tauri/window'
import { logAppEvent } from '@/services/appLogger'
import { useSystemStore } from '@/stores/systemStore'
import type { CanTask } from '@/types/can'
import { useAuthStore } from '@/stores/authStore'
import { completeCanTask } from '@/services/canTaskService'
import { getCanNotificationController, getLmaNotificationController, isLmaNotificationRuntimeManaged, reconcileCanNotificationRuntime, reconcileLmaNotificationRuntime, triggerCanNotificationRuntime } from '@/services/lmaNotificationRuntime'

const NOTIFICATION_STORAGE_KEY = 'tauri-app:notifications'
const SETTINGS_STORAGE_KEY = 'tauri-app:notification-settings'
const AUTH_STORAGE_KEY = 'tauri-app:auth'
const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'
const MAX_STORED_NOTIFICATIONS = 20
const DEFAULT_POLLING_INTERVAL = 10000
const MIN_POLLING_INTERVAL_SECONDS = 5
const MAX_POLLING_INTERVAL_SECONDS = 300
const IN_APP_REMINDER_MS = 4000
const REPLIED_ESCALATION_MS = 15 * 60 * 1000
const CAN_NOTIFICATION_CATEGORY = 'Q 潔淨立馬清'
type NotificationSystem = 'lma' | 'can'

function getCanNotificationId(serialNumber: number | string): string {
  return `can:${serialNumber}`
}

function convertCanTaskToNotification(task: CanTask): EmergencyNotification {
  const createdAt = task.createdAt || new Date(task.informTime).toISOString()
  return {
    id: getCanNotificationId(task.serialNumber),
    title: 'Q 潔淨立馬清任務',
    body: `${task.station} ${task.trashBin}`,
    priority: 'pending',
    category: CAN_NOTIFICATION_CATEGORY,
    createdAt,
    receivedAt: new Date().toISOString(),
    metadata: {
      system: 'can',
      serialNumber: task.serialNumber,
      station: task.station,
      trashBin: task.trashBin,
    },
  }
}

function notificationBelongsToSystem(notification: EmergencyNotification | NotificationState, system: NotificationSystem): boolean {
  const notificationSystem = notification.metadata?.system
  if (system === 'can') {
    return notificationSystem === 'can'
  }
  return notificationSystem !== 'can'
}

function getNotificationSystem(notification: EmergencyNotification | NotificationState): NotificationSystem {
  return notification.metadata?.system === 'can' ? 'can' : 'lma'
}

function getStoredNotificationId(notification: EmergencyNotification, system: NotificationSystem): string {
  if (system === 'can') {
    const serialNumber = notification.metadata?.serialNumber
    return getCanNotificationId(typeof serialNumber === 'number' || typeof serialNumber === 'string' ? serialNumber : notification.id)
  }
  return notification.id
}

function normalizeIncomingNotification(notification: EmergencyNotification, system: NotificationSystem): EmergencyNotification {
  const metadata: Record<string, unknown> = { ...notification.metadata, system }
  if (system === 'lma' && metadata.taskId === undefined) {
    const taskId = Number(notification.id)
    if (Number.isFinite(taskId)) {
      metadata.taskId = taskId
    }
  }

  return {
    ...notification,
    id: getStoredNotificationId(notification, system),
    metadata,
  }
}

let _dismissEventUnlisten: UnlistenFn | null = null
let _popupClosedEventUnlisten: UnlistenFn | null = null
let _windowFocusHandler: (() => void) | null = null
let _windowBlurHandler: (() => void) | null = null
let inAppReminderTimeoutId: ReturnType<typeof setTimeout> | null = null
let popupNativeOperation: Promise<void> = Promise.resolve()
let reminderCyclePromise: Promise<void> | null = null
let reminderCycleDirty = false

function serializePopupOperation(operation: () => Promise<void>): Promise<void> {
  if (!getLmaNotificationController()) return operation()
  const next = popupNativeOperation.catch(() => undefined).then(operation)
  popupNativeOperation = next
  return next
}

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

function isNotificationForCurrentView(notification: EmergencyNotification | NotificationState): boolean {
  const systemStore = useSystemStore()
  const notificationSystem = getNotificationSystem(notification)
  return systemStore.currentView === notificationSystem
}

function hasLmaAuthToken(): boolean {
  if (typeof localStorage === 'undefined') return false
  const raw = localStorage.getItem(LMA_AUTH_STORAGE_KEY) ?? localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return false

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed?.token === 'string' && parsed.token.length > 0
  } catch (err) {
    logAppEvent('warn', 'notifications', 'failed to parse lma auth token from storage', err)
    return false
  }
}

interface DismissPayload {
  notificationId: string | null
  dismissAll: boolean
}

interface PopupClosedPayload {
  notificationId: string | null
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

function clampPollingIntervalSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_POLLING_INTERVAL / 1000
  }

  return Math.max(MIN_POLLING_INTERVAL_SECONDS, Math.min(MAX_POLLING_INTERVAL_SECONDS, seconds))
}

export const useNotificationStore = defineStore('notifications', {
  state: () => ({
    notifications: [] as NotificationState[],
    currentNotification: null as NotificationState | null,
    isPolling: false,
    lmaRuntimeActive: true,
    lastError: null as string | null,
    pollingEnabled: true,
    pollingIntervalMs: DEFAULT_POLLING_INTERVAL,
    canPollingEnabled: true,
    canPollingIntervalMs: DEFAULT_POLLING_INTERVAL,
    isCanPolling: false,
    canPollingLastError: null as string | null,
    canRuntimeActive: false,
    canRequestInFlight: false,
    canHasSnapshot: false,
    canTasksSnapshot: [] as CanTask[],
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
    isPopupVisible: false,
  }),

  getters: {
    pendingNotifications: state => state.notifications.filter(n => n.status === 'pending'),

    shownNotifications: state => state.notifications.filter(n => n.status === 'shown'),

    dismissedNotifications: state => state.notifications.filter(n => n.status === 'dismissed'),

    hasNewNotification: state => state.currentNotification !== null,

    notificationCount: state => state.notifications.length,

    unreadCount: state => state.notifications.filter(n => n.status !== 'dismissed' &&
      ((n.metadata?.system === 'can' && state.canRuntimeActive) || (n.metadata?.system !== 'can' && state.lmaRuntimeActive))).length,

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
      return state.notifications.filter(n => n.priority === 'pending' && n.status !== 'dismissed' &&
        ((state.lmaRuntimeActive && n.metadata?.system !== 'can') || (state.canRuntimeActive && n.metadata?.system === 'can'))).length
    },

    pollingIntervalSeconds: state => {
      return state.pollingIntervalMs / 1000
    },

    canPollingIntervalSeconds: state => {
      return state.canPollingIntervalMs / 1000
    },
    canActiveTasks: state => state.canTasksSnapshot.filter(task => !task.isDone),
  },

  actions: {
    async init() {
      this.loadFromStorage()
      await this.setupDismissListener()
      await this.setupPopupClosedListener()
      this.setupWindowFocusListener()
      if (this.pollingEnabled) {
        this.startPolling()
      }
    },

    isTaskUnresolved(notification: NotificationState) {
      return notification.priority === 'pending' || notification.priority === 'replied'
    },

    isPriorityUnresolved(priority: NotificationPriority) {
      return priority === 'pending' || priority === 'replied'
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

      if (!this.isTaskUnresolved(existing)) {
        this.resolveNotificationFromPolling(existing.id, incoming.priority)
      }
    },

    resolveNotificationFromPolling(notificationId: string, priority?: NotificationPriority) {
      const notification = this.notifications.find(n => n.id === notificationId)
      if (!notification) return

      if (priority) {
        notification.priority = priority
        notification.category = priority
      }

      if (notification.status !== 'dismissed') {
        notification.status = 'dismissed'
        notification.dismissedAt = new Date().toISOString()
      }

      if (this.currentNotification?.id === notificationId) {
        this.currentNotification = null
      }
    },

    reconcileMissingRemoteTasks(incomingNotifications: EmergencyNotification[], system: NotificationSystem) {
      const remoteIds = new Set(incomingNotifications.map(notification => notification.id))

      for (const notification of this.notifications) {
        if (
          notification.status !== 'dismissed' &&
          this.isTaskUnresolved(notification) &&
          notificationBelongsToSystem(notification, system) &&
          !remoteIds.has(notification.id)
        ) {
          this.resolveNotificationFromPolling(notification.id)
        }
      }
    },

    getReminderTarget(unresolved: NotificationState[]): NotificationState | null {
      if (unresolved.length === 0) return null

      const current = this.currentNotification
      if (current && unresolved.some(notification => notification.id === current.id)) {
        return current
      }

      return unresolved[unresolved.length - 1] ?? null
    },

    getReminderCandidates() {
      const pending = this.notifications.filter(
        notification => notification.status !== 'dismissed' && notification.priority === 'pending' &&
          ((this.lmaRuntimeActive && getNotificationSystem(notification) === 'lma') || (this.canRuntimeActive && getNotificationSystem(notification) === 'can'))
      )
      if (pending.length > 0) {
        return pending
      }

      return this.notifications.filter(
        notification => notification.status !== 'dismissed' && this.isRepliedEscalated(notification) &&
          ((this.lmaRuntimeActive && getNotificationSystem(notification) === 'lma') || (this.canRuntimeActive && getNotificationSystem(notification) === 'can'))
      )
    },

    getNextPendingNotification() {
      return this.notifications.find(notification => notification.status === 'pending' &&
        ((this.lmaRuntimeActive && getNotificationSystem(notification) === 'lma') || (this.canRuntimeActive && getNotificationSystem(notification) === 'can'))) ?? null
    },

    async runReminderCycleNow() {
      const candidates = this.getReminderCandidates()
      const target = this.getReminderTarget(candidates)
      if (!target) {
        this.clearReminderSignals()
        await this.hidePopup()
        return
      }

      if (isMainWindowActive() && isNotificationForCurrentView(target)) {
        target.status = 'shown'
        this.currentNotification = target
        await this.hidePopup()
        this.showInAppReminder(candidates.length)
        logAppEvent('info', 'notifications', 'showing in-app reminder instead of popup', {
          count: candidates.length,
          notificationId: target.id,
        })
        return
      }

      this.hideInAppReminder()
      if (this.currentNotification?.id !== target.id || target.status !== 'shown' || !this.isPopupVisible) {
        await this.showNotification(target.id)
      }
    },

    async runReminderCycle() {
      if (!isLmaNotificationRuntimeManaged()) return this.runReminderCycleNow()
      reminderCycleDirty = true
      if (reminderCyclePromise) return reminderCyclePromise

      reminderCyclePromise = (async () => {
        do {
          reminderCycleDirty = false
          await this.runReminderCycleNow()
        } while (reminderCycleDirty)
      })().finally(() => {
        reminderCyclePromise = null
      })
      return reminderCyclePromise
    },


    async setupDismissListener() {
      if (!isTauriRuntime()) return
      if (_dismissEventUnlisten) return

      try {
        _dismissEventUnlisten = await listen<DismissPayload>('dismiss-notification', event => {
          logAppEvent('info', 'notifications', 'received dismiss-notification event', event.payload)
          if (event.payload.dismissAll) {
            this.dismissAllNotificationsInternal()
          } else if (event.payload.notificationId) {
            this.dismissNotificationById(event.payload.notificationId)
          }
        })
      } catch (err) {
        logAppEvent('warn', 'notifications', 'failed to set up dismiss listener', err)
        console.warn('Failed to setup dismiss listener:', err)
      }
    },

    async setupPopupClosedListener() {
      if (!isTauriRuntime()) return
      if (_popupClosedEventUnlisten) return

      try {
        _popupClosedEventUnlisten = await listen<PopupClosedPayload>('popup-closed', event => {
          logAppEvent('info', 'notifications', 'received popup-closed event', event.payload)
          const { notificationId } = event.payload
          if (notificationId) {
            const notification = this.notifications.find(n => n.id === notificationId)
            if (notification && notification.status !== 'dismissed') {
              notification.status = 'pending'
              notification.dismissedAt = undefined
            }
            if (this.currentNotification?.id === notificationId) {
              this.currentNotification = null
            }
          }
          this.isPopupVisible = false
          void this.runReminderCycle().catch(err => {
            logAppEvent('warn', 'notifications', 'reminder cycle after popup-closed failed', err)
            console.warn('Reminder cycle after popup-closed failed:', err)
          })
        })
      } catch (err) {
        logAppEvent('warn', 'notifications', 'failed to set up popup-closed listener', err)
        console.warn('Failed to setup popup-closed listener:', err)
      }
    },

    setupWindowFocusListener() {
      if (_windowFocusHandler) return
      _windowFocusHandler = () => {
        if (this.currentNotification && isNotificationForCurrentView(this.currentNotification)) {
          void this.runReminderCycle()
        }
      }
      _windowBlurHandler = () => {
        if (this.currentNotification) {
          void this.runReminderCycle().catch(err => {
            logAppEvent('warn', 'notifications', 'reminder cycle after window blur failed', err)
            console.warn('Reminder cycle after window blur failed:', err)
          })
        }
      }
      window.addEventListener('focus', _windowFocusHandler)
      window.addEventListener('blur', _windowBlurHandler)
    },

    handleDismissEvent(payload: DismissPayload) {
      if (payload.dismissAll) {
        this.dismissAllNotificationsInternal()
      } else if (payload.notificationId) {
        this.dismissNotificationById(payload.notificationId)
      }
    },

    handlePopupClosedEvent(notificationId: string | null) {
      if (notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId)
        if (notification && notification.status !== 'dismissed') {
          notification.status = 'pending'
          notification.dismissedAt = undefined
        }
        if (this.currentNotification?.id === notificationId) this.currentNotification = null
      }
      this.isPopupVisible = false
      void this.runReminderCycle()
    },

    teardown() {
      this.stopPolling()
      popupNativeOperation = Promise.resolve()
      reminderCyclePromise = null
      reminderCycleDirty = false
      clearInAppReminderTimeout()
      if (_dismissEventUnlisten) {
        _dismissEventUnlisten()
        _dismissEventUnlisten = null
      }
      if (_popupClosedEventUnlisten) {
        _popupClosedEventUnlisten()
        _popupClosedEventUnlisten = null
      }
      if (_windowFocusHandler) {
        window.removeEventListener('focus', _windowFocusHandler)
        _windowFocusHandler = null
      }
      if (_windowBlurHandler) {
        window.removeEventListener('blur', _windowBlurHandler)
        _windowBlurHandler = null
      }
    },

    startPolling() {
      if (getLmaNotificationController() || isLmaNotificationRuntimeManaged()) {
        reconcileLmaNotificationRuntime()
        return
      }
      if (!hasLmaAuthToken()) {
        this.isPolling = false
        this.lastError = null
        this.pollingStats = {
          ...this.pollingStats,
          nextPollTime: null,
          lastError: null,
          isConnected: false,
        }
        logAppEvent('info', 'notifications', 'skipped notification polling because lma is not logged in')
        return
      }

      const poller = getNotificationPoller()

      poller.updateConfig({ intervalMs: this.pollingIntervalMs })

      poller.start({
        onNewNotifications: (newNotifications: EmergencyNotification[]) => {
          this.handleNewNotifications(newNotifications)
        },
        onError: (error: Error) => {
          this.lastError = error.message
          logAppEvent('error', 'notifications', 'notification polling error', error)
          console.error('Notification polling error:', error)
        },
        onPollComplete: (stats: PollingStats) => {
          this.pollingStats = stats
        },
      })

      this.isPolling = true
      logAppEvent('info', 'notifications', 'started notification polling', {
        intervalSeconds: this.pollingIntervalSeconds,
      })
    },

    stopPolling() {
      if (getLmaNotificationController() || isLmaNotificationRuntimeManaged()) {
        reconcileLmaNotificationRuntime()
        void this.runReminderCycle()
        return
      }
      const poller = getNotificationPoller()
      poller.stop()
      this.isPolling = false
      this.lastError = null
      this.pollingStats = {
        ...this.pollingStats,
        nextPollTime: null,
        lastError: null,
        isConnected: false,
      }
      logAppEvent('info', 'notifications', 'stopped notification polling')
    },

    async manualRefresh() {
      const controller = getLmaNotificationController()
      if (controller || isLmaNotificationRuntimeManaged()) {
        if (controller) await controller.trigger()
        return
      }
      if (!this.isPolling) {
        logAppEvent('warn', 'notifications', 'manual refresh skipped because polling is not active')
        return
      }
      const poller = getNotificationPoller()
      await poller.triggerPoll()
    },

    handleNewNotifications(newNotifications: EmergencyNotification[], system: NotificationSystem = 'lma') {
      if (newNotifications.length > 0) {
        logAppEvent('info', 'notifications', 'received notifications from poller', { count: newNotifications.length })
      }

      const normalizedNotifications = newNotifications.map(notification => normalizeIncomingNotification(notification, system))

      for (const notification of normalizedNotifications) {
        const existingIndex = this.notifications.findIndex(n => n.id === notification.id)
        if (existingIndex !== -1) {
          const existing = this.notifications[existingIndex]
          if (existing) {
            this.updateExistingNotification(existing, notification)
          }
          continue
        }

        if (!this.isPriorityUnresolved(notification.priority)) {
          continue
        }

        const notificationState = convertToNotificationState(notification)
        if (notificationState.priority === 'replied') {
          notificationState.repliedAt = new Date().toISOString()
        }
        this.notifications.unshift(notificationState)

      }

      this.reconcileMissingRemoteTasks(normalizedNotifications, system)

      void this.runReminderCycle().catch(err => {
        logAppEvent('warn', 'notifications', 'reminder cycle failed', err)
        console.warn('Reminder cycle failed:', err)
      })

      this.pruneOldNotifications()
      this.saveToStorage()
    },

    handleCanTasks(tasks: CanTask[]) {
      const unresolvedTasks = tasks.filter(task => !task.isDone)
      if (unresolvedTasks.length > 0) {
        logAppEvent('info', 'notifications', 'received CAN tasks from poller', { count: unresolvedTasks.length })
      }

      this.handleNewNotifications(unresolvedTasks.map(convertCanTaskToNotification), 'can')
    },

    setCanSnapshot(tasks: CanTask[]) {
      this.canTasksSnapshot = tasks.map(task => ({ ...task }))
      this.canHasSnapshot = true
      this.canPollingLastError = null
      this.handleCanTasks(this.canTasksSnapshot)
    },

    async refreshCanTasks() {
      await triggerCanNotificationRuntime()
    },

    clearCanSnapshot() {
      this.canTasksSnapshot = []
      this.canHasSnapshot = false
      for (const notification of this.notifications) {
        if (getNotificationSystem(notification) === 'can' && this.isTaskUnresolved(notification)) {
          this.resolveNotificationFromPolling(notification.id)
        }
      }
      if (this.currentNotification && getNotificationSystem(this.currentNotification) === 'can') {
        this.currentNotification = null
      }
      void this.runReminderCycle()
    },

    async completeCanTask(serialNumber: number, resolutionType: number) {
      const authStore = useAuthStore()
      const token = authStore.getSystemSession('can')?.token
      const station = authStore.getSystemSession('can')?.user
      const stationCode = station && 'station' in station ? station.station : null
      if (!token || !stationCode) throw new Error('缺少 Q 潔淨立馬清登入驗證資訊，請重新登入')
      const controller = getCanNotificationController()
      const generation = controller?.getGeneration()
      await completeCanTask(token, serialNumber, true, resolutionType)
      const currentSession = authStore.getSystemSession('can')
      const currentUser = currentSession?.user
      const currentStation = currentUser && 'station' in currentUser ? currentUser.station : null
      if (currentSession?.token !== token || currentStation !== stationCode ||
        (controller && controller.getGeneration() !== generation)) return
      const task = this.canTasksSnapshot.find(item => item.serialNumber === serialNumber)
      if (task) {
        task.isDone = true
        task.resolutionType = resolutionType
      }
      this.handleCanTasks(this.canTasksSnapshot)
      this.resolveNotificationFromPolling(getCanNotificationId(serialNumber), 'completed')
      controller?.invalidate()
      await triggerCanNotificationRuntime()
    },

    async showNotification(notificationId: string) {
      const notification = this.notifications.find(n => n.id === notificationId)
      if (!notification) return
      if ((getNotificationSystem(notification) === 'lma' && !this.lmaRuntimeActive) ||
        (getNotificationSystem(notification) === 'can' && !this.canRuntimeActive)) return

      if (this.currentNotification?.id === notificationId && notification.status === 'shown' && this.isPopupVisible) {
        return
      }

      notification.status = 'shown'
      this.currentNotification = notification
      this.isPopupVisible = true

      if (!isTauriRuntime()) return

      if (isMainWindowActive() && isNotificationForCurrentView(notification)) {
        this.isPopupVisible = false
        return
      }

      try {
        logAppEvent('info', 'notifications', 'showing alert popup', {
          notificationId: notification.id,
          priority: notification.priority,
        })
        await serializePopupOperation(() => invoke('show_alert_popup', {
          notification: {
            id: notification.id,
            title: notification.title,
            body: notification.body,
            priority: notification.priority,
            category: notification.category,
            createdAt: notification.createdAt,
            unreadCount: this.unreadCount,
            metadata: notification.metadata,
          },
        }))
      } catch (err) {
        notification.status = 'pending'
        if (this.currentNotification?.id === notification.id) {
          this.currentNotification = null
        }
        this.isPopupVisible = false
        logAppEvent('warn', 'notifications', 'failed to show alert popup', err)
        console.warn('Failed to show alert popup:', err)
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
      const notification = this.notifications.find(n => n.id === notificationId)
      if (notification && getNotificationSystem(notification) === 'can') return null

      const metadataTaskId = notification?.metadata?.taskId
      if (typeof metadataTaskId === 'number' && Number.isFinite(metadataTaskId)) {
        return metadataTaskId
      }

      const taskId = Number(notificationId)
      return Number.isFinite(taskId) ? taskId : null
    },

    async replyTaskById(notificationId: string) {
      const taskId = this.getTaskId(notificationId)
      if (taskId === null) {
        this.taskActionError = '任務編號無效'
        return
      }

      this.isTaskActionPending = true
      this.taskActionError = null

      try {
        const token = useAuthStore().getSystemSession('lma')?.token
        if (!token) throw new Error('缺少立碼幫幫忙登入驗證資訊，請重新登入')
        const status = await replyTask(token, taskId)
        if (status === 'replied' || status === 'completed' || status === 'ignored' || status === 'pending') {
          this.setTaskStatus(notificationId, status)
        } else {
          this.setTaskStatus(notificationId, 'replied')
        }
        this.saveToStorage()
        logAppEvent('info', 'notifications', 'task reply succeeded', { notificationId, status })
      } catch (err) {
        this.taskActionError = err instanceof Error ? err.message : String(err)
        logAppEvent('error', 'notifications', 'task reply failed', err)
      } finally {
        this.isTaskActionPending = false
      }
    },

    async completeTaskById(notificationId: string, result: CompletionResult) {
      const taskId = this.getTaskId(notificationId)
      if (taskId === null) {
        this.taskActionError = '任務編號無效'
        return
      }

      this.isTaskActionPending = true
      this.taskActionError = null

      try {
        const token = useAuthStore().getSystemSession('lma')?.token
        if (!token) throw new Error('缺少立碼幫幫忙登入驗證資訊，請重新登入')
        await completeTask(token, taskId, result)
        this.setTaskStatus(notificationId, 'completed')
        this.dismissNotificationById(notificationId)
        logAppEvent('info', 'notifications', 'task completion succeeded', { notificationId, result })
      } catch (err) {
        this.taskActionError = err instanceof Error ? err.message : String(err)
        logAppEvent('error', 'notifications', 'task completion failed', err)
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
        logAppEvent('info', 'notifications', 'dismissed notification', { notificationId })
      }

      if (this.currentNotification?.id === notificationId) {
        this.currentNotification = null
      }

      this.saveToStorage()
      void this.runReminderCycle().catch(err => {
        logAppEvent('warn', 'notifications', 'reminder cycle after dismissal failed', err)
        console.warn('Reminder cycle after dismissal failed:', err)
      })
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
      void this.runReminderCycle()
      this.saveToStorage()
    },

    async dismissAllNotifications() {
      this.dismissAllNotificationsInternal()
    },

    async hidePopup() {
      this.isPopupVisible = false
      if (isTauriRuntime()) {
        try {
          await serializePopupOperation(() => invoke('hide_alert_popup'))
        } catch (err) {
          logAppEvent('warn', 'notifications', 'failed to hide alert popup', err)
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
      const keptBySystem = new Map<NotificationSystem, number>()

      this.notifications = this.notifications.filter(notification => {
        const system = getNotificationSystem(notification)
        const kept = keptBySystem.get(system) ?? 0
        if (kept >= MAX_STORED_NOTIFICATIONS) return false

        keptBySystem.set(system, kept + 1)
        return true
      })
    },

    setPollingEnabled(enabled: boolean) {
      this.pollingEnabled = enabled
      if (enabled && !this.isPolling) {
        this.startPolling()
      } else if (!enabled && this.isPolling) {
        this.stopPolling()
      }
      this.saveSettings()
      reconcileLmaNotificationRuntime()
      logAppEvent('info', 'notifications', 'updated polling enabled setting', { enabled })
    },

    setPollingInterval(seconds: number) {
      const clampedSeconds = clampPollingIntervalSeconds(seconds)
      this.pollingIntervalMs = clampedSeconds * 1000

      reconcileLmaNotificationRuntime()

      if (!isLmaNotificationRuntimeManaged()) {
        const poller = getNotificationPoller()
        poller.updateConfig({ intervalMs: this.pollingIntervalMs })
      }

      this.saveSettings()
      logAppEvent('info', 'notifications', 'updated polling interval', { seconds: clampedSeconds })
    },

    setCanPollingEnabled(enabled: boolean) {
      this.canPollingEnabled = enabled
      reconcileCanNotificationRuntime()
      if (!enabled) void this.runReminderCycle()
      this.saveSettings()
      logAppEvent('info', 'notifications', 'updated CAN polling enabled setting', { enabled })
    },

    setCanPollingInterval(seconds: number) {
      const clampedSeconds = clampPollingIntervalSeconds(seconds)
      this.canPollingIntervalMs = clampedSeconds * 1000
      reconcileCanNotificationRuntime()
      this.saveSettings()
      logAppEvent('info', 'notifications', 'updated CAN polling interval', { seconds: clampedSeconds })
    },

    setCanPollingRuntimeState(isPolling: boolean) {
      this.isCanPolling = isPolling
      if (isPolling) {
        this.canPollingLastError = null
      }
    },

    setCanRuntimeState(active: boolean) {
      this.canRuntimeActive = active
      this.isCanPolling = active
      if (!active) void this.runReminderCycle()
    },

    setCanRequestState(inFlight: boolean) {
      this.canRequestInFlight = inFlight
    },

    setCanPollingError(error: string | null) {
      this.canPollingLastError = error
    },

    setLmaRuntimeState(active: boolean) {
      this.lmaRuntimeActive = active
      this.isPolling = active
      if (!active) this.lastError = null
      void this.runReminderCycle()
    },

    setPollingError(error: string | null) {
      this.lastError = error
      this.pollingStats.lastError = error
      this.pollingStats.isConnected = error === null
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
          logAppEvent('warn', 'notifications', 'failed to parse stored notifications', err)
          console.warn('Failed to parse stored notifications:', err)
        }
      }

      const settingsRaw = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (settingsRaw) {
        try {
          const settings = JSON.parse(settingsRaw) as {
            pollingEnabled?: boolean
            pollingIntervalMs?: number
            canPollingEnabled?: boolean
            canPollingIntervalMs?: number
          }
          if (typeof settings.pollingEnabled === 'boolean') {
            this.pollingEnabled = settings.pollingEnabled
          }
          if (typeof settings.pollingIntervalMs === 'number') {
            this.pollingIntervalMs = clampPollingIntervalSeconds(settings.pollingIntervalMs / 1000) * 1000
          }
          if (typeof settings.canPollingEnabled === 'boolean') {
            this.canPollingEnabled = settings.canPollingEnabled
          }
          if (typeof settings.canPollingIntervalMs === 'number') {
            this.canPollingIntervalMs = clampPollingIntervalSeconds(settings.canPollingIntervalMs / 1000) * 1000
          }
        } catch (err) {
          logAppEvent('warn', 'notifications', 'failed to parse stored settings', err)
          console.warn('Failed to parse stored settings:', err)
        }
      }
    },

    saveToStorage() {
      if (typeof localStorage === 'undefined') return

      try {
        localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(this.notifications))
      } catch (err) {
        logAppEvent('warn', 'notifications', 'failed to save notifications', err)
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
            canPollingEnabled: this.canPollingEnabled,
            canPollingIntervalMs: this.canPollingIntervalMs,
          })
        )
      } catch (err) {
        logAppEvent('warn', 'notifications', 'failed to save notification settings', err)
        console.warn('Failed to save settings:', err)
      }
    },
  },
})
