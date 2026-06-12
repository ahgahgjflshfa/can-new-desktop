import type { EmergencyNotification, NotificationState } from '@/types/notification'
import { logAppEvent } from '@/services/appLogger'
import { fetchNotifications, OFFICIAL_SERVER_URL } from './notificationDataSource'

const LOG_SOURCE = 'notification-poller'

export interface NotificationPollerCallbacks {
  onNewNotifications: (notifications: EmergencyNotification[]) => void
  onError?: (error: Error) => void
  onPollComplete?: (stats: PollingStats) => void
}

export interface NotificationPollerConfig {
  serverUrl: string
  intervalMs: number
}

export interface PollingStats {
  lastPollTime: Date | null
  nextPollTime: Date | null
  pollCount: number
  successCount: number
  errorCount: number
  lastError: string | null
  isConnected: boolean
}

const DEFAULT_CONFIG: NotificationPollerConfig = {
  serverUrl: OFFICIAL_SERVER_URL,
  intervalMs: 10000,
}

class NotificationPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private config: NotificationPollerConfig
  private callbacks: NotificationPollerCallbacks | null = null
  private lastSyncTime: string | null = null
  private isPolling = false
  private isPollInProgress = false

  private stats: PollingStats = {
    lastPollTime: null,
    nextPollTime: null,
    pollCount: 0,
    successCount: 0,
    errorCount: 0,
    lastError: null,
    isConnected: false,
  }

  constructor(config: Partial<NotificationPollerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  start(callbacks: NotificationPollerCallbacks): void {
    if (this.intervalId !== null) {
      logAppEvent('warn', LOG_SOURCE, 'Restarting notification poller because it was already running')
      this.stop()
    }

    this.callbacks = callbacks
    this.isPolling = true
    logAppEvent('info', LOG_SOURCE, 'Starting notification poller', {
      intervalMs: this.config.intervalMs,
      serverUrl: this.config.serverUrl,
    })
    this.poll()
    this.intervalId = setInterval(() => this.poll(), this.config.intervalMs)
    this.updateNextPollTime()
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.isPolling = false
    this.stats.nextPollTime = null
    logAppEvent('info', LOG_SOURCE, 'Stopped notification poller', {
      pollCount: this.stats.pollCount,
      successCount: this.stats.successCount,
      errorCount: this.stats.errorCount,
    })
  }

  isActive(): boolean {
    return this.isPolling
  }

  getStats(): PollingStats {
    return { ...this.stats }
  }

  private updateNextPollTime(): void {
    if (this.isPolling) {
      this.stats.nextPollTime = new Date(Date.now() + this.config.intervalMs)
    }
  }

  async poll(): Promise<void> {
    if (!this.callbacks) {
      logAppEvent('warn', LOG_SOURCE, 'Skipped poll because callbacks are not registered')
      return
    }
    if (this.isPollInProgress) {
      logAppEvent('warn', LOG_SOURCE, 'Skipped poll because a previous poll is still in progress')
      return
    }

    this.isPollInProgress = true

    this.stats.pollCount++
    logAppEvent('info', LOG_SOURCE, 'Running notification poll', {
      pollCount: this.stats.pollCount,
      lastSyncTime: this.lastSyncTime,
      serverUrl: this.config.serverUrl,
    })

    try {
      const response = await fetchNotifications(this.config.serverUrl, this.lastSyncTime ?? undefined)

      this.lastSyncTime = response.serverTime
      this.stats.lastPollTime = new Date()
      this.stats.successCount++
      this.stats.isConnected = true
      this.stats.lastError = null
      this.updateNextPollTime()

      logAppEvent('info', LOG_SOURCE, 'Notification poll succeeded', {
        notificationCount: response.notifications.length,
        serverTime: response.serverTime,
        stats: this.getStats(),
      })

      this.callbacks.onNewNotifications(response.notifications)

      if (this.callbacks.onPollComplete) {
        this.callbacks.onPollComplete(this.getStats())
      }
    } catch (error) {
      this.stats.errorCount++
      this.stats.isConnected = false
      this.stats.lastError = error instanceof Error ? error.message : String(error)
      this.stats.lastPollTime = new Date()
      this.updateNextPollTime()

      logAppEvent('error', LOG_SOURCE, 'Notification poll failed', {
        error,
        stats: this.getStats(),
      })

      if (this.callbacks.onError) {
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      }

      if (this.callbacks.onPollComplete) {
        this.callbacks.onPollComplete(this.getStats())
      }
    } finally {
      this.isPollInProgress = false
    }
  }

  updateConfig(config: Partial<NotificationPollerConfig>): void {
    const wasPolling = this.isPolling
    const oldCallbacks = this.callbacks

    if (wasPolling) {
      this.stop()
    }

    this.config = { ...this.config, ...config }
    logAppEvent('info', LOG_SOURCE, 'Updated notification poller config', {
      config: this.config,
      wasPolling,
    })

    if (wasPolling && oldCallbacks) {
      this.start(oldCallbacks)
    }
  }

  getConfig(): NotificationPollerConfig {
    return { ...this.config }
  }

  async triggerPoll(): Promise<void> {
    if (!this.isPolling || this.isPollInProgress) {
      return
    }
    await this.poll()
  }
}

let pollerInstance: NotificationPoller | null = null

export function getNotificationPoller(): NotificationPoller {
  if (!pollerInstance) {
    pollerInstance = new NotificationPoller()
  }
  return pollerInstance
}

export function createNotificationPoller(config?: Partial<NotificationPollerConfig>): NotificationPoller {
  return new NotificationPoller(config)
}

export function convertToNotificationState(notification: EmergencyNotification): NotificationState {
  return {
    ...notification,
    status: 'pending',
  }
}
