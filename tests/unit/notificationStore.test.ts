import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/tauri/window'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import { useAuthStore } from '@/stores/authStore'
import { completeTask, replyTask } from '@/services/taskActionService'
import { completeCanTask, fetchCanTasks } from '@/services/canTaskService'
import { completeChargeTask, fetchChargeTasks } from '@/services/chargeTaskService'
import type { ChargeTask } from '@/types/charge'
import { getCanNotificationController, getChargeNotificationController, initializeNotificationRuntime, teardownNotificationRuntime } from '@/services/lmaNotificationRuntime'
import type { CanTask } from '@/types/can'
import type { EmergencyNotification } from '@/types/notification'

// Create a shared mock poller instance that persists across calls
const mockPoller = {
  start: vi.fn(),
  stop: vi.fn(),
  isActive: vi.fn(() => false),
  updateConfig: vi.fn(),
  getConfig: vi.fn(() => ({ serverUrl: 'mock', intervalMs: 10000 })),
  getStats: vi.fn(() => ({
    lastPollTime: null,
    nextPollTime: null,
    pollCount: 0,
    successCount: 0,
    errorCount: 0,
    lastError: null,
    isConnected: false,
  })),
}

vi.mock('@/services/notificationPoller', () => ({
  getNotificationPoller: vi.fn(() => mockPoller),
  convertToNotificationState: vi.fn((notification: EmergencyNotification) => ({
    ...notification,
    status: 'pending',
  })),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@/tauri/window', () => ({
  isTauriRuntime: vi.fn(() => false),
}))

vi.mock('@/services/taskActionService', () => ({
  replyTask: vi.fn(),
  completeTask: vi.fn(),
}))

vi.mock('@/services/canTaskService', () => ({
  fetchCanTasks: vi.fn(),
  completeCanTask: vi.fn(),
}))

vi.mock('@/services/chargeTaskService', () => ({
  completeChargeTask: vi.fn(),
  fetchChargeTasks: vi.fn(),
  isChargeForbidden: (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: number }).status === 403,
}))

