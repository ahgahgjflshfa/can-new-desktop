import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ChargeNotificationController } from '@/services/chargeNotificationRuntime'
import { fetchChargeTasks } from '@/services/chargeTaskService'

vi.mock('@/services/chargeTaskService', () => ({
  fetchChargeTasks: vi.fn(),
  isChargeForbidden: (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: number }).status === 403,
}))

const task = { serialNumber: 1, deviceCode: 'D1', station: 'S1', isDone: false, cleanAt: null, informTime: 1, isDisable: false, createdAt: 'now', updatedAt: 'now' }

describe('ChargeNotificationController', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(fetchChargeTasks).mockReset() })

  test('does not overlap and queues a manual refresh', async () => {
    let resolve!: (value: typeof task[]) => void
    vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const controller = new ChargeNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 't', station: ' S1 ' })
    await vi.advanceTimersByTimeAsync(0)
    void controller.trigger(); void controller.trigger()
    expect(fetchChargeTasks).toHaveBeenCalledTimes(1)
    resolve([task]); await Promise.resolve(); await Promise.resolve()
    expect(fetchChargeTasks).toHaveBeenCalledTimes(2)
  })

  test('fences stale results after rotation and handles structured forbidden', async () => {
    let resolve!: (value: typeof task[]) => void
    vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const onSnapshot = vi.fn(); const onForbidden = vi.fn()
    const controller = new ChargeNotificationController({ onSnapshot, onError: vi.fn(), onForbidden })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'old', station: 'S1' })
    await vi.advanceTimersByTimeAsync(0)
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 'new', station: 'S1' })
    resolve([task]); await Promise.resolve()
    expect(onSnapshot).not.toHaveBeenCalled()
    controller.teardown()
    vi.mocked(fetchChargeTasks).mockRejectedValueOnce({ status: 403, message: 'forbidden' })
    const forbiddenController = new ChargeNotificationController({ onSnapshot: vi.fn(), onError: vi.fn(), onForbidden })
    forbiddenController.reconcile({ enabled: true, intervalMs: 1000, token: 'token', station: 'S1' })
    await vi.advanceTimersByTimeAsync(0); await Promise.resolve()
    expect(onForbidden).toHaveBeenCalledTimes(1)
  })

  test('idle trigger performs exactly one fetch and a deferred trigger performs one queued fetch', async () => {
    vi.mocked(fetchChargeTasks).mockResolvedValueOnce([task]).mockResolvedValueOnce([task])
    const onSnapshot = vi.fn()
    const controller = new ChargeNotificationController({ onSnapshot, onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 60_000, token: 't', station: 'S1' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(fetchChargeTasks).toHaveBeenCalledTimes(1))
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    await controller.trigger()
    expect(fetchChargeTasks).toHaveBeenCalledTimes(2)
  })

  test('failed and stale polls produce zero snapshots', async () => {
    let reject!: (error: Error) => void
    vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise((_, r) => { reject = r }))
    const onSnapshot = vi.fn(); const onError = vi.fn()
    const controller = new ChargeNotificationController({ onSnapshot, onError })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 't', station: 'S1' })
    await vi.advanceTimersByTimeAsync(0)
    controller.invalidate()
    reject(new Error('offline'))
    await Promise.resolve(); await Promise.resolve()
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  test('concurrent trigger calls are single-flight', async () => {
    let resolve!: (value: typeof task[]) => void
    vi.mocked(fetchChargeTasks).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const controller = new ChargeNotificationController({ onSnapshot: vi.fn(), onError: vi.fn() })
    controller.reconcile({ enabled: true, intervalMs: 1000, token: 't', station: 'S1' })
    await vi.advanceTimersByTimeAsync(0)
    const first = controller.trigger(); const second = controller.trigger()
    expect(fetchChargeTasks).toHaveBeenCalledTimes(1)
    resolve([task]); await first; await second
    expect(fetchChargeTasks).toHaveBeenCalledTimes(2) // one queued authoritative refresh
  })
})
