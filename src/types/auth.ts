export interface AuthUser {
  name: string
  stationId: string
  sectionId: string | null
  role: string
}

export interface LoginRequest {
  account: string
  password: string
  deviceType: 'windows' | 'android'
  deviceId: string
  fcmToken?: string
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface ApiEnvelope<T> {
  status: 'success' | 'error'
  message?: string
  data?: T
}
