import { invoke } from '@tauri-apps/api/core'
import type { AuthUser, LoginRequest, LoginResponse } from '@/types/auth'

const DEVICE_ID_STORAGE_KEY = 'tauri-app:device-id'

function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return `web-${Date.now()}`
  }

  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) return existing

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  try {
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated)
  } catch (err) {
    console.warn('failed to persist device id', err)
  }

  return generated
}

export async function loginWithPassword(account: string, password: string): Promise<LoginResponse> {
  const payload: LoginRequest = {
    account,
    password,
    deviceType: 'windows',
    deviceId: getOrCreateDeviceId(),
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
