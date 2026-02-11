import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import type { AuthUser } from '@/types/auth'

const loginWithPasswordMock = vi.fn()
const logoutWithTokenMock = vi.fn()
const setApiAuthTokenProviderMock = vi.fn()

vi.mock('@/services/authService', () => ({
  loginWithPassword: (...args: unknown[]) => loginWithPasswordMock(...args),
  logoutWithToken: (...args: unknown[]) => logoutWithTokenMock(...args),
}))

vi.mock('@/services/apiClient', () => ({
  setApiAuthTokenProvider: (...args: unknown[]) => setApiAuthTokenProviderMock(...args),
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

    await store.login('alice', 'secret')

    expect(store.isAuthenticated).toBe(true)
    expect(store.displayName).toBe('Alice')
    expect(store.token).toBe('abc')
    expect(localStorage.setItem).toHaveBeenCalled()
  })

  test('login exposes service error message', async () => {
    loginWithPasswordMock.mockRejectedValue(new Error('Invalid credentials'))
    const store = useAuthStore()

    await expect(store.login('bad', 'bad')).rejects.toThrow('Invalid credentials')

    expect(store.lastError).toBe('Invalid credentials')
    expect(store.isSubmitting).toBe(false)
    expect(store.isAuthenticated).toBe(false)
  })

  test('logout clears session and calls API with current token', async () => {
    logoutWithTokenMock.mockResolvedValue(undefined)
    const store = useAuthStore()

    store.token = 'will-clear'
    store.user = mockUser('Bob')

    await store.logout()

    expect(logoutWithTokenMock).toHaveBeenCalledWith('will-clear')
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(localStorage.removeItem).toHaveBeenCalledWith('tauri-app:auth')
  })
})
