import { beforeEach, describe, expect, test, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
const openMock = vi.hoisted(() => vi.fn())
const isTauriRuntimeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: openMock,
}))

vi.mock('@/tauri/window', () => ({
  isTauriRuntime: isTauriRuntimeMock,
}))

import { openCameraViewer } from '@/services/cameraViewerService'

describe('cameraViewerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('opens external browser when tauri runtime is unavailable', async () => {
    isTauriRuntimeMock.mockReturnValue(false)

    await openCameraViewer('https://vendor.example.com/viewer')

    expect(openMock).toHaveBeenCalledWith('https://vendor.example.com/viewer')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  test('uses tauri command when runtime is available', async () => {
    isTauriRuntimeMock.mockReturnValue(true)
    invokeMock.mockResolvedValue(undefined)

    await openCameraViewer('https://vendor.example.com/viewer')

    expect(invokeMock).toHaveBeenCalledWith('open_camera_viewer', {
      url: 'https://vendor.example.com/viewer',
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  test('falls back to external browser when tauri command fails', async () => {
    isTauriRuntimeMock.mockReturnValue(true)
    invokeMock.mockRejectedValue(new Error('failed'))

    await openCameraViewer('https://vendor.example.com/viewer')

    expect(openMock).toHaveBeenCalledWith('https://vendor.example.com/viewer')
  })

  test('throws when url is missing', async () => {
    await expect(openCameraViewer('   ')).rejects.toThrow('缺少攝影機觀看頁面網址')
  })
})
