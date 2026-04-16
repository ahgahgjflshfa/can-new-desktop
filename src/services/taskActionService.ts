import { invoke } from '@tauri-apps/api/core'
import { getApiAuthToken } from '@/services/apiClient'

export type CompletionResult = 'normal' | 'no_passenger'

const AUTH_STORAGE_KEY = 'tauri-app:auth'

interface StoredAuthState {
  token: string
}

function getTokenFromStorage(): string | null {
  if (typeof localStorage === 'undefined') return null

  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null

    const record = parsed as Partial<StoredAuthState>
    if (typeof record.token === 'string' && record.token.length > 0) {
      return record.token
    }
  } catch (err) {
    console.warn('failed to parse auth state for task action token', err)
  }

  return null
}

function getRequiredToken(): string {
  const token = getApiAuthToken() ?? getTokenFromStorage()
  if (!token) {
    throw new Error('缺少登入驗證資訊，請重新登入')
  }
  return token
}

export async function replyTask(taskId: number): Promise<string> {
  return invoke<string>('reply_task', {
    token: getRequiredToken(),
    taskId,
  })
}

export async function completeTask(taskId: number, result: CompletionResult): Promise<string> {
  return invoke<string>('complete_task', {
    token: getRequiredToken(),
    taskId,
    result,
  })
}
