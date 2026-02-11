import { invoke } from '@tauri-apps/api/core'
import type { AuthUser, LoginRequest, LoginResponse } from '@/types/auth'

async function getOrCreateDeviceId(): Promise<string> {
  return invoke<string>('get_or_create_device_id')
}

export async function loginWithPassword(account: string, password: string): Promise<LoginResponse> {
  const deviceId = await getOrCreateDeviceId()

  const payload: LoginRequest = {
    account,
    password,
    deviceType: 'windows',
    deviceId,
  }

  const data = await invoke<LoginResponse>('auth_login', {
    payload: {
      account: payload.account,
      password: payload.password,
      deviceType: payload.deviceType,
      deviceId: payload.deviceId,
      fcmToken: payload.fcmToken,
    },
  })

  return data
}

export async function logoutWithToken(token: string): Promise<void> {
  try {
    await invoke('auth_logout', { token })
  } catch {
    // Consider logout successful from UI perspective even when token is already invalid.
    return
  }
}
