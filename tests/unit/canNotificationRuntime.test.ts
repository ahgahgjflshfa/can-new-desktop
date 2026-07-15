import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CanNotificationController } from '@/services/canNotificationRuntime'
import { LmaNotificationController } from '@/services/lmaNotificationRuntime'
import { fetchCanTasks } from '@/services/canTaskService'
import { fetchNotifications } from '@/services/notificationDataSource'

vi.mock('@/services/canTaskService', () => ({ fetchCanTasks: vi.fn() }))
vi.mock('@/services/notificationDataSource', () => ({ fetchNotifications: vi.fn() }))

const config = { enabled: true, intervalMs: 1000, token: 'can-token', station: 'C1' }
const task = (serialNumber: number) => ({ serialNumber, station: 'C1', trashBin: 'bin', isDone: false, cleanAt: null, informTime: 1, resolutionType: 0, visitorID: null, isDisable: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' })

describe('CanNotificationController', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
  afterEach(() => vi.useRealTimers())

  test('polls immediately and recursively at the configured interval', async () => {
    vi.mocked(fetchCanTasks).mockResolvedValue([task(1)])
    const controller = new CanNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile(config)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchCanTasks).toHaveBeenCalledWith('can-token', 'C1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchCanTasks).toHaveBeenCalledTimes(2)
  })

  test('coalesces manual and scheduled triggers without overlapping', async () => {
    let resolve!: (value: any[]) => void
    vi.mocked(fetchCanTasks).mockReturnValueOnce(new Promise(r => { resolve = r })).mockResolvedValue([])
    const controller = new CanNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile(config)
    void controller.trigger(); void controller.trigger()
    await Promise.resolve()
    expect(fetchCanTasks).toHaveBeenCalledTimes(1)
    resolve([])
    await vi.runAllTicks()
    expect(fetchCanTasks).toHaveBeenCalledTimes(2)
  })

  test('fences token/station changes and teardown results', async () => {
    let resolve!: (value: any[]) => void
    vi.mocked(fetchCanTasks).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const onSnapshot = vi.fn()
    const controller = new CanNotificationController({ onSnapshot, onError: vi.fn() })
    controller.reconcile(config)
    await vi.advanceTimersByTimeAsync(0)
    controller.reconcile({ ...config, token: 'new-token', station: 'C2' })
    controller.teardown()
    resolve([task(9)])
    await vi.runAllTicks()
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  test('reports errors and recovers on the next queued poll', async () => {
    const onError = vi.fn(); const onSnapshot = vi.fn()
    vi.mocked(fetchCanTasks).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([task(2)])
    const controller = new CanNotificationController({ onSnapshot, onError })
    controller.reconcile(config)
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSnapshot).toHaveBeenCalledWith([task(2)])
  })

  test('completion fences a deferred poll and only applies the authoritative refresh', async () => {
    let resolveOld!: (value: any[]) => void
    const oldTask = task(10)
    const refreshedTask = task(11)
    const snapshot: any[] = [oldTask]
    const notifications = new Set(['can:10'])
    const popups: string[] = []
    vi.mocked(fetchCanTasks).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce([refreshedTask])
    const onSnapshot = vi.fn((tasks: any[]) => {
      snapshot.splice(0, snapshot.length, ...tasks)
      notifications.clear()
      tasks.filter((item: any) => !item.isDone).forEach((item: any) => notifications.add(`can:${item.serialNumber}`))
      if (tasks.some((item: any) => !item.isDone)) popups.push(`can:${tasks.find((item: any) => !item.isDone).serialNumber}`)
    })
    const controller = new CanNotificationController({ onSnapshot, onError: vi.fn() })
    controller.reconcile(config)
    await vi.advanceTimersByTimeAsync(0)
    controller.invalidate()
    snapshot.splice(0, snapshot.length)
    notifications.delete('can:10')
    await controller.trigger()
    resolveOld([oldTask])
    await vi.runAllTicks()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchCanTasks).toHaveBeenCalledTimes(2)
    expect(snapshot.map(item => item.serialNumber)).toEqual([11])
    expect(notifications.has('can:10')).toBe(false)
    expect(popups).not.toContain('can:10')
    expect(onSnapshot).toHaveBeenCalledTimes(1)
  })

  test('CAN lifecycle and snapshots do not affect the independent LMA controller', async () => {
    const lmaSnapshot = vi.fn()
    vi.mocked(fetchNotifications).mockResolvedValue({ notifications: [], serverTime: 'lma' })
    vi.mocked(fetchCanTasks).mockResolvedValue([])
    const lma = new LmaNotificationController({ onSnapshot: lmaSnapshot, onError: vi.fn() })
    const can = new CanNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    lma.reconcile({ enabled: true, intervalMs: 1000, token: 'lma-token' })
    can.reconcile(config)
    await vi.advanceTimersByTimeAsync(0)
    const lmaGeneration = lma.getGeneration()
    const canGeneration = can.getGeneration()
    can.teardown()
    expect(lma.getGeneration()).toBe(lmaGeneration)
    expect(lmaSnapshot).toHaveBeenCalledTimes(1)
    lma.reconcile({ enabled: false, intervalMs: 1000, token: null })
    expect(can.getGeneration()).toBe(canGeneration + 1)
  })
})
