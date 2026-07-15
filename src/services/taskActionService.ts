import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'

export type CompletionResult = 'normal' | 'no_passenger'

const LOG_SOURCE = 'task-actions'
function getRequiredToken(token: string): string {
  if (!token) {
    logAppEvent('error', LOG_SOURCE, 'Task action requested without available auth token')
    throw new Error('缺少登入驗證資訊，請重新登入')
  }
  return token
}

export async function replyTask(token: string, taskId: number): Promise<string> {
  logAppEvent('info', LOG_SOURCE, 'Sending reply task request', { taskId })
  try {
    const status = await invoke<string>('reply_task', {
      token: getRequiredToken(token),
      taskId,
    })
    logAppEvent('info', LOG_SOURCE, 'Reply task request completed', { taskId, status })
    return status
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Reply task request failed', { taskId, error })
    throw error
  }
}

export async function completeTask(token: string, taskId: number, result: CompletionResult): Promise<string> {
  logAppEvent('info', LOG_SOURCE, 'Sending complete task request', { taskId, result })
  try {
    const status = await invoke<string>('complete_task', {
      token: getRequiredToken(token),
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
