import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { watch, type WatchStopHandle } from 'vue'
import { fetchNotifications } from '@/services/notificationDataSource'
import { logAppEvent } from '@/services/appLogger'
import { CanNotificationController } from '@/services/canNotificationRuntime'
import type { CanTask } from '@/types/can'

export interface LmaRuntimeCallbacks {
  onSnapshot: (notifications: Awaited<ReturnType<typeof fetchNotifications>>['notifications']) => void
  onError: (error: Error) => void
  onStopped?: () => void
  onStarted?: () => void
}

export interface LmaRuntimeConfig {
  enabled: boolean
  intervalMs: number
  token: string | null
}

export class LmaNotificationController {
  private config: LmaRuntimeConfig = { enabled: false, intervalMs: 10000, token: null }
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private queued = false
  private generation = 0
  private lastSyncTime: string | undefined

  constructor(private readonly callbacks: LmaRuntimeCallbacks) {}

  reconcile(config: LmaRuntimeConfig): void {
    const unchanged = this.config.enabled === config.enabled &&
      this.config.intervalMs === config.intervalMs && this.config.token === config.token
    this.config = { ...config }
    if (unchanged) return

    const requestRestartAfterFlight = this.inFlight
    this.generation++
    this.clearTimer()
    const active = config.enabled && Boolean(config.token)
    if (!active) {
      this.queued = false
      this.callbacks.onStopped?.()
      return
    }
    this.callbacks.onStarted?.()
    if (requestRestartAfterFlight) this.queued = true
    else this.schedule(0)
  }

  async trigger(): Promise<void> {
    if (!this.isActive()) return
    this.clearTimer()
    if (this.inFlight) {
      this.queued = true
      return
    }
    await this.poll(this.generation)
  }

  teardown(): void {
    this.generation++
    this.clearTimer()
    this.queued = false
    this.config = { enabled: false, intervalMs: this.config.intervalMs, token: null }
    this.callbacks.onStopped?.()
  }

  getGeneration(): number {
    return this.generation
  }

  private isActive(): boolean {
    return this.config.enabled && Boolean(this.config.token)
  }

  private schedule(delayMs: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.trigger()
    }, delayMs)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private async poll(requestGeneration: number): Promise<void> {
    const token = this.config.token
    if (!token || !this.isActive()) return
    this.inFlight = true
    try {
      const response = await fetchNotifications(undefined, this.lastSyncTime, token)
      if (requestGeneration !== this.generation || !this.isActive()) return
      this.lastSyncTime = response.serverTime
      this.callbacks.onSnapshot(response.notifications)
    } catch (error) {
      if (requestGeneration === this.generation && this.isActive()) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.callbacks.onError(normalized)
      }
    } finally {
      this.inFlight = false
      if (!this.isActive()) {
        this.queued = false
        return
      }
      if (requestGeneration !== this.generation) {
        if (this.queued) {
          this.queued = false
          void this.poll(this.generation)
        } else if (this.timer === null) {
          this.schedule(0)
        }
        return
      }
      if (this.queued) {
        this.queued = false
        void this.poll(this.generation)
      } else {
        this.schedule(this.config.intervalMs)
      }
    }
  }
}

interface RuntimeStore {
  loadFromStorage: () => void
  handleNewNotifications: (notifications: Awaited<ReturnType<typeof fetchNotifications>>['notifications'], system?: 'lma' | 'can') => void
  setLmaRuntimeState?: (active: boolean) => void
  setPollingError?: (error: string | null) => void
  handleDismissEvent?: (payload: { notificationId: string | null; dismissAll: boolean }) => void
  handlePopupClosedEvent?: (notificationId: string | null) => void
  runReminderCycle?: () => Promise<void>
  pollingEnabled: boolean
  pollingIntervalMs: number
  canPollingEnabled?: boolean
  canPollingIntervalMs?: number
  setCanRuntimeState?: (active: boolean) => void
  setCanSnapshot?: (tasks: CanTask[]) => void
  setCanPollingError?: (error: string | null) => void
  setCanRequestState?: (inFlight: boolean) => void
  clearCanSnapshot?: () => void
  getSystemSession?: (system: 'lma' | 'can') => { token: string } | null
}

let initializationPromise: Promise<void> | null = null
let runtimeEpoch = 0
let runtimeManaged = false
let runtimeController: LmaNotificationController | null = null
let runtimeStop: (() => void) | null = null
let runtimeReconcile: (() => void) | null = null
let runtimeWatchStop: WatchStopHandle | null = null
let canRuntimeController: CanNotificationController | null = null
let canRuntimeReconcile: (() => void) | null = null
let canRuntimeWatchStop: WatchStopHandle | null = null
let previousCanCredentials = { token: null as string | null, station: null as string | null }

function getCanStation(authStore: { getSystemSession: (system: 'lma' | 'can') => { token: string; user?: unknown } | null }): string | null {
  const user = authStore.getSystemSession('can')?.user
  return user && typeof user === 'object' && 'station' in user && typeof user.station === 'string' ? user.station : null
}
let runtimeUnlisteners: UnlistenFn[] = []

export function getLmaNotificationController(): LmaNotificationController | null {
  return runtimeController
}

