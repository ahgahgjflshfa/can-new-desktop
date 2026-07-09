import { defineStore } from 'pinia'
import { logAppEvent } from '@/services/appLogger'
import { setApiAuthTokenProvider } from '@/services/apiClient'
import { loginWithPassword, logoutWithToken } from '@/services/authService'
import { canLoginWithPassword } from '@/services/canAuthService'
import type { AuthUser } from '@/types/auth'
import type { CanAuthUser } from '@/types/can'

const AUTH_STORAGE_KEY = 'tauri-app:auth'
const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'
const CAN_AUTH_STORAGE_KEY = 'tauri-app:auth:can'

type SystemType = 'lma' | 'can'

function getLoginErrorMessage(err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err ?? '')
  const message = rawMessage.toLowerCase()

  if (!rawMessage.trim()) return '登入失敗，請稍後再試。'
  if (/[^\x00-\x7F]/.test(rawMessage)) return rawMessage

  if (message.includes('invalid') || message.includes('credential') || message.includes('unauthorized')) {
    return '帳號或密碼錯誤，請重新輸入。'
  }

  if (message.includes('forbidden') || message.includes('permission')) {
    return '此帳號沒有登入權限，請聯絡管理員。'
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return '登入逾時，請確認網路連線後再試。'
  }

  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return '無法連線到伺服器，請確認網路後再試。'
  }

  return '登入失敗，請確認帳號密碼或稍後再試。'
}

interface LmaStoredAuthState {
  token: string
  user: AuthUser
}

interface CanStoredAuthState {
  token: string
  user: CanAuthUser
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    user: null as AuthUser | CanAuthUser | null,
    currentSystem: 'lma' as SystemType,
    isHydrated: false,
    isSubmitting: false,
    lastError: null as string | null,
  }),

  getters: {
    isAuthenticated: state => Boolean(state.token),
    displayName: state => state.user?.name ?? '',
    isSystemAuthenticated: state => (system: SystemType) => {
      if (system === state.currentSystem) {
        return Boolean(state.token)
      }

      if (typeof localStorage === 'undefined') return false
      const key = system === 'lma' ? LMA_AUTH_STORAGE_KEY : CAN_AUTH_STORAGE_KEY
      const raw = localStorage.getItem(key)
      if (!raw) {
        // backward compatibility: check old key for lma
        if (system === 'lma') {
          const oldRaw = localStorage.getItem(AUTH_STORAGE_KEY)
          if (oldRaw) {
            try {
              const parsed = JSON.parse(oldRaw)
              return typeof parsed?.token === 'string' && parsed.token.length > 0
            } catch {
              return false
            }
          }
        }
        return false
      }
      try {
        const parsed = JSON.parse(raw)
        return typeof parsed?.token === 'string' && parsed.token.length > 0
      } catch {
        return false
      }
    },
  },

  actions: {
    init() {
      this.loadFromStorage()
      setApiAuthTokenProvider(() => this.token)
      this.isHydrated = true
    },

    async login(system: SystemType, account: string, password: string) {
      this.isSubmitting = true
      this.lastError = null
      logAppEvent('info', 'auth', `${system} login requested`, { account })

      try {
        if (system === 'lma') {
          const result = await loginWithPassword(account, password)
          this.token = result.token
          this.user = result.user
          this.currentSystem = 'lma'
          this.persistToStorage('lma')
          logAppEvent('info', 'auth', 'lma login succeeded', {
            account,
            stationId: result.user.stationId,
            role: result.user.role,
          })
        } else {
          const result = await canLoginWithPassword(account, password)
          this.token = result.token
          this.user = result.user
          this.currentSystem = 'can'
          this.persistToStorage('can')
          logAppEvent('info', 'auth', 'can login succeeded', {
            account,
            station: result.user.station,
            topic: result.user.topic,
          })
        }
        setApiAuthTokenProvider(() => this.token)
      } catch (err) {
        this.lastError = getLoginErrorMessage(err)
        logAppEvent('error', 'auth', `${system} login failed`, err)
        throw err
      } finally {
        this.isSubmitting = false
      }
    },

    async logout() {
      const currentSystem = this.currentSystem
      const currentToken = this.token
      this.clearSession()

      if (!currentToken) return

      if (currentSystem === 'lma') {
        try {
          await logoutWithToken(currentToken)
        } catch (err) {
          logAppEvent('warn', 'auth', 'lma logout request failed', err)
          console.warn('lma logout request failed', err)
        }
      }
      // CAN logout is handled locally (no backend logout endpoint)

      logAppEvent('info', 'auth', `${currentSystem} logout completed`)
    },

    switchSystem(system: SystemType) {
      if (this.currentSystem === system) return

      this.persistToStorage(this.currentSystem)
      this.currentSystem = system
      this.token = null
      this.user = null
      this.lastError = null
      this.loadSystemFromStorage(system)
      setApiAuthTokenProvider(() => this.token)

      logAppEvent('info', 'auth', `switched to ${system}`, {
        isAuthenticated: this.isAuthenticated,
      })
    },

    clearSession() {
      this.token = null
      this.user = null
      this.lastError = null
      this.clearStorage(this.currentSystem)
    },

    loadFromStorage() {
      if (typeof localStorage === 'undefined') return

      // Backward compatibility: migrate old key to lma
      const oldRaw = localStorage.getItem(AUTH_STORAGE_KEY)
      if (oldRaw) {
        try {
          const parsed = JSON.parse(oldRaw)
          if (typeof parsed?.token === 'string' && parsed.user) {
            localStorage.setItem(LMA_AUTH_STORAGE_KEY, oldRaw)
            localStorage.removeItem(AUTH_STORAGE_KEY)
            logAppEvent('info', 'auth', 'migrated old auth key to lma')
          }
        } catch (err) {
          logAppEvent('warn', 'auth', 'failed to migrate old auth key', err)
        }
      }

      this.loadSystemFromStorage(this.currentSystem)
    },

    loadSystemFromStorage(system: SystemType) {
      if (typeof localStorage === 'undefined') return

      const key = system === 'lma' ? LMA_AUTH_STORAGE_KEY : CAN_AUTH_STORAGE_KEY
      const raw = localStorage.getItem(key)
      if (!raw) return

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to parse ${system} auth state`, err)
        console.warn(`failed to parse ${system} auth state`, err)
        return
      }

      if (typeof parsed !== 'object' || parsed === null) return

      const record = parsed as Record<string, unknown>
      if (typeof record.token === 'string' && record.token.length > 0 && record.user) {
        this.token = record.token
        this.user = record.user as AuthUser | CanAuthUser
      }
    },

    persistToStorage(system: SystemType) {
      if (typeof localStorage === 'undefined') return
      if (!this.token || !this.user) {
        this.clearStorage(system)
        return
      }

      const key = system === 'lma' ? LMA_AUTH_STORAGE_KEY : CAN_AUTH_STORAGE_KEY

      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            token: this.token,
            user: this.user,
          })
        )
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to persist ${system} auth state`, err)
        console.warn(`failed to persist ${system} auth state`, err)
      }
    },

    clearStorage(system: SystemType) {
      if (typeof localStorage === 'undefined') return
      const key = system === 'lma' ? LMA_AUTH_STORAGE_KEY : CAN_AUTH_STORAGE_KEY
      try {
        localStorage.removeItem(key)
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to clear ${system} auth state`, err)
        console.warn(`failed to clear ${system} auth state`, err)
      }
    },
  },
})
