import { defineStore } from 'pinia'
import { logAppEvent } from '@/services/appLogger'
import { setApiAuthTokenProvider } from '@/services/apiClient'
import { loginWithPassword, logoutWithToken } from '@/services/authService'
import { canLoginWithPassword } from '@/services/canAuthService'
import { chargeLoginWithPassword, CHARGE_LOGIN_ERROR, isChargeLoginValidationError } from '@/services/chargeAuthService'
import type { AuthUser } from '@/types/auth'
import type { CanAuthUser } from '@/types/can'
import type { ChargeAuthUser } from '@/types/charge'
import type { SystemType } from '@/types/system'
import { invalidateLmaNotificationPrincipal } from '@/services/lmaNotificationRuntime'

const AUTH_STORAGE_KEY = 'tauri-app:auth'
const LMA_AUTH_STORAGE_KEY = 'tauri-app:auth:lma'
const CAN_AUTH_STORAGE_KEY = 'tauri-app:auth:can'
const CHARGE_AUTH_STORAGE_KEY = 'tauri-app:auth:charge'

export type { SystemType } from '@/types/system'

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
interface ChargeStoredAuthState {
  token: string
  user: ChargeAuthUser
}
function sessionForSystem(state: { lmaSession: LmaStoredAuthState | null; canSession: CanStoredAuthState | null; chargeSession: ChargeStoredAuthState | null }, system: SystemType) {
  switch (system) {
    case 'lma': return state.lmaSession
    case 'can': return state.canSession
    case 'charge': return state.chargeSession
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    lmaSession: null as LmaStoredAuthState | null,
    canSession: null as CanStoredAuthState | null,
    chargeSession: null as ChargeStoredAuthState | null,
    currentSystem: 'lma' as SystemType,
    isHydrated: false,
    isSubmitting: false,
    lastError: null as string | null,
  }),

  getters: {
    token: state => sessionForSystem(state, state.currentSystem)?.token ?? null,
    user: state => sessionForSystem(state, state.currentSystem)?.user ?? null,
    isAuthenticated: state => Boolean(sessionForSystem(state, state.currentSystem)?.token),
    displayName: state => sessionForSystem(state, state.currentSystem)?.user.name ?? '',
    getSystemSession: state => (system: SystemType) => sessionForSystem(state, system),
    isSystemAuthenticated: state => (system: SystemType) => Boolean(sessionForSystem(state, system)?.token),
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
          // A successful login may replace an existing LMA principal without a
          // separate logout; fence that principal before exposing the new one.
          invalidateLmaNotificationPrincipal()
          this.lmaSession = { token: result.token, user: result.user }
          this.currentSystem = 'lma'
          this.selectSystem('lma')
          this.persistSession('lma')
          logAppEvent('info', 'auth', 'lma login succeeded', {
            account,
            stationId: result.user.stationId,
            role: result.user.role,
          })
        } else if (system === 'can') {
          const result = await canLoginWithPassword(account, password)
          this.canSession = { token: result.token, user: result.user }
          this.currentSystem = 'can'
          this.selectSystem('can')
          this.persistSession('can')
          logAppEvent('info', 'auth', 'can login succeeded', {
            account,
            station: result.user.station,
            topic: result.user.topic,
          })
        } else {
          const result = await chargeLoginWithPassword(account, password)
          this.chargeSession = { token: result.token, user: result.user }
          this.currentSystem = 'charge'
          this.selectSystem('charge')
          this.persistSession('charge')
        }
        setApiAuthTokenProvider(() => this.token)
      } catch (err) {
        const chargeValidationFailure = system === 'charge' && isChargeLoginValidationError(err)
        this.lastError = chargeValidationFailure ? CHARGE_LOGIN_ERROR : getLoginErrorMessage(err)
        if (chargeValidationFailure) {
          this.clearSession('charge')
          // clearSession intentionally resets errors for normal logout; retain the
          // actionable mismatch message after targeted validation cleanup.
          this.lastError = CHARGE_LOGIN_ERROR
        }
        logAppEvent('error', 'auth', `${system} login failed`, err)
        throw err
      } finally {
        this.isSubmitting = false
      }
    },

    async logout(system?: SystemType) {
      const targetSystem = system ?? this.currentSystem
      const session = this.getSystemSession(targetSystem)
      const currentToken = session?.token ?? null
      this.clearSession(targetSystem)

      if (!currentToken) return

      if (targetSystem === 'lma') {
        try {
          await logoutWithToken(currentToken)
        } catch (err) {
          logAppEvent('warn', 'auth', 'lma logout request failed', err)
          console.warn('lma logout request failed', err)
        }
      }
      // CAN logout is handled locally (no backend logout endpoint)

      logAppEvent('info', 'auth', `${targetSystem} logout completed`)
    },

    switchSystem(system: SystemType) {
      if (this.currentSystem === system) return

      this.currentSystem = system
      this.selectSystem(system)
      this.lastError = null
      setApiAuthTokenProvider(() => this.token)

      logAppEvent('info', 'auth', `switched to ${system}`, {
        isAuthenticated: this.isAuthenticated,
      })
    },

    clearSession(system?: SystemType) {
      const targetSystem = system ?? this.currentSystem
      if (targetSystem === 'lma') invalidateLmaNotificationPrincipal()
      if (targetSystem === 'lma') this.lmaSession = null
      else if (targetSystem === 'can') this.canSession = null
      else this.chargeSession = null
      this.clearStorage(targetSystem)
      if (targetSystem === this.currentSystem) this.selectSystem(targetSystem)
      this.lastError = null
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

      this.loadSystemFromStorage('lma')
      this.loadSystemFromStorage('can')
      this.loadSystemFromStorage('charge')
      this.selectSystem(this.currentSystem)
    },

    loadSystemFromStorage(system: SystemType) {
      if (typeof localStorage === 'undefined') return

      const key = system === 'lma'
        ? LMA_AUTH_STORAGE_KEY
        : system === 'can' ? CAN_AUTH_STORAGE_KEY : CHARGE_AUTH_STORAGE_KEY
      const raw = localStorage.getItem(key)
      if (!raw) return

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to parse ${system} auth state`, err)
        console.warn(`failed to parse ${system} auth state`, err)
        if (system === 'charge') this.clearStorage('charge')
        return
      }

      if (typeof parsed !== 'object' || parsed === null) return

      const record = parsed as Record<string, unknown>
      if (typeof record.token !== 'string' || !record.token.trim() || !record.user) {
        if (system === 'charge') this.clearStorage('charge')
        return
      }
      if (system === 'lma') this.lmaSession = { token: record.token, user: record.user as AuthUser }
      else if (system === 'can') this.canSession = { token: record.token, user: record.user as CanAuthUser }
      else {
        const user = record.user as Partial<ChargeAuthUser>
        if (typeof user.station === 'string' && user.station.trim() && user.system === 'charge') {
          this.chargeSession = {
            token: record.token.trim(),
            user: { ...user, station: user.station.trim() } as ChargeAuthUser,
          }
        } else {
          this.clearStorage('charge')
        }
      }
    },

    selectSystem(system: SystemType) {
      // Compatibility getters derive the active token/user from currentSystem.
    },

    persistSession(system: SystemType) {
      if (typeof localStorage === 'undefined') return
      const session = this.getSystemSession(system)
      if (!session?.token || !session.user) {
        this.clearStorage(system)
        return
      }

      const key = system === 'lma'
        ? LMA_AUTH_STORAGE_KEY
        : system === 'can' ? CAN_AUTH_STORAGE_KEY : CHARGE_AUTH_STORAGE_KEY

      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            token: session.token,
            user: session.user,
          })
        )
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to persist ${system} auth state`, err)
        console.warn(`failed to persist ${system} auth state`, err)
      }
    },

    persistToStorage(system: SystemType) {
      this.persistSession(system)
    },

    clearStorage(system: SystemType) {
      if (typeof localStorage === 'undefined') return
      const key = system === 'lma'
        ? LMA_AUTH_STORAGE_KEY
        : system === 'can' ? CAN_AUTH_STORAGE_KEY : CHARGE_AUTH_STORAGE_KEY
      try {
        localStorage.removeItem(key)
      } catch (err) {
        logAppEvent('warn', 'auth', `failed to clear ${system} auth state`, err)
        console.warn(`failed to clear ${system} auth state`, err)
      }
    },
  },
})
