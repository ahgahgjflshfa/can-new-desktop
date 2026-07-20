import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { watch, type WatchStopHandle } from 'vue'
import { fetchNotifications } from '@/services/notificationDataSource'
import { logAppEvent } from '@/services/appLogger'
import { isSystemType } from '@/types/system'
import type { SystemType } from '@/types/system'
import { CanNotificationController } from '@/services/canNotificationRuntime'
import type { CanTask } from '@/types/can'
import { ChargeNotificationController } from '@/services/chargeNotificationRuntime'
import type { ChargeRuntimeContext } from '@/services/chargeNotificationRuntime'
import type { ChargeTask } from '@/types/charge'

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
  handleNewNotifications: (notifications: Awaited<ReturnType<typeof fetchNotifications>>['notifications'], system?: Exclude<SystemType, 'charge'>) => void
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
  chargePollingEnabled?: boolean
  chargePollingIntervalMs?: number
  setChargeSnapshot?: (tasks: ChargeTask[], context?: ChargeRuntimeContext) => void
  setChargePollingError?: (error: string | null, context?: ChargeRuntimeContext) => void
  setChargeRuntimeState?: (active: boolean, context?: ChargeRuntimeContext) => void
  setChargeRequestState?: (inFlight: boolean, context?: ChargeRuntimeContext) => void
  clearChargeState?: () => void
  getSystemSession?: (system: Exclude<SystemType, 'charge'>) => { token: string } | null
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
let chargeRuntimeController: ChargeNotificationController | null = null
let chargeRuntimeWatchStop: WatchStopHandle | null = null
let previousCanCredentials = { token: null as string | null, station: null as string | null }
let previousChargeCredentials = { token: null as string | null, station: null as string | null }

function getCanStation(authStore: { getSystemSession: (system: Exclude<SystemType, 'charge'>) => { token: string; user?: unknown } | null }): string | null {
  const user = authStore.getSystemSession('can')?.user
  return user && typeof user === 'object' && 'station' in user && typeof user.station === 'string' ? user.station : null
}
function getChargeStation(authStore: { getSystemSession: (system: Exclude<SystemType, 'charge'>) => { token: string; user?: unknown } | null }): string | null {
  const getSession = authStore.getSystemSession as unknown as (system: SystemType) => { token: string; user?: unknown } | null
  const user = getSession('charge')?.user
  return user && typeof user === 'object' && 'station' in user && typeof user.station === 'string' ? user.station.trim() || null : null
}
function chargeContextCurrent(context: ChargeRuntimeContext, authStore: { getSystemSession: (system: Exclude<SystemType, 'charge'>) => { token: string; user?: unknown } | null }): boolean {
  const getSession = authStore.getSystemSession as unknown as (system: SystemType) => { token: string; user?: unknown } | null
  return context.controller === chargeRuntimeController && context.generation === context.controller.getGeneration() &&
    context.token === getSession('charge')?.token?.trim() && context.station === getChargeStation(authStore)
}
let runtimeUnlisteners: UnlistenFn[] = []

export function getLmaNotificationController(): LmaNotificationController | null {
  return runtimeController
}

export function teardownNotificationRuntime(): void {
  runtimeEpoch++
  canRuntimeController?.teardown()
  chargeRuntimeController?.teardown()
  chargeRuntimeController = null
  canRuntimeController = null
  runtimeController?.teardown()
  runtimeController = null
  runtimeStop?.()
  runtimeStop = null
  runtimeWatchStop?.()
  runtimeWatchStop = null
  canRuntimeWatchStop?.()
  canRuntimeWatchStop = null
  chargeRuntimeWatchStop?.()
  chargeRuntimeWatchStop = null
  canRuntimeReconcile = null
  previousCanCredentials = { token: null, station: null }
  previousChargeCredentials = { token: null, station: null }
  runtimeReconcile = null
  for (const unlisten of runtimeUnlisteners.splice(0)) unlisten()
  initializationPromise = null
  runtimeManaged = false
}

export function initializeNotificationRuntime(options: {
  notificationStore: RuntimeStore
  authStore: { getSystemSession: (system: Exclude<SystemType, 'charge'>) => { token: string; user?: unknown } | null }
  onOpenSystem: (system: SystemType) => void
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
    chargeRuntimeController = new ChargeNotificationController({
      onSnapshot: (tasks, context) => { if (chargeContextCurrent(context, authStore)) notificationStore.setChargeSnapshot?.(tasks, context) },
      onError: (error, context) => { if (chargeContextCurrent(context, authStore)) notificationStore.setChargePollingError?.(error.message, context) },
      onForbidden: context => {
        if (!chargeContextCurrent(context, authStore)) return
        notificationStore.clearChargeState?.()
        ;(authStore as unknown as { clearSession: (system: 'charge') => void }).clearSession('charge')
      },
      onRequestStarted: context => { if (chargeContextCurrent(context, authStore)) notificationStore.setChargeRequestState?.(true, context) },
      onRequestFinished: context => { if (chargeContextCurrent(context, authStore)) notificationStore.setChargeRequestState?.(false, context) },
      onStopped: context => {
        if (context.controller !== chargeRuntimeController || context.generation !== context.controller.getGeneration()) return
        if (!context.token || chargeContextCurrent(context, authStore)) notificationStore.setChargeRuntimeState?.(false, context)
      },
      onStarted: context => { if (chargeContextCurrent(context, authStore)) notificationStore.setChargeRuntimeState?.(true, context) },
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
      const openUnlisten = await listen<{ system?: unknown }>('open-notification-system', event => {
        const system = event.payload.system
        if (system === undefined) {
          options.onOpenSystem('lma')
        } else if (isSystemType(system)) {
          options.onOpenSystem(system)
        } else {
          logAppEvent('warn', 'notifications', 'refused open-system event with unknown system', { system })
        }
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
      chargeRuntimeController?.teardown()
      chargeRuntimeController = null
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
    chargeRuntimeWatchStop = watch(
      () => [getChargeStation(authStore), notificationStore.chargePollingEnabled ?? false, notificationStore.chargePollingIntervalMs ?? 10000,
        (authStore.getSystemSession as unknown as (system: SystemType) => { token: string } | null)('charge')?.token ?? null],
      () => {
        const getSession = authStore.getSystemSession as unknown as (system: SystemType) => { token: string } | null
        const token = getSession('charge')?.token ?? null
        const station = getChargeStation(authStore)
        if (previousChargeCredentials.token !== token || previousChargeCredentials.station !== station) {
          notificationStore.clearChargeState?.()
          previousChargeCredentials = { token, station }
        }
        chargeRuntimeController?.reconcile({
          enabled: notificationStore.chargePollingEnabled ?? false,
          intervalMs: notificationStore.chargePollingIntervalMs ?? 10000,
          token,
          station,
        })
      },
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
export function getChargeNotificationController(): ChargeNotificationController | null { return chargeRuntimeController }
export async function triggerCanNotificationRuntime(): Promise<void> { await canRuntimeController?.trigger() }
export async function triggerChargeNotificationRuntime(): Promise<void> { await chargeRuntimeController?.trigger() }

export function isLmaNotificationRuntimeManaged(): boolean {
  return runtimeManaged
}
