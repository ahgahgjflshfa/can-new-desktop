import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { completeCanTask, fetchCanTasks } from '@/services/canTaskService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('canTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue([])
  })

  test('uses the explicit CAN token for fetch and completion', async () => {
    await fetchCanTasks('can-token', 'C1')
    await completeCanTask('can-token', 42, true, 1)

    expect(invoke).toHaveBeenNthCalledWith(1, 'can_fetch_tasks', { token: 'can-token', stationCode: 'C1' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'can_complete_task', {
      token: 'can-token', serialNumber: 42, isDone: true, resolutionType: 1,
    })
  })

  test('blocks IPC when the CAN token is missing', async () => {
    await expect(fetchCanTasks('', 'C1')).rejects.toThrow('Q 潔淨立馬清')
    await expect(completeCanTask('', 42, true)).rejects.toThrow('Q 潔淨立馬清')
    expect(invoke).not.toHaveBeenCalled()
  })
})
