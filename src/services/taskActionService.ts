import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import { getApiAuthToken } from '@/services/apiClient'

export type CompletionResult = 'normal' | 'no_passenger'

const AUTH_STORAGE_KEY = 'tauri-app:auth'
const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'
const LOG_SOURCE = 'task-actions'

interface StoredAuthState {
  token: string
}

function getTokenFromStorage(): string | null {
  if (typeof localStorage === 'undefined') return null

  const raw = localStorage.getItem(LMA_AUTH_STORAGE_KEY) ?? localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null

    const record = parsed as Partial<StoredAuthState>
    if (typeof record.token === 'string' && record.token.length > 0) {
      return record.token
    }
  } catch (err) {
    logAppEvent('warn', LOG_SOURCE, 'Failed to parse persisted auth state for task actions', err)
    console.warn('failed to parse auth state for task action token', err)
  }

  return null
}

function getRequiredToken(): string {
  const token = getApiAuthToken() ?? getTokenFromStorage()
  if (!token) {
    logAppEvent('error', LOG_SOURCE, 'Task action requested without available auth token')
    throw new Error('缺少登入驗證資訊，請重新登入')
  }
  return token
}

export async function replyTask(taskId: number): Promise<string> {
  logAppEvent('info', LOG_SOURCE, 'Sending reply task request', { taskId })
  try {
    const status = await invoke<string>('reply_task', {
      token: getRequiredToken(),
      taskId,
    })
    logAppEvent('info', LOG_SOURCE, 'Reply task request completed', { taskId, status })
    return status
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Reply task request failed', { taskId, error })
    throw error
  }
}

export async function completeTask(taskId: number, result: CompletionResult): Promise<string> {
  logAppEvent('info', LOG_SOURCE, 'Sending complete task request', { taskId, result })
  try {
    const status = await invoke<string>('complete_task', {
      token: getRequiredToken(),
      taskId,
      result,
    })
    logAppEvent('info', LOG_SOURCE, 'Complete task request completed', { taskId, result, status })
    return status
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Complete task request failed', { taskId, result, error })
    throw error
  }
}
