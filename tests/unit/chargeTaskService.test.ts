import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { fetchChargeTasks, isChargeForbidden, updateChargeTask } from '@/services/chargeTaskService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('chargeTaskService', () => {
  beforeEach(() => { vi.clearAllMocks() })
  test('filters tasks to the authenticated station', async () => {
    vi.mocked(invoke).mockResolvedValue([{ serialNumber: 1, station: ' S1 ' }, { serialNumber: 2, station: 'S2' }])
    await expect(fetchChargeTasks('token', 'S1')).resolves.toEqual([{ serialNumber: 1, station: ' S1 ' }])
    expect(invoke).toHaveBeenCalledWith('charge_fetch_tasks', { token: 'token', station: 'S1' })
  })
  test('returns all tasks when the charge account has no station', async () => {
    const tasks = [{ serialNumber: 1, station: 'S1' }, { serialNumber: 2, station: 'S2' }]
    vi.mocked(invoke).mockResolvedValue(tasks)
    await expect(fetchChargeTasks('token', '')).resolves.toEqual(tasks)
    expect(invoke).toHaveBeenCalledWith('charge_fetch_tasks', { token: 'token', station: '' })
  })
  test('sends the new isDone update payload', async () => {
    await updateChargeTask('token', ' S1 ', 42, true)
    expect(invoke).toHaveBeenCalledWith('charge_complete_task', { token: 'token', station: 'S1', serialNumber: 42, isDone: true })
  })
  test('recognizes structured forbidden errors', () => { expect(isChargeForbidden({ status: 403, message: 'forbidden' })).toBe(true) })
})
