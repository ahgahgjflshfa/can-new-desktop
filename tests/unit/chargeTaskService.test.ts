import { describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { completeChargeTask, fetchChargeTasks, isChargeForbidden } from '@/services/chargeTaskService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('chargeTaskService', () => {
  test('passes explicit credentials and filters by trimmed station', async () => {
    vi.mocked(invoke).mockResolvedValue([
      { serialNumber: 1, station: ' S1 ', status: 'pending' },
      { serialNumber: 2, station: 'S2', status: 'pending' },
    ])

    await expect(fetchChargeTasks('token', ' S1 ')).resolves.toEqual([
      { serialNumber: 1, station: ' S1 ', status: 'pending' },
    ])
    expect(invoke).toHaveBeenCalledWith('charge_fetch_tasks', { token: 'token', station: 'S1' })
  })

  test('uses fixed completion payload contract through command args', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    await completeChargeTask('token', ' S1 ', 42)
    expect(invoke).toHaveBeenCalledWith('charge_complete_task', { token: 'token', station: 'S1', serialNumber: 42 })
  })

  test('rejects blank station before invoking Rust', async () => {
    vi.clearAllMocks()
    await expect(fetchChargeTasks('token', ' \t ')).rejects.toThrow('缺少無線充故障登入驗證資訊')
    await expect(completeChargeTask('token', ' ', 42)).rejects.toThrow('缺少無線充故障登入驗證資訊')
    expect(invoke).not.toHaveBeenCalled()
  })

  test('recognizes structured forbidden errors unchanged from invoke', async () => {
    const forbidden = { status: 403, message: 'forbidden' }
    vi.mocked(invoke).mockRejectedValue(forbidden)
    await expect(fetchChargeTasks('token', 'S1')).rejects.toBe(forbidden)
    expect(isChargeForbidden(forbidden)).toBe(true)
    expect(isChargeForbidden({ status: 401, message: 'unauthorized' })).toBe(false)
  })
})
