import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import type { CanTask } from '@/types/can'

const LOG_SOURCE = 'can-task-service'

function requireCanToken(token: string): string {
  if (!token) {
    logAppEvent('error', LOG_SOURCE, 'CAN task action requested without CAN auth token')
    throw new Error('缺少 Q 潔淨立馬清登入驗證資訊，請重新登入')
  }
  return token
}

export async function fetchCanTasks(token: string): Promise<CanTask[]> {
  logAppEvent('info', LOG_SOURCE, 'Fetching CAN tasks')

  try {
    const tasks = await invoke<CanTask[]>('can_fetch_tasks', {
      token: requireCanToken(token),
    })

    logAppEvent('info', LOG_SOURCE, 'CAN tasks fetched successfully', { count: tasks.length })
    return tasks
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Failed to fetch CAN tasks', { error })
    throw error
  }
}

export async function completeCanTask(
  token: string,
  serialNumber: number,
  isDone: boolean,
  resolutionType?: number
): Promise<void> {
  logAppEvent('info', LOG_SOURCE, 'Completing CAN task', {
    serialNumber,
    isDone,
    resolutionType,
  })

  try {
    await invoke('can_complete_task', {
      token: requireCanToken(token),
      serialNumber,
      isDone,
      resolutionType: resolutionType ?? null,
    })

    logAppEvent('info', LOG_SOURCE, 'CAN task completed successfully', {
      serialNumber,
      isDone,
      resolutionType,
    })
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Failed to complete CAN task', {
      serialNumber,
      isDone,
      resolutionType,
      error,
    })
    throw error
  }
}
