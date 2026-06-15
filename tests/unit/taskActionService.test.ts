import { beforeEach, describe, expect, test, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { getApiAuthToken } from '@/services/apiClient'
import { completeTask, replyTask } from '@/services/taskActionService'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/services/apiClient', () => ({
  getApiAuthToken: vi.fn(),
}))

describe('taskActionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getApiAuthToken).mockReturnValue(null)
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

  test('replyTask uses the lma auth token from storage in popup context', async () => {
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token' }))

    await replyTask(42)

    expect(invoke).toHaveBeenCalledWith('reply_task', {
      token: 'lma-token',
      taskId: 42,
    })
  })

  test('completeTask prefers the active api token over persisted storage', async () => {
    vi.mocked(getApiAuthToken).mockReturnValue('active-token')
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token' }))

    await completeTask(42, 'normal')

    expect(invoke).toHaveBeenCalledWith('complete_task', {
      token: 'active-token',
      taskId: 42,
      result: 'normal',
    })
  })
})