describe('notificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    teardownNotificationRuntime()
    const testStore = useNotificationStore()
    testStore.notifications = []
    testStore.canRuntimeActive = true
    testStore.canTasksSnapshot = []
    vi.clearAllMocks()
    vi.mocked(completeChargeTask).mockReset()
    vi.mocked(fetchChargeTasks).mockReset()
    vi.mocked(isTauriRuntime).mockReturnValue(false)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })

    // Mock localStorage
    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key]
      }),
      clear: vi.fn(() => {
        for (const key of Object.keys(storage)) {
          delete storage[key]
        }
      }),
    })
  })

  afterEach(() => {
    const store = useNotificationStore()
    store.teardown()
    store.notifications = []
    store.currentNotification = null
    store.canTasksSnapshot = []
    store.canHasSnapshot = false
    teardownNotificationRuntime()
  })

  function createMockNotification(overrides: Partial<EmergencyNotification> = {}): EmergencyNotification {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    return {
      id,
      title: 'Test Alert',
      body: 'Test notification body',
      priority: 'pending',
      createdAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      ...overrides,
    }
  }

  function storeLmaAuthToken() {
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token' }))
  }

  describe('init', () => {
    test('hydrates charge settings/notifications, refuses unknown source, and normalizes charge IDs', () => {
      localStorage.setItem('tauri-app:notification-settings', JSON.stringify({ chargePollingEnabled: false, chargePollingIntervalMs: 20_000 }))
      localStorage.setItem('tauri-app:notifications', JSON.stringify([
        { id: '7', title: 'charge', body: 'b', priority: 'pending', status: 'pending', createdAt: '2026-01-01', receivedAt: '2026-01-01', metadata: { system: 'charge', serialNumber: 7 } },
        { id: 'bad', title: 'bad', body: 'b', priority: 'pending', status: 'pending', createdAt: '2026-01-01', receivedAt: '2026-01-01', metadata: { system: 'other' } },
      ]))
      const store = useNotificationStore()
      store.loadFromStorage()
      expect(store.chargePollingEnabled).toBe(false)
      expect(store.chargePollingIntervalMs).toBe(20_000)
      expect(store.notifications.map(n => n.id)).toEqual(['charge:7'])
    })

    test('starts polling by default when lma is logged in', async () => {
      storeLmaAuthToken()
      const store = useNotificationStore()

      await store.init()

      expect(mockPoller.start).toHaveBeenCalled()
      expect(store.isPolling).toBe(true)
    })

    test('does not start polling before lma login', async () => {
      const store = useNotificationStore()

      await store.init()

      expect(mockPoller.start).not.toHaveBeenCalled()
      expect(store.isPolling).toBe(false)
      expect(store.lastError).toBeNull()
    })

    test('clamps invalid persisted polling interval', async () => {
      storeLmaAuthToken()
      localStorage.setItem(
        'tauri-app:notification-settings',
        JSON.stringify({ pollingEnabled: true, pollingIntervalMs: 0 })
      )
      const store = useNotificationStore()

      await store.init()

      expect(store.pollingIntervalMs).toBe(5000)
      expect(mockPoller.updateConfig).toHaveBeenCalledWith({ intervalMs: 5000 })
    })
  })

  describe('handleNewNotifications', () => {
    test('isolates LMA hydration and credential changes without clearing other systems', () => {
      const store = useNotificationStore()
      store.setLmaPrincipal('account-a')
      store.handleNewNotifications([createMockNotification({ id: 'a', metadata: { system: 'lma' } })], 'lma', 'account-a')
      store.handleCanTasks([{ serialNumber: 1, station: 'A1', trashBin: 'bin', isDone: false, cleanAt: null, informTime: 0, resolutionType: 0, visitorID: null, isDisable: false, createdAt: 'now', updatedAt: 'now' } as CanTask])

      store.setLmaPrincipal('account-b')

      expect(store.notifications.map(n => n.id)).toEqual(['can:1'])
      expect(store.currentNotification?.metadata?.system).toBe('can')
    })

    test('hydrates only persisted LMA notifications for the active principal', () => {
      localStorage.setItem('tauri-app:notifications', JSON.stringify([
        { ...createMockNotification({ id: 'a', metadata: { system: 'lma', principal: 'account-a' } }), status: 'pending' },
        { ...createMockNotification({ id: 'b', metadata: { system: 'lma', principal: 'account-b' } }), status: 'pending' },
        { ...createMockNotification({ id: 'can', metadata: { system: 'can' } }), status: 'pending' },
      ]))
      const store = useNotificationStore()
      store.loadFromStorage('account-b')

      expect(store.notifications.map(n => n.id)).toEqual(['b', 'can'])
    })

    test('rejects stale LMA snapshots after principal changes', () => {
      const store = useNotificationStore()
      store.setLmaPrincipal('account-a')
      store.setLmaPrincipal('account-b')
      store.handleNewNotifications([createMockNotification({ id: 'stale-a', metadata: { system: 'lma' } })], 'lma', 'account-a')

      expect(store.notifications).toHaveLength(0)
    })

    test('real charge completion fences a deferred poll and performs one authoritative refresh', async () => {
      const store = useNotificationStore()
      const authStore = useAuthStore()
      authStore.chargeSession = { token: 'charge-token', user: { name: 'Charge', account: 'charge', station: ' S1 ', system: 'charge' } }
      store.chargePollingEnabled = true
      store.chargePollingIntervalMs = 60_000
      const task = { serialNumber: 701, deviceCode: 'D1', station: 'S1', status: 'pending', faultDescription: 'fault', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' } as ChargeTask
      let resolveOld!: (tasks: ChargeTask[]) => void
      vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce([])
      vi.mocked(completeChargeTask).mockResolvedValue(undefined)
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      const controller = getChargeNotificationController()
      expect(controller).not.toBeNull()
      await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(1))
      store.setChargeSnapshot([task])
      store.setChargeRuntimeState(true)
      await store.completeChargeTask(701)
      expect(fetchChargeTasks).toHaveBeenCalledTimes(1)
      resolveOld([task])
      await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(2))
      expect(store.chargeTasksSnapshot).toEqual([])
      expect(store.notifications.find(n => n.id === 'charge:701')?.status).toBe('dismissed')
      expect(store.currentNotification?.id).not.toBe('charge:701')
    })

    test('charge popup counts and cleanup are isolated from LMA/CAN handoff', async () => {
      const store = useNotificationStore()
      useAuthStore().chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      store.setChargeRuntimeState(true); store.setCanRuntimeState(true); store.setLmaRuntimeState(true)
      store.handleNewNotifications([createMockNotification({ id: 'lma-only', metadata: { system: 'lma' } })], 'lma')
      store.setChargeSnapshot([{ serialNumber: 12, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' } as ChargeTask])
      expect(store.pendingAlertCount).toBe(2)
      store.clearChargeState()
      await Promise.resolve()
      expect(store.notifications.find(n => n.id === 'lma-only')?.status).not.toBe('dismissed')
      expect(store.notifications.find(n => n.id === 'charge:12')).toBeUndefined()
      expect(store.pendingAlertCount).toBe(1)
    })

    test('charge snapshots enforce station and the five status cases', () => {
      const store = useNotificationStore()
      const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: ' S1 ', system: 'charge' } }
      store.setChargeRuntimeState(true)
      const base = { serialNumber: 1, deviceCode: 'D', station: 'S1', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' }
      store.setChargeSnapshot([
        { ...base, serialNumber: 1, status: 'pending' },
        { ...base, serialNumber: 2, status: ' PROCESSING ' },
        { ...base, serialNumber: 3, status: 'done' },
        { ...base, serialNumber: 4, status: 'cancelled' },
        { ...base, serialNumber: 5, status: 'unknown' },
        { ...base, serialNumber: 6, station: 'S2', status: 'pending' },
      ] as ChargeTask[])
      expect(store.chargeTasksSnapshot.map(t => t.serialNumber)).toEqual([1, 2])
      expect(store.chargeTasksSnapshot[1]?.status).toBe('processing')
      expect(store.notifications.map(n => n.id)).toEqual(expect.arrayContaining(['charge:1', 'charge:2']))
      expect(store.notifications.map(n => n.id)).not.toEqual(expect.arrayContaining(['charge:3', 'charge:4', 'charge:5', 'charge:6']))
    })

    test('charge completion 403 clears current credentials but stale 403 does not', async () => {
      const store = useNotificationStore()
      const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      vi.mocked(fetchChargeTasks).mockResolvedValue([])
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      const task = { serialNumber: 9, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' } as ChargeTask
      store.setChargeSnapshot([task]); store.setChargeRuntimeState(true)
      vi.mocked(completeChargeTask).mockRejectedValueOnce({ status: 403, message: 'forbidden' })
      await expect(store.completeChargeTask(9)).rejects.toMatchObject({ status: 403 })
      expect(authStore.getSystemSession('charge')).toBeNull()
      expect(getChargeNotificationController()?.isUsable()).toBe(false)
      expect(store.chargeRuntimeActive).toBe(false)
      expect(store.chargeRequestInFlight).toBe(false)
      authStore.chargeSession = { token: 't2', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      store.setChargeSnapshot([task]); store.setChargeRuntimeState(true)
      const controller = getChargeNotificationController()
      controller?.reconcile({ enabled: true, intervalMs: 1000, token: 't2', station: 'S1' })
      let rejectStale!: (error: unknown) => void
      vi.mocked(completeChargeTask).mockReturnValueOnce(new Promise((_, reject) => { rejectStale = reject }))
      const staleCompletion = store.completeChargeTask(9)
      controller?.invalidate()
      rejectStale({ status: 403, message: 'stale' })
      await expect(staleCompletion).rejects.toMatchObject({ status: 403 })
      expect(authStore.getSystemSession('charge')?.token).toBe('t2')
    })

    test('idle successful charge completion performs exactly one authoritative fetch', async () => {
      const store = useNotificationStore(); const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      store.chargePollingEnabled = false
      vi.mocked(fetchChargeTasks).mockResolvedValue([])
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      store.setChargePollingEnabled(true)
      await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(1))
      const task = { serialNumber: 12, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' } as ChargeTask
      store.setChargeSnapshot([task]); store.setChargeRuntimeState(true)
      vi.mocked(completeChargeTask).mockResolvedValueOnce(undefined)
      await store.completeChargeTask(12)
      await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(2))
      expect(store.chargeTasksSnapshot).toEqual([])
    })

    test('charge runtime teardown clears active and request state', async () => {
      const store = useNotificationStore(); const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      store.setChargeRuntimeState(true); store.setChargeRequestState(true)
      teardownNotificationRuntime()
      expect(store.chargeRuntimeActive).toBe(false)
      expect(store.chargeRequestInFlight).toBe(false)
    })

    test('polling 403 cleanup is charge-only and stale old-credential 403 preserves new charge session', async () => {
      const store = useNotificationStore(); const authStore = useAuthStore()
      authStore.lmaSession = { token: 'lma', user: { name: 'LMA', stationId: 'A', sectionId: null, role: 'staff' } }
      authStore.canSession = { token: 'can', user: { name: 'CAN', station: 'C', topic: 'cleaning' } }
      authStore.chargeSession = { token: 'old', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      store.chargePollingEnabled = true
      vi.mocked(fetchChargeTasks).mockRejectedValueOnce({ status: 403, message: 'forbidden' })
      const runtimeAuthStore = { getSystemSession: ((system: string) => authStore.getSystemSession(system as any)) as any, clearSession: (system: 'charge') => authStore.clearSession(system) }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      await vi.waitFor(() => expect(authStore.getSystemSession('charge')).toBeNull())
      expect(authStore.getSystemSession('lma')?.token).toBe('lma')
      expect(authStore.getSystemSession('can')?.token).toBe('can')

      authStore.chargeSession = { token: 'new', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      const controller = getChargeNotificationController()!
      controller.reconcile({ enabled: true, intervalMs: 1000, token: 'old', station: 'S1' })
      let rejectOld!: (error: unknown) => void
      vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise((_, reject) => { rejectOld = reject }))
      void controller.trigger()
      controller.reconcile({ enabled: true, intervalMs: 1000, token: 'new', station: 'S1' })
      rejectOld({ status: 403, message: 'stale' })
      await Promise.resolve(); await Promise.resolve()
      expect(authStore.getSystemSession('charge')?.token).toBe('new')
    })

    test('concurrent charge completion is single-flight and failed completion does not refresh', async () => {
      const store = useNotificationStore(); const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      const task = { serialNumber: 10, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' } as ChargeTask
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      store.setChargeSnapshot([task])
      let reject!: (error: Error) => void
      vi.mocked(completeChargeTask).mockReturnValueOnce(new Promise((_, r) => { reject = r }))
      const first = store.completeChargeTask(10)
      await expect(store.completeChargeTask(10)).rejects.toThrow('正在處理中')
      reject(new Error('offline'))
      await expect(first).rejects.toThrow('offline')
      expect(completeChargeTask).toHaveBeenCalledTimes(1)
    })

    test('idle non-403 completion failure performs zero authoritative refreshes and preserves state', async () => {
      const store = useNotificationStore(); const authStore = useAuthStore()
      authStore.chargeSession = { token: 't', user: { name: 'Charge', account: 'c', station: 'S1', system: 'charge' } }
      store.chargePollingEnabled = false
      vi.mocked(fetchChargeTasks).mockResolvedValue([])
      const runtimeAuthStore = { getSystemSession: ((system: string) => system === 'charge' ? authStore.chargeSession : null) as any, clearSession: vi.fn() }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      store.setChargePollingEnabled(true)
      await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(1))
      const task = { serialNumber: 11, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'f', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' } as ChargeTask
      store.setChargeSnapshot([task]); store.setChargeRuntimeState(true)
      vi.mocked(completeChargeTask).mockRejectedValueOnce(new Error('offline'))
      await expect(store.completeChargeTask(11)).rejects.toThrow('offline')
      expect(fetchChargeTasks).toHaveBeenCalledTimes(1)
      expect(store.chargeTasksSnapshot).toEqual([task])
      expect(store.notifications.find(n => n.id === 'charge:11')?.status).not.toBe('dismissed')
    })
    test('real CAN completion fences deferred poll and performs one authoritative refresh', async () => {
      const store = useNotificationStore()
      const authStore = useAuthStore()
      authStore.canSession = { token: 'can-token', user: { name: 'CAN', station: 'C1', topic: 'cleaning' } }
      store.canPollingEnabled = true
      store.canPollingIntervalMs = 60_000
      const task = {
        serialNumber: 701,
        station: 'C1',
        trashBin: 'bin',
        isDone: false,
        cleanAt: null,
        informTime: 1,
        resolutionType: 0,
        visitorID: null,
        isDisable: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as CanTask
      let resolveOld!: (tasks: CanTask[]) => void
      vi.mocked(fetchCanTasks).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
        .mockResolvedValueOnce([])
      vi.mocked(completeCanTask).mockResolvedValue(undefined)
      const runtimeAuthStore = { getSystemSession: (system: 'lma' | 'can') => system === 'can' ? authStore.canSession : null }
      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      const controller = getCanNotificationController()
      expect(controller).not.toBeNull()
      await vi.waitFor(() => expect(fetchCanTasks).toHaveBeenCalledTimes(1))

      store.setCanSnapshot([task])
      await store.completeCanTask(701, 1)
      expect(completeCanTask).toHaveBeenCalledWith('can-token', 701, true, 1)
      expect(fetchCanTasks).toHaveBeenCalledTimes(1)
      resolveOld([task])
      await vi.waitFor(() => expect(fetchCanTasks).toHaveBeenCalledTimes(2))
      await Promise.resolve()

      expect(store.canTasksSnapshot).toEqual([])
      expect(store.notifications.find(notification => notification.id === 'can:701')?.status).toBe('dismissed')
      expect(store.currentNotification?.id).not.toBe('can:701')
      expect(fetchCanTasks).toHaveBeenCalledTimes(2)
    })

    test('tracks authoritative CAN snapshot/error state and filters inactive CAN unread count', () => {
      const store = useNotificationStore()
      const canTask = {
        serialNumber: 700,
        station: 'C1',
        trashBin: 'bin',
        isDone: false,
        cleanAt: null,
        informTime: 1,
        resolutionType: 0,
        visitorID: null,
        isDisable: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as CanTask
      store.setCanRuntimeState(true)
      store.setCanSnapshot([canTask])
      expect(store.canHasSnapshot).toBe(true)
      expect(store.canTasksSnapshot).toHaveLength(1)
      expect(store.unreadCount).toBe(1)
      store.setCanPollingError('offline')
      expect(store.canTasksSnapshot).toHaveLength(1)
      store.setCanSnapshot([])
      expect(store.canPollingLastError).toBeNull()
      store.setCanRuntimeState(false)
      expect(store.unreadCount).toBe(0)
    })

    test('managed popup reconciliation serializes deferred operations and hands off after LMA disable', async () => {
      const store = useNotificationStore()
      const authStore = useAuthStore()
      authStore.lmaSession = { token: 'lma-token', user: { name: 'LMA', stationId: 'A1', sectionId: null, role: 'staff' } }
      const getSession = vi.fn<() => { token: string } | null>(() => ({ token: 'lma-token' }))
      const runtimeAuthStore = { getSystemSession: getSession }
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

      let resolveFirst!: () => void
      let inFlight = 0
      let maxInFlight = 0
      const firstOperation = new Promise<void>(resolve => { resolveFirst = resolve })
      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command !== 'show_alert_popup') return undefined
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (inFlight === 1) await firstOperation
        inFlight--
        return undefined
      })

      await initializeNotificationRuntime({ notificationStore: store, authStore: runtimeAuthStore, onOpenSystem: vi.fn() })
      store.setLmaRuntimeState(true)
      store.setCanRuntimeState(true)
      const first = createMockNotification({ id: 'managed-first' })
      const second = createMockNotification({ id: 'managed-second' })
      store.handleNewNotifications([first])
      await vi.waitFor(() => {
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'show_alert_popup')).toHaveLength(1)
      })
      store.handleNewNotifications([second])
      store.dismissNotificationById(first.id)
      await Promise.resolve()
      await Promise.resolve()

      expect(maxInFlight).toBe(1)
      resolveFirst()
      await vi.waitFor(() => {
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'show_alert_popup')).toHaveLength(2)
      })
      expect(maxInFlight).toBe(1)

      const getShowIds = () => vi.mocked(invoke).mock.calls
        .filter(([command]) => command === 'show_alert_popup')
        .map(([, payload]) => (payload as { notification?: { id?: string } }).notification?.id)

      authStore.clearSession('lma')
      runtimeAuthStore.getSystemSession.mockReturnValue(null)
      store.setPollingEnabled(false)
      store.dismissNotificationById(second.id)
      store.handleNewNotifications([createMockNotification({ id: 'inactive-lma' })])
      store.handleCanTasks([{
        serialNumber: 9001,
        station: 'A1',
        trashBin: '1F',
        isDone: false,
        cleanAt: null,
        informTime: 0,
        resolutionType: 0,
        visitorID: null,
        isDisable: false,
        createdAt: '2026-06-12T05:00:00.000Z',
        updatedAt: '2026-06-12T05:00:00.000Z',
      }])
      await store.runReminderCycle()
      await Promise.resolve()
      await Promise.resolve()
      expect(store.currentNotification?.id).toBe('can:9001')
      const showIds = getShowIds()
      const invokeCountAfterReconciliation = vi.mocked(invoke).mock.calls.length
      await Promise.resolve()
      await Promise.resolve()
      expect(vi.mocked(invoke).mock.calls.length).toBe(invokeCountAfterReconciliation)
      expect(showIds).not.toContain('inactive-lma')
      expect(showIds[showIds.length - 1]).toBe('can:9001')
      teardownNotificationRuntime()
    })

    test('adds new notifications to the list', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])

      expect(store.notifications.length).toBe(1)
      expect(store.notifications[0]!.title).toBe(notification.title)
    })

    test('does not add duplicate notifications', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])
      store.handleNewNotifications([notification])

      expect(store.notifications.length).toBe(1)
    })

    test('shows first notification automatically', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()

      store.handleNewNotifications([notification])

      expect(store.currentNotification).not.toBeNull()
      expect(store.currentNotification?.id).toBe(notification.id)
    })

    test('shows popup after the main window loses focus for an already-shown notification', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      useSystemStore().switchView('lma')
      const store = useNotificationStore()
      store.setupWindowFocusListener()

      store.handleNewNotifications([createMockNotification({ id: 'focus-test' })])

      expect(store.currentNotification?.id).toBe('focus-test')
      expect(store.isPopupVisible).toBe(false)
      expect(invoke).not.toHaveBeenCalledWith('show_alert_popup', expect.anything())

      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      window.dispatchEvent(new Event('blur'))
      await Promise.resolve()
      await Promise.resolve()

      expect(invoke).toHaveBeenCalledWith('show_alert_popup', {
        notification: expect.objectContaining({ id: 'focus-test' }),
      })
      expect(store.isPopupVisible).toBe(true)
    })

    test('shows popup for cross-system notifications even when the app is focused', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      useSystemStore().switchView('can')
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: 'cross-system-lma' })])
      await Promise.resolve()

      expect(invoke).toHaveBeenCalledWith('show_alert_popup', {
        notification: expect.objectContaining({
          id: 'cross-system-lma',
          metadata: expect.objectContaining({ system: 'lma' }),
        }),
      })
      expect(store.isPopupVisible).toBe(true)
    })

    test('keeps popup hidden for same-system notifications while the app is focused', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(true)
      useSystemStore().switchView('lma')
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: 'same-system-lma' })])
      await Promise.resolve()

      expect(invoke).not.toHaveBeenCalledWith('show_alert_popup', expect.anything())
      expect(store.isPopupVisible).toBe(false)
    })

    test('resets notification state when showing the popup fails', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      vi.mocked(invoke).mockRejectedValueOnce(new Error('popup failed'))
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: 'popup-error' })])
      await Promise.resolve()
      await Promise.resolve()

      expect(store.currentNotification).toBeNull()
      expect(store.isPopupVisible).toBe(false)
      expect(store.notifications.find(notification => notification.id === 'popup-error')?.status).toBe('pending')
    })

    test('clears a deferred LMA popup after logout without adopting its stale identity', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      let resolveShow!: (value: { revision: number }) => void
      vi.mocked(invoke).mockImplementation((command: string) => command === 'show_alert_popup'
        ? new Promise(resolve => { resolveShow = resolve })
        : Promise.resolve())
      const store = useNotificationStore()
      store.setLmaPrincipal('principal-a')
      const notification = createMockNotification({ id: 'deferred-a', metadata: { system: 'lma', principal: 'principal-a' } })
      store.handleNewNotifications([notification])
      await Promise.resolve()
      store.setLmaPrincipal(null)
      resolveShow({ revision: 41 })
      await Promise.resolve()
      await Promise.resolve()

      expect(store.lmaPopupIdentity).toBeNull()
      expect(invoke).toHaveBeenCalledWith('clear_alert_popup_system', {
        system: 'lma', expectedPrincipal: 'principal-a', expectedRevision: 41,
      })
    })

    test('queues subsequent notifications', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: 'first' })
      const second = createMockNotification({ id: 'second' })

      store.handleNewNotifications([first, second])

      expect(store.currentNotification?.id).toBe('first')
      expect(store.notifications.length).toBe(2)
    })

    test('dismisses current notification when polling reports it completed remotely', () => {
      const store = useNotificationStore()
      const notification = createMockNotification({ id: '1', priority: 'pending' })

      store.handleNewNotifications([notification])
      store.handleNewNotifications([{ ...notification, priority: 'completed', category: 'completed' }])

      expect(store.currentNotification).toBeNull()
      expect(store.notifications[0]!.priority).toBe('completed')
      expect(store.notifications[0]!.status).toBe('dismissed')
      expect(store.notifications[0]!.dismissedAt).toBeDefined()
    })

    test('does not create a new local notification for already completed remote tasks', () => {
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: '1', priority: 'completed' })])

      expect(store.notifications).toHaveLength(0)
      expect(store.currentNotification).toBeNull()
    })

    test('dismisses unresolved local notifications missing from a full polling result', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1', priority: 'pending' })
      const second = createMockNotification({ id: '2', priority: 'pending' })

      store.handleNewNotifications([first, second])
      store.handleNewNotifications([second])

      const missing = store.notifications.find(notification => notification.id === '1')
      expect(missing?.status).toBe('dismissed')
      expect(missing?.dismissedAt).toBeDefined()
      expect(store.currentNotification?.id).toBe('2')
    })
  })

  describe('handleCanTasks', () => {
    function createCanTask(overrides: Partial<CanTask> = {}): CanTask {
      return {
        serialNumber: 123,
        station: 'A1',
        trashBin: '1F 男廁',
        isDone: false,
        cleanAt: null,
        informTime: 0,
        resolutionType: 0,
        visitorID: null,
        isDisable: false,
        createdAt: '2026-06-12T05:00:00.000Z',
        updatedAt: '2026-06-12T05:00:00.000Z',
        ...overrides,
      }
    }

    test('shows a popup notification for new unresolved CAN tasks', async () => {
      vi.mocked(isTauriRuntime).mockReturnValue(true)
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      const store = useNotificationStore()

      store.handleCanTasks([createCanTask()])
      await Promise.resolve()

      expect(store.currentNotification?.id).toBe('can:123')
      expect(store.currentNotification?.metadata?.system).toBe('can')
      expect(invoke).toHaveBeenCalledWith('show_alert_popup', {
        notification: expect.objectContaining({
          id: 'can:123',
          title: 'Q 潔淨立馬清任務',
          category: 'Q 潔淨立馬清',
          metadata: expect.objectContaining({ system: 'can', serialNumber: 123 }),
        }),
      })
    })

    test('does not create popup notifications for completed CAN tasks', () => {
      const store = useNotificationStore()

      store.handleCanTasks([createCanTask({ isDone: true, resolutionType: 1 })])

      expect(store.notifications).toHaveLength(0)
      expect(store.currentNotification).toBeNull()
    })

    test('does not dismiss lma notifications when CAN polling reports no tasks', () => {
      const store = useNotificationStore()
      store.handleNewNotifications([createMockNotification({ id: '42', metadata: { system: 'lma' } })])

      store.handleCanTasks([])

      expect(store.notifications[0]?.status).toBe('shown')
      expect(store.currentNotification?.id).toBe('42')
    })

    test('keeps lma and CAN notifications with the same numeric backend id separate', () => {
      const store = useNotificationStore()

      store.handleNewNotifications([createMockNotification({ id: '123', metadata: { system: 'lma', taskId: 123 } })])
      store.handleCanTasks([createCanTask({ serialNumber: 123 })])

      expect(store.notifications.map(notification => notification.id).sort()).toEqual(['123', 'can:123'])
      expect(store.notifications.find(notification => notification.id === '123')?.metadata?.system).toBe('lma')
      expect(store.notifications.find(notification => notification.id === 'can:123')?.metadata?.system).toBe('can')
    })

    test('prunes stored notifications per system', () => {
      const store = useNotificationStore()
      const lmaNotifications = Array.from({ length: 25 }, (_, index) =>
        createMockNotification({ id: String(index + 1), metadata: { system: 'lma', taskId: index + 1 } })
      )
      const canTasks = Array.from({ length: 25 }, (_, index) => createCanTask({ serialNumber: index + 1 }))

      store.handleNewNotifications(lmaNotifications)
      store.handleCanTasks(canTasks)

      const lmaCount = store.notifications.filter(notification => notification.metadata?.system !== 'can').length
      const canCount = store.notifications.filter(notification => notification.metadata?.system === 'can').length
      expect(lmaCount).toBe(20)
      expect(canCount).toBe(20)
      expect(store.notifications).toHaveLength(40)
    })

    test('does not send CAN notifications through lma task actions', async () => {
      const store = useNotificationStore()
      store.handleCanTasks([createCanTask({ serialNumber: 123 })])

      await store.replyTaskById('can:123')
      await store.completeTaskById('can:123', 'normal')

      expect(replyTask).not.toHaveBeenCalled()
      expect(completeTask).not.toHaveBeenCalled()
      expect(store.taskActionError).toBe('任務編號無效')
    })

    test('routes LMA notification actions to LMA token while CAN is active', async () => {
      const authStore = useAuthStore()
      authStore.lmaSession = { token: 'lma-token', user: { name: 'LMA', stationId: 'A1', sectionId: null, role: 'staff' } }
      authStore.canSession = { token: 'can-token', user: { name: 'CAN', station: 'C1', topic: 'general' } }
      authStore.switchSystem('can')
      vi.mocked(replyTask).mockResolvedValue('replied')
      vi.mocked(completeTask).mockResolvedValue('completed')
      const store = useNotificationStore()
      store.handleNewNotifications([createMockNotification({ id: '42', metadata: { system: 'lma', taskId: 42 } })])

      await store.replyTaskById('42')
      await store.completeTaskById('42', 'normal')

      expect(replyTask).toHaveBeenCalledWith('lma-token', 42)
      expect(completeTask).toHaveBeenCalledWith('lma-token', 42, 'normal')
    })

    test('blocks LMA notification actions before IPC when the LMA session is missing', async () => {
      const authStore = useAuthStore()
      authStore.canSession = { token: 'can-token', user: { name: 'CAN', station: 'C1', topic: 'general' } }
      authStore.switchSystem('can')
      const store = useNotificationStore()
      store.handleNewNotifications([createMockNotification({ id: '42', metadata: { system: 'lma', taskId: 42 } })])

      await store.replyTaskById('42')
      await store.completeTaskById('42', 'normal')

      expect(replyTask).not.toHaveBeenCalled()
      expect(completeTask).not.toHaveBeenCalled()
      expect(store.taskActionError).toContain('立碼幫幫忙')
    })

    test('dismissal does not revive inactive LMA and hands off to CAN', async () => {
      const store = useNotificationStore()
      store.handleNewNotifications([
        createMockNotification({ id: 'lma-inactive', metadata: { system: 'lma' } }),
      ])
      store.lmaRuntimeActive = false
      store.handleCanTasks([createCanTask({ serialNumber: 456 })])

      store.dismissNotificationById('lma-inactive')
      await Promise.resolve()

      expect(store.currentNotification?.id).toBe('can:456')
      expect(store.currentNotification?.metadata?.system).toBe('can')
    })
  })

  describe('dismissCurrentNotification', () => {
    test('marks current notification as dismissed', async () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      await store.dismissCurrentNotification()

      expect(store.currentNotification).toBeNull()
      expect(store.notifications[0]!.status).toBe('dismissed')
      expect(store.notifications[0]!.dismissedAt).toBeDefined()
    })

    test('shows next pending notification', async () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: 'first' })
      const second = createMockNotification({ id: 'second' })

      store.handleNewNotifications([first, second])

      await store.dismissCurrentNotification()

      expect(store.currentNotification?.id).toBe('second')
    })
  })

  describe('dismissAllNotifications', () => {
    test('dismisses all notifications', () => {
      const store = useNotificationStore()
      store.handleNewNotifications([
        createMockNotification({ id: '1' }),
        createMockNotification({ id: '2' }),
        createMockNotification({ id: '3' }),
      ])

      store.dismissAllNotifications()

      expect(store.currentNotification).toBeNull()
      expect(store.notifications.every(n => n.status === 'dismissed')).toBe(true)
    })
  })

  describe('deleteNotification', () => {
    test('removes notification from list', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      store.deleteNotification(notification.id)

      expect(store.notifications.length).toBe(0)
    })

    test('clears current notification if deleted', () => {
      const store = useNotificationStore()
      const notification = createMockNotification()
      store.handleNewNotifications([notification])

      store.deleteNotification(notification.id)

      expect(store.currentNotification).toBeNull()
    })
  })

  describe('clearHistory', () => {
    test('removes only dismissed notifications', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes 'shown', '2' stays pending

      // Find and dismiss notification '2' (which is at index 0 due to unshift)
      const notif2 = store.notifications.find(n => n.id === '2')
      if (notif2) notif2.status = 'dismissed'

      store.clearHistory()

      // Should keep '1' (shown) and remove '2' (dismissed)
      expect(store.notifications.length).toBe(1)
      expect(store.notifications[0]!.id).toBe('1')
    })
  })

  describe('getters', () => {
    test('pendingNotifications returns only pending', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes shown, '2' stays pending

      // '1' is shown, '2' is pending
      expect(store.pendingNotifications.length).toBe(1)
      expect(store.pendingNotifications[0]!.id).toBe('2')
    })

    test('dismissedNotifications returns only dismissed', () => {
      const store = useNotificationStore()
      const first = createMockNotification({ id: '1' })
      const second = createMockNotification({ id: '2' })

      store.handleNewNotifications([first, second]) // '1' becomes shown, '2' stays pending

      // Dismiss the first one (which is 'shown')
      const notif1 = store.notifications.find(n => n.id === '1')
      if (notif1) notif1.status = 'dismissed'

      expect(store.dismissedNotifications.length).toBe(1)
      expect(store.dismissedNotifications[0]!.id).toBe('1')
    })

    test('hasNewNotification returns true when current exists', () => {
      const store = useNotificationStore()

      expect(store.hasNewNotification).toBe(false)

      store.handleNewNotifications([createMockNotification()])

      expect(store.hasNewNotification).toBe(true)
    })

    test('unreadCount returns non-dismissed count', () => {
      const store = useNotificationStore()
      store.handleNewNotifications([
        createMockNotification({ id: '1' }),
        createMockNotification({ id: '2' }),
        createMockNotification({ id: '3' }),
      ])

      // Dismiss one notification
      const notif1 = store.notifications.find(n => n.id === '1')
      if (notif1) notif1.status = 'dismissed'

      expect(store.unreadCount).toBe(2)
    })
  })

  describe('setPollingEnabled', () => {
    test('starts polling when enabled and lma is logged in', () => {
      storeLmaAuthToken()
      const store = useNotificationStore()

      store.setPollingEnabled(true)

      expect(mockPoller.start).toHaveBeenCalled()
    })

    test('does not start polling when enabled before lma login', () => {
      const store = useNotificationStore()

      store.setPollingEnabled(true)

      expect(mockPoller.start).not.toHaveBeenCalled()
      expect(store.isPolling).toBe(false)
      expect(store.lastError).toBeNull()
    })

    test('stops polling when disabled', () => {
      const store = useNotificationStore()

      store.isPolling = true
      store.setPollingEnabled(false)

      expect(mockPoller.stop).toHaveBeenCalled()
    })
  })
})
