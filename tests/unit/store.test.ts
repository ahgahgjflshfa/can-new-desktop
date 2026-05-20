import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStore } from '@/store'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

describe('main store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    const storage: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  test('setCameraViewerUrl trims and stores the url', () => {
    const store = useStore()

    store.setCameraViewerUrl('  https://vendor.example.com/viewer  ')

    expect(store.cameraViewerUrl).toBe('https://vendor.example.com/viewer')
  })

  test('initApp hydrates persisted camera viewer url', () => {
    localStorage.setItem(
      'tauri-app:settings',
      JSON.stringify({
        minimizeToTrayOnClose: true,
        cameraViewerUrl: 'https://vendor.example.com/viewer',
      })
    )

    const store = useStore()
    store.initApp()

    expect(store.cameraViewerUrl).toBe('https://vendor.example.com/viewer')
  })

  test('isReady reflects initialization state', () => {
    const store = useStore()

    expect(store.isReady).toBe(false)

    store.initApp()

    expect(store.isReady).toBe(true)
  })
})
