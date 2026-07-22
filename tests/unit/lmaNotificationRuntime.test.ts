import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { createPinia, setActivePinia } from 'pinia'
import {
  initializeNotificationRuntime,
  LmaNotificationController,
  getLmaPrincipal,
  teardownNotificationRuntime,
  getLmaNotificationController,
  getCanNotificationController,
  getChargeNotificationController,
} from '@/services/lmaNotificationRuntime'
import { fetchNotifications } from '@/services/notificationDataSource'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'

const legacyPoller = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), updateConfig: vi.fn(), triggerPoll: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@/services/notificationDataSource', () => ({ fetchNotifications: vi.fn() }))
vi.mock('@/services/notificationPoller', () => ({
  getNotificationPoller: vi.fn(() => legacyPoller),
  convertToNotificationState: vi.fn((notification: unknown) => ({ ...notification as object, status: 'pending' })),
}))

describe('LMA notification runtime', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownNotificationRuntime()
    vi.useRealTimers()
  })

  test('coalesces scheduled/manual polls and never overlaps requests', async () => {
    let resolveFirst!: (value: { notifications: []; serverTime: string }) => void
    vi.mocked(fetchNotifications).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValue({ notifications: [], serverTime: 'later' })
    const snapshots: unknown[] = []
    const controller = new LmaNotificationController({
      onSnapshot: snapshot => snapshots.push(snapshot),
      onError: vi.fn(),
    })

    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'lma-token' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchNotifications).toHaveBeenCalledTimes(1)

    void controller.trigger()
    void controller.trigger()
    expect(fetchNotifications).toHaveBeenCalledTimes(1)

    resolveFirst({ notifications: [], serverTime: 'first' })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchNotifications).toHaveBeenCalledTimes(2)
    expect(snapshots).toHaveLength(2)
  })

  test('passes the raw bearer token and accepts its snapshot under a separate principal', async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [], serverTime: 'accepted',
    })
    const onSnapshot = vi.fn()
    const controller = new LmaNotificationController({ onSnapshot, onError: vi.fn() })
    const token = 'Bearer exact-token-value'
    controller.reconcile({ enabled: true, intervalMs: 1000, token, principal: 'accepted-principal' })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchNotifications).toHaveBeenCalledWith(undefined, undefined, token)
    expect(onSnapshot).toHaveBeenCalledWith([], 'accepted-principal')
    expect(onSnapshot.mock.calls[0]?.[1]).not.toBe(token)
  })

  test('principal is a stable irreversible SHA-256 identity', async () => {
    const first = await getLmaPrincipal('token-a')
    expect(first).toBe('lma:a70bf50e531ce1a817561f2f5d5b6645d4e806becf58ccc5e8cf6b8045a090a8')
    expect(first).not.toContain('token-a')
    expect(first).not.toBe(`lma:${btoa('token-a')}`)
    expect(await getLmaPrincipal('token-a')).toBe(first)
    expect(await getLmaPrincipal('token-b')).not.toBe(first)
  })

  test('discards an in-flight result after generation changes', async () => {
    let resolveRequest!: (value: { notifications: []; serverTime: string }) => void
    vi.mocked(fetchNotifications).mockReturnValue(new Promise(resolve => { resolveRequest = resolve }))
    const onSnapshot = vi.fn()
    const controller = new LmaNotificationController({ onSnapshot, onError: vi.fn() })

    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'old-token' })
    await vi.advanceTimersByTimeAsync(0)
    controller.reconcile({ enabled: false, intervalMs: 1000, token: null })
    resolveRequest({ notifications: [], serverTime: 'stale' })
    await vi.runAllTimersAsync()

    expect(onSnapshot).not.toHaveBeenCalled()
  })

  test('token rotation discards old result and immediately polls with the new token', async () => {
    let resolveOld!: (value: { notifications: []; serverTime: string }) => void
    vi.mocked(fetchNotifications).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue({ notifications: [], serverTime: 'new' })
    const controller = new LmaNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'old' })
    await vi.advanceTimersByTimeAsync(0)

    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'new' })
    resolveOld({ notifications: [], serverTime: 'old' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchNotifications).toHaveBeenNthCalledWith(2, undefined, undefined, 'new')
  })

  test('interval change during a request does not leave the controller stopped', async () => {
    let resolveOld!: (value: { notifications: []; serverTime: string }) => void
    vi.mocked(fetchNotifications).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue({ notifications: [], serverTime: 'updated' })
    const controller = new LmaNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'token' })
    await vi.advanceTimersByTimeAsync(0)

    controller.reconcile({ enabled: true, intervalMs: 250, token: 'token' })
    resolveOld({ notifications: [], serverTime: 'old' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchNotifications).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchNotifications).toHaveBeenCalledTimes(3)
  })

  test('stop then restart during a request resumes polling with the restarted config', async () => {
    let resolveOld!: (value: { notifications: []; serverTime: string }) => void
    vi.mocked(fetchNotifications).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue({ notifications: [], serverTime: 'restarted' })
    const controller = new LmaNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'old' })
    await vi.advanceTimersByTimeAsync(0)

    controller.reconcile({ enabled: false, intervalMs: 1000, token: null })
    controller.reconcile({ enabled: true, intervalMs: 500, token: 'restarted' })
    resolveOld({ notifications: [], serverTime: 'old' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchNotifications).toHaveBeenNthCalledWith(2, undefined, undefined, 'restarted')
  })

  test('initialization registers once, cleans partial listeners, and can retry', async () => {
    const unlisten = vi.fn()
    vi.mocked(listen)
      .mockResolvedValueOnce(unlisten)
      .mockRejectedValueOnce(new Error('listener failed'))
    const notificationStore = {
      pollingEnabled: false,
      pollingIntervalMs: 1000,
      loadFromStorage: vi.fn(),
      handleNewNotifications: vi.fn(),
      setPollingError: vi.fn(),
      setLmaRuntimeState: vi.fn(),
    }
    const authStore = { getSystemSession: vi.fn(() => ({ token: 'lma-token' })) }
    const options = { notificationStore, authStore, onOpenSystem: vi.fn() }

    await expect(initializeNotificationRuntime(options)).rejects.toThrow('listener failed')
    expect(unlisten).toHaveBeenCalledTimes(1)

    vi.mocked(listen).mockResolvedValue(unlisten)
    await initializeNotificationRuntime(options)
    await initializeNotificationRuntime(options)
    await Promise.resolve()
    await Promise.resolve()
    expect(notificationStore.loadFromStorage).toHaveBeenCalledTimes(2)
    expect(listen).toHaveBeenCalledTimes(5)
  })

  test('deferred listener teardown leaves no charge resources and retry installs exactly one set', async () => {
    let resolveFirst!: (unlisten: () => void) => void
    const staleUnlisten = vi.fn()
    vi.mocked(listen).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
    const authStore = {
      getSystemSession: vi.fn((system: string) => system === 'charge'
        ? { token: 'charge-token', user: { station: 'S1' } }
        : null),
    }
    const notificationStore = {
      pollingEnabled: false, pollingIntervalMs: 1000,
      canPollingEnabled: false, canPollingIntervalMs: 1000,
      chargePollingEnabled: true, chargePollingIntervalMs: 1000,
      loadFromStorage: vi.fn(), handleNewNotifications: vi.fn(),
      setChargeRuntimeState: vi.fn(), setChargeRequestState: vi.fn(),
      setChargeSnapshot: vi.fn(), setChargePollingError: vi.fn(), clearChargeState: vi.fn(),
    }
    const pending = initializeNotificationRuntime({ notificationStore, authStore: authStore as never, onOpenSystem: vi.fn() })
    teardownNotificationRuntime()
    resolveFirst(staleUnlisten)
    await pending
    expect(getChargeNotificationController()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(staleUnlisten).toHaveBeenCalledTimes(1)

    vi.mocked(listen).mockResolvedValue(() => {})
    await initializeNotificationRuntime({ notificationStore, authStore: authStore as never, onOpenSystem: vi.fn() })
    expect(getChargeNotificationController()).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    expect(vi.mocked(listen)).toHaveBeenCalledTimes(4)
  })

  test('routes charge through the main-window listener boundary and refuses unknown systems', async () => {
    const listeners: Array<(event: { payload: { system?: unknown } }) => void> = []
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      listeners.push(callback as (event: { payload: { system?: unknown } }) => void)
      return () => {}
    })
    const onOpenSystem = vi.fn()
    const notificationStore = {
      pollingEnabled: false,
      pollingIntervalMs: 1000,
      loadFromStorage: vi.fn(),
      handleNewNotifications: vi.fn(),
    }
    const authStore = { getSystemSession: vi.fn(() => null) }

    await initializeNotificationRuntime({ notificationStore, authStore, onOpenSystem })
    listeners[2]!({ payload: { system: 'charge' } })
    listeners[2]!({ payload: { system: 'can' } })
    listeners[2]!({ payload: { system: 'unknown' } })
    listeners[2]!({ payload: {} })

    expect(onOpenSystem.mock.calls.map(([system]) => system)).toEqual(['charge', 'can', 'lma'])
  })

  test('failed initialization keeps settings and manual refresh off the legacy poller until retry', async () => {
    const store = useNotificationStore()
    const authStore = useAuthStore()
    authStore.lmaSession = { token: 'lma-token', user: { name: 'LMA', stationId: 'A1', sectionId: null, role: 'staff' } }
    vi.mocked(listen).mockRejectedValueOnce(new Error('listener failed'))
    const options = { notificationStore: store, authStore, onOpenSystem: vi.fn() }

    await expect(initializeNotificationRuntime(options)).rejects.toThrow('listener failed')
    expect(store.lmaRuntimeActive).toBe(false)
    store.setPollingEnabled(false)
    store.setPollingEnabled(true)
    store.setPollingInterval(20)
    await store.manualRefresh()
    expect(store.lmaRuntimeActive).toBe(false)
    expect(legacyPoller.start).not.toHaveBeenCalled()
    expect(legacyPoller.updateConfig).not.toHaveBeenCalled()
    expect(legacyPoller.triggerPoll).not.toHaveBeenCalled()

    vi.mocked(listen).mockResolvedValue(vi.fn())
    vi.mocked(fetchNotifications).mockResolvedValue({ notifications: [], serverTime: 'now' })
    await initializeNotificationRuntime(options)
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(legacyPoller.start).not.toHaveBeenCalled()
    expect(fetchNotifications).toHaveBeenCalledTimes(1)
    expect(store.lmaRuntimeActive).toBe(true)
  })

  test('cancels deferred listener initialization before installing resources and retries once', async () => {
    let resolveFirst!: (unlisten: () => void) => void
    const lateUnlisten = vi.fn()
    const retryUnlisten = vi.fn()
    vi.mocked(listen).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValue(retryUnlisten)
    const notificationStore = {
      pollingEnabled: false,
      pollingIntervalMs: 1000,
      canPollingEnabled: false,
      loadFromStorage: vi.fn(),
      handleNewNotifications: vi.fn(),
      setPollingError: vi.fn(),
      setLmaRuntimeState: vi.fn(),
    }
    const authStore = { getSystemSession: vi.fn(() => ({ token: 'lma-token' })) }
    const initialization = initializeNotificationRuntime({ notificationStore, authStore, onOpenSystem: vi.fn() })

    teardownNotificationRuntime()
    resolveFirst(lateUnlisten)
    await initialization

    expect(lateUnlisten).toHaveBeenCalledTimes(1)
    expect(getLmaNotificationController()).toBeNull()
    expect(getCanNotificationController()).toBeNull()
    expect(fetchNotifications).not.toHaveBeenCalled()

    await initializeNotificationRuntime({ notificationStore, authStore, onOpenSystem: vi.fn() })
    expect(listen).toHaveBeenCalledTimes(4)
    expect(retryUnlisten).not.toHaveBeenCalled()
    expect(getLmaNotificationController()).not.toBeNull()
    expect(getCanNotificationController()).not.toBeNull()
  })
})
