import { invoke } from '@tauri-apps/api/core'
import { logAppEvent } from '@/services/appLogger'
import type { AuthUser, LoginRequest, LoginResponse } from '@/types/auth'

const LOG_SOURCE = 'auth-service'

async function getOrCreateDeviceId(): Promise<string> {
  logAppEvent('info', LOG_SOURCE, 'Requesting device identifier from backend')
  try {
    const deviceId = await invoke<string>('get_or_create_device_id')
    logAppEvent('info', LOG_SOURCE, 'Received device identifier from backend')
    return deviceId
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Failed to get device identifier from backend', error)
    throw error
  }
}

export async function loginWithPassword(account: string, password: string): Promise<LoginResponse> {
  const deviceId = await getOrCreateDeviceId()

  const payload: LoginRequest = {
    account,
    password,
    deviceType: 'windows',
    deviceId,
  }

  logAppEvent('info', LOG_SOURCE, 'Sending login request to backend', {
    account,
    deviceType: payload.deviceType,
  })

  try {
    const data = await invoke<LoginResponse>('auth_login', {
      payload: {
        account: payload.account,
        password: payload.password,
        deviceType: payload.deviceType,
        deviceId: payload.deviceId,
        fcmToken: payload.fcmToken,
      },
    })

    logAppEvent('info', LOG_SOURCE, 'Login request completed successfully', {
      account,
      stationId: data.user.stationId,
      role: data.user.role,
    })

    return data
  } catch (error) {
    logAppEvent('error', LOG_SOURCE, 'Login request failed in backend invoke', {
      account,
      error,
    })
    throw error
  }
}

export async function logoutWithToken(token: string): Promise<void> {
  try {
    logAppEvent('info', LOG_SOURCE, 'Sending logout request to backend')
    await invoke('auth_logout', { token })
    logAppEvent('info', LOG_SOURCE, 'Logout request completed successfully')
  } catch {
    logAppEvent('warn', LOG_SOURCE, 'Logout request failed but will be treated as completed by UI')
    // Consider logout successful from UI perspective even when token is already invalid.
    return
  }
}
