import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import type { CanLoginResponse } from '@/types/can'

const LOG_SOURCE = 'can-auth-service'

export async function canLoginWithPassword(account: string, password: string): Promise<CanLoginResponse> {
  logAppEvent('info', LOG_SOURCE, 'Sending CAN login request to backend', {
    account,
  })

  try {
    const data = await invoke<CanLoginResponse>('can_login', {
      payload: {
        account,
        password,
      },
    })

    logAppEvent('info', LOG_SOURCE, 'CAN login request completed successfully', {
      account,
      station: data.user.station,
      topic: data.user.topic,
    })

    return data
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'CAN login request failed in backend invoke', {
      account,
      error,
    })
    throw error
  }
}

export async function canLogoutWithToken(token: string): Promise<void> {
  try {
    logAppEvent('info', LOG_SOURCE, 'Sending CAN logout request to backend')
    // CAN API does not have a logout endpoint, so we just clear the token locally
    logAppEvent('info', LOG_SOURCE, 'CAN logout completed (token cleared locally)')
  } catch {
    logAppEvent('warn', LOG_SOURCE, 'CAN logout request failed but will be treated as completed by UI')
    return
  }
}
