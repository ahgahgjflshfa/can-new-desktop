import { mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { useStore } from '@/store'
import SettingsView from './SettingsView.vue'

const openCameraViewerMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/cameraViewerService', () => ({
  openCameraViewer: openCameraViewerMock,
}))

vi.mock('@/services/logExportService', () => ({
  exportAppLogs: vi.fn(),
}))

describe('SettingsView', () => {
  test('opens camera viewer from settings', async () => {
    const wrapper = mount(SettingsView)
    const store = useStore()

    store.setCameraViewerUrl('https://vendor.example.com/viewer')
    await wrapper.vm.$nextTick()

    const button = wrapper
      .findAll('button[type="button"]')
      .find(candidate => candidate.text().includes('Open Viewer'))

    expect(button).toBeTruthy()
    if (!button) {
      throw new Error('camera viewer button not found')
    }

    await button.trigger('click')

    expect(openCameraViewerMock).toHaveBeenCalledWith('https://vendor.example.com/viewer')
  })
})