export function teardownNotificationRuntime(): void {
  runtimeEpoch++
  canRuntimeController?.teardown()
  canRuntimeController = null
  runtimeController?.teardown()
  runtimeController = null
  runtimeStop?.()
  runtimeStop = null
  runtimeWatchStop?.()
  runtimeWatchStop = null
  canRuntimeWatchStop?.()
  canRuntimeWatchStop = null
  canRuntimeReconcile = null
  previousCanCredentials = { token: null, station: null }
  runtimeReconcile = null
  for (const unlisten of runtimeUnlisteners.splice(0)) unlisten()
  initializationPromise = null
  runtimeManaged = false
}

export function initializeNotificationRuntime(options: {
  notificationStore: RuntimeStore
  authStore: { getSystemSession: (system: 'lma' | 'can') => { token: string; user?: unknown } | null }
  onOpenSystem: (system: 'lma' | 'can') => void
}): Promise<void> {
  runtimeManaged = true
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    const epoch = runtimeEpoch
    const { notificationStore, authStore } = options
    notificationStore.loadFromStorage()
    if (epoch !== runtimeEpoch) return
    runtimeController = new LmaNotificationController({
      onSnapshot: notifications => notificationStore.handleNewNotifications(notifications, 'lma'),
      onError: error => notificationStore.setPollingError?.(error.message),
      onStopped: () => notificationStore.setLmaRuntimeState?.(false),
      onStarted: () => notificationStore.setLmaRuntimeState?.(true),
    })
    canRuntimeController = new CanNotificationController({
      onSnapshot: tasks => notificationStore.setCanSnapshot?.(tasks),
      onError: error => notificationStore.setCanPollingError?.(error.message),
      onStopped: () => notificationStore.setCanRuntimeState?.(false),
      onStarted: () => notificationStore.setCanRuntimeState?.(true),
      onRequestStarted: () => notificationStore.setCanRequestState?.(true),
      onRequestFinished: () => notificationStore.setCanRequestState?.(false),
    })

    try {
      const dismissUnlisten = await listen<{ notificationId: string | null; dismissAll: boolean }>('dismiss-notification', event => {
        notificationStore.handleDismissEvent?.(event.payload)
      })
      if (epoch !== runtimeEpoch) { dismissUnlisten(); return }
      runtimeUnlisteners.push(dismissUnlisten)
      const popupClosedUnlisten = await listen<{ notificationId: string | null }>('popup-closed', event => {
        notificationStore.handlePopupClosedEvent?.(event.payload.notificationId)
      })
      if (epoch !== runtimeEpoch) { popupClosedUnlisten(); return }
      runtimeUnlisteners.push(popupClosedUnlisten)
      const openUnlisten = await listen<{ system?: 'lma' | 'can' }>('open-notification-system', event => {
        if (event.payload.system === 'lma' || event.payload.system === 'can') options.onOpenSystem(event.payload.system)
      })
      if (epoch !== runtimeEpoch) { openUnlisten(); return }
      runtimeUnlisteners.push(openUnlisten)
      const focusHandler = () => { void notificationStore.runReminderCycle?.() }
      const blurHandler = () => { void notificationStore.runReminderCycle?.() }
      window.addEventListener('focus', focusHandler)
      window.addEventListener('blur', blurHandler)
      runtimeUnlisteners.push(() => window.removeEventListener('focus', focusHandler))
      runtimeUnlisteners.push(() => window.removeEventListener('blur', blurHandler))
    } catch (error) {
      if (epoch !== runtimeEpoch) return
      logAppEvent('error', 'notifications', 'notification runtime initialization failed', error)
      for (const unlisten of runtimeUnlisteners.splice(0)) unlisten()
      runtimeController?.teardown()
      runtimeController = null
      canRuntimeController?.teardown()
      canRuntimeController = null
      initializationPromise = null
      throw error
    }

    const reconcile = () => runtimeController?.reconcile({
      enabled: notificationStore.pollingEnabled,
      intervalMs: notificationStore.pollingIntervalMs,
      token: authStore.getSystemSession('lma')?.token ?? null,
    })
    runtimeReconcile = reconcile
    runtimeWatchStop = watch(
      () => [authStore.getSystemSession('lma')?.token ?? null, notificationStore.pollingEnabled, notificationStore.pollingIntervalMs],
      reconcile,
    )
    const canReconcile = () => {
      const session = authStore.getSystemSession('can')
      const station = getCanStation(authStore)
      if (previousCanCredentials.token !== (session?.token ?? null) || previousCanCredentials.station !== station) {
        notificationStore.clearCanSnapshot?.()
        previousCanCredentials = { token: session?.token ?? null, station }
      }
      canRuntimeController?.reconcile({
        enabled: notificationStore.canPollingEnabled ?? false,
        intervalMs: notificationStore.canPollingIntervalMs ?? 10000,
        token: session?.token ?? null,
        station,
      })
    }
    canRuntimeReconcile = canReconcile
    canRuntimeWatchStop = watch(
      () => [authStore.getSystemSession('can')?.token ?? null, getCanStation(authStore), notificationStore.canPollingEnabled ?? false, notificationStore.canPollingIntervalMs ?? 10000],
      canReconcile,
      { immediate: true },
    )
    reconcile()
    runtimeStop = () => runtimeController?.teardown()
  })()

  return initializationPromise
}

export function reconcileLmaNotificationRuntime(): void {
  runtimeReconcile?.()
}

export function reconcileCanNotificationRuntime(): void { canRuntimeReconcile?.() }
export function getCanNotificationController(): CanNotificationController | null { return canRuntimeController }
export async function triggerCanNotificationRuntime(): Promise<void> { await canRuntimeController?.trigger() }

export function isLmaNotificationRuntimeManaged(): boolean {
  return runtimeManaged
}
