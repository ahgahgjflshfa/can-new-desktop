import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import { useSystemStore } from '@/stores/systemStore'
import type { AuthUser } from '@/types/auth'
import type { CanAuthUser } from '@/types/can'

const loginWithPasswordMock = vi.fn()
const logoutWithTokenMock = vi.fn()
const setApiAuthTokenProviderMock = vi.fn()
const canLoginWithPasswordMock = vi.fn()

vi.mock('@/services/authService', () => ({
  loginWithPassword: (...args: unknown[]) => loginWithPasswordMock(...args),
  logoutWithToken: (...args: unknown[]) => logoutWithTokenMock(...args),
}))

vi.mock('@/services/apiClient', () => ({
  setApiAuthTokenProvider: (...args: unknown[]) => setApiAuthTokenProviderMock(...args),
}))

vi.mock('@/services/canAuthService', () => ({
  canLoginWithPassword: (...args: unknown[]) => canLoginWithPasswordMock(...args),
}))

describe('authStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key]
      }),
    })
  })

  function mockUser(name = 'Test User'): AuthUser {
    return {
      name,
      stationId: 'A1',
      sectionId: null,
      role: 'staff',
    }
  }

  function mockCanUser(name = 'CAN User'): CanAuthUser {
    return { name, station: 'C1', topic: 'general' }
  }

  test('hydrates from storage during init', () => {
    const stored = {
      token: 'saved-token',
      user: mockUser(),
    }

    localStorage.setItem('tauri-app:auth', JSON.stringify(stored))
    const store = useAuthStore()

    store.init()

    expect(store.isHydrated).toBe(true)
    expect(store.token).toBe('saved-token')
    expect(store.user?.name).toBe('Test User')
    expect(setApiAuthTokenProviderMock).toHaveBeenCalledTimes(1)
  })

  test('login stores token and user', async () => {
    loginWithPasswordMock.mockResolvedValue({ token: 'abc', user: mockUser('Alice') })
    const store = useAuthStore()

    await store.login('lma', 'alice', 'secret')

    expect(store.isAuthenticated).toBe(true)
    expect(store.displayName).toBe('Alice')
    expect(store.token).toBe('abc')
    expect(localStorage.setItem).toHaveBeenCalled()
  })

  test('reports lma authenticated immediately after login', async () => {
    loginWithPasswordMock.mockResolvedValue({ token: 'abc', user: mockUser('Alice') })
    const store = useAuthStore()
    const systemStore = useSystemStore()

    expect(store.isSystemAuthenticated('lma')).toBe(false)
    expect(systemStore.isLmaAuthenticated).toBe(false)

    await store.login('lma', 'alice', 'secret')

    expect(store.isSystemAuthenticated('lma')).toBe(true)
    expect(systemStore.isLmaAuthenticated).toBe(true)
  })

  test('reports lma unauthenticated immediately after logout', async () => {
    logoutWithTokenMock.mockResolvedValue(undefined)
    const store = useAuthStore()
    const systemStore = useSystemStore()

    store.lmaSession = { token: 'will-clear', user: mockUser('Bob') }

    expect(store.isSystemAuthenticated('lma')).toBe(true)
    expect(systemStore.isLmaAuthenticated).toBe(true)

    await store.logout()

    expect(store.isSystemAuthenticated('lma')).toBe(false)
    expect(systemStore.isLmaAuthenticated).toBe(false)
  })

  test('hydrates both independent sessions and switching does not mutate either', () => {
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token', user: mockUser('LMA') }))
    localStorage.setItem('tauri-app:auth:can', JSON.stringify({ token: 'can-token', user: mockCanUser() }))
    const store = useAuthStore()

    store.init()
    store.switchSystem('can')
    store.switchSystem('lma')

    expect(store.getSystemSession('lma')?.token).toBe('lma-token')
    expect(store.getSystemSession('can')?.token).toBe('can-token')
    expect(store.token).toBe('lma-token')
  })

  test('targeted logout clears only the requested system', async () => {
    localStorage.setItem('tauri-app:auth:lma', JSON.stringify({ token: 'lma-token', user: mockUser() }))
    localStorage.setItem('tauri-app:auth:can', JSON.stringify({ token: 'can-token', user: mockCanUser() }))
    const store = useAuthStore()
    store.init()

    await store.logout('can')

    expect(store.isSystemAuthenticated('lma')).toBe(true)
    expect(store.isSystemAuthenticated('can')).toBe(false)
    expect(store.currentSystem).toBe('lma')
  })

  test('keeps lma authenticated indicator true after switching to can when lma auth is persisted', async () => {
    loginWithPasswordMock.mockResolvedValue({ token: 'abc', user: mockUser('Alice') })
    const store = useAuthStore()
    const systemStore = useSystemStore()

    await store.login('lma', 'alice', 'secret')
    systemStore.switchView('can')

    expect(store.currentSystem).toBe('can')
    expect(store.isSystemAuthenticated('lma')).toBe(true)
    expect(systemStore.isLmaAuthenticated).toBe(true)
  })

  test('validates legacy lma auth storage before reporting authenticated', () => {
    const store = useAuthStore()

    localStorage.setItem('tauri-app:auth', 'not-json')
    store.switchSystem('can')

    expect(store.isSystemAuthenticated('lma')).toBe(false)

    localStorage.setItem('tauri-app:auth', JSON.stringify({ token: 'legacy-token', user: mockUser() }))
    store.init()

    expect(store.isSystemAuthenticated('lma')).toBe(true)
  })

  test('login shows a localized message for invalid credentials', async () => {
    loginWithPasswordMock.mockRejectedValue(new Error('Invalid credentials'))
    const store = useAuthStore()

    await expect(store.login('lma', 'bad', 'bad')).rejects.toThrow('Invalid credentials')

    expect(store.lastError).toBe('帳號或密碼錯誤，請重新輸入。')
    expect(store.isSubmitting).toBe(false)
    expect(store.isAuthenticated).toBe(false)
  })

  test('login keeps backend Chinese error messages', async () => {
    loginWithPasswordMock.mockRejectedValue(new Error('帳號已停用，請聯絡管理員。'))
    const store = useAuthStore()

    await expect(store.login('lma', 'disabled', 'secret')).rejects.toThrow('帳號已停用')

    expect(store.lastError).toBe('帳號已停用，請聯絡管理員。')
  })

  test('logout clears session and calls API with current token', async () => {
    logoutWithTokenMock.mockResolvedValue(undefined)
    const store = useAuthStore()

    store.lmaSession = { token: 'will-clear', user: mockUser('Bob') }

    await store.logout()

    expect(logoutWithTokenMock).toHaveBeenCalledWith('will-clear')
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(localStorage.removeItem).toHaveBeenCalledWith('tauri-app:auth:lma')
  })
})
