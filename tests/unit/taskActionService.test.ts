import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { completeTask, replyTask } from '@/services/taskActionService'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('taskActionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue('replied')

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

  test('replyTask uses its explicit lma token in popup context', async () => {
    await replyTask('lma-token', 42)

    expect(invoke).toHaveBeenCalledWith('reply_task', {
      token: 'lma-token',
      taskId: 42,
    })
  })

  test('completeTask uses its explicit lma token', async () => {
    await completeTask('lma-token', 42, 'normal')

    expect(invoke).toHaveBeenCalledWith('complete_task', {
      token: 'lma-token',
      taskId: 42,
      result: 'normal',
    })
  })
})
