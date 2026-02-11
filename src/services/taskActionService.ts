import { invoke } from '@tauri-apps/api/core'
import { getApiAuthToken } from '@/services/apiClient'

export type CompletionResult = 'normal' | 'no_passenger'

function getRequiredToken(): string {
  const token = getApiAuthToken()
  if (!token) {
    throw new Error('Missing authentication token')
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
