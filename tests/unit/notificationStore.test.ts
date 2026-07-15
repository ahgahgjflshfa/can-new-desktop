import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/tauri/window'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import { useAuthStore } from '@/stores/authStore'
import { completeTask, replyTask } from '@/services/taskActionService'
import { completeCanTask, fetchCanTasks } from '@/services/canTaskService'
import { getCanNotificationController, initializeNotificationRuntime, teardownNotificationRuntime } from '@/services/lmaNotificationRuntime'
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

describe('notificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    teardownNotificationRuntime()
    const testStore = useNotificationStore()
    testStore.notifications = []
    testStore.canRuntimeActive = true
    testStore.canTasksSnapshot = []
    vi.clearAllMocks()
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

      authStore.lmaSession = null
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
