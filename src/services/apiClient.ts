import type { ApiEnvelope } from '@/types/auth'

const DEFAULT_BASE_URL = 'https://www-u.tymetro.com.tw/station_services/api'

let authTokenProvider: (() => string | null) | null = null

export function setApiAuthTokenProvider(provider: (() => string | null) | null) {
  authTokenProvider = provider
}

export function getApiAuthToken(): string | null {
  return authTokenProvider?.() ?? null
}

function getBaseUrl(): string {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL
  if (typeof envBaseUrl === 'string' && envBaseUrl.length > 0) {
    return envBaseUrl.replace(/\/$/, '')
  }
  return DEFAULT_BASE_URL
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  requireAuth?: boolean
  tokenOverride?: string
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, requireAuth = true, tokenOverride } = options
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
  }

  if (requireAuth) {
    const token = tokenOverride ?? authTokenProvider?.() ?? null
    if (!token) {
      throw new ApiError('Missing authentication token')
    }
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const payload = (await response.json()) as ApiEnvelope<T>

  if (!response.ok || payload.status === 'error') {
    throw new ApiError(payload.message ?? 'Request failed', response.status)
  }

  if (payload.data === undefined) {
    return {} as T
  }

  return payload.data
}
