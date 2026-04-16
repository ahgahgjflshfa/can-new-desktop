import { defineStore } from 'pinia'
import { logAppEvent } from '@/services/appLogger'
import { setApiAuthTokenProvider } from '@/services/apiClient'
import { loginWithPassword, logoutWithToken } from '@/services/authService'
import type { AuthUser } from '@/types/auth'

const AUTH_STORAGE_KEY = 'tauri-app:auth'

interface StoredAuthState {
  token: string
  user: AuthUser
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    user: null as AuthUser | null,
    isHydrated: false,
    isSubmitting: false,
    lastError: null as string | null,
  }),

  getters: {
    isAuthenticated: state => Boolean(state.token),
    displayName: state => state.user?.name ?? '',
  },

  actions: {
    init() {
      this.loadFromStorage()
      setApiAuthTokenProvider(() => this.token)
      this.isHydrated = true
    },

    async login(account: string, password: string) {
      this.isSubmitting = true
      this.lastError = null
      logAppEvent('info', 'auth', 'login requested', { account })

      try {
        const result = await loginWithPassword(account, password)
        this.token = result.token
        this.user = result.user
        this.persistToStorage()
        logAppEvent('info', 'auth', 'login succeeded', {
          account,
          stationId: result.user.stationId,
          role: result.user.role,
        })
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        logAppEvent('error', 'auth', 'login failed', err)
        throw err
      } finally {
        this.isSubmitting = false
      }
    },

    async logout() {
      const currentToken = this.token
      this.clearSession()

      if (!currentToken) return

      try {
        await logoutWithToken(currentToken)
      } catch (err) {
        logAppEvent('warn', 'auth', 'logout request failed', err)
        console.warn('logout request failed', err)
        return
      }

      logAppEvent('info', 'auth', 'logout completed')
    },

    clearSession() {
      this.token = null
      this.user = null
      this.lastError = null
      this.clearStorage()
    },

    loadFromStorage() {
      if (typeof localStorage === 'undefined') return

      const raw = localStorage.getItem(AUTH_STORAGE_KEY)
      if (!raw) return

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        logAppEvent('warn', 'auth', 'failed to parse auth state', err)
        console.warn('failed to parse auth state', err)
        return
      }

      if (typeof parsed !== 'object' || parsed === null) return

      const record = parsed as Partial<StoredAuthState>
      if (typeof record.token === 'string' && record.token.length > 0 && record.user) {
        this.token = record.token
        this.user = record.user
      }
    },

    persistToStorage() {
      if (typeof localStorage === 'undefined') return
      if (!this.token || !this.user) {
        this.clearStorage()
        return
      }

      try {
        localStorage.setItem(
          AUTH_STORAGE_KEY,
          JSON.stringify({
            token: this.token,
            user: this.user,
          } satisfies StoredAuthState)
        )
      } catch (err) {
        logAppEvent('warn', 'auth', 'failed to persist auth state', err)
        console.warn('failed to persist auth state', err)
      }
    },

    clearStorage() {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY)
      } catch (err) {
        logAppEvent('warn', 'auth', 'failed to clear auth state', err)
        console.warn('failed to clear auth state', err)
      }
    },
  },
})
