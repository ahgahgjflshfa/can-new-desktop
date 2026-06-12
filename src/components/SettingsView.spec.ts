import { mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import SettingsView from './SettingsView.vue'

const openCameraViewerMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/cameraViewerService', () => ({
  openCameraViewer: openCameraViewerMock,
}))

vi.mock('@/services/logExportService', () => ({
  exportAppLogs: vi.fn(),
}))

describe('SettingsView', () => {
  test('does not show camera viewer controls in settings', () => {
    const wrapper = mount(SettingsView)

    expect(wrapper.text()).not.toContain('攝影機觀看頁面')
    expect(wrapper.text()).not.toContain('Open Viewer')
    expect(openCameraViewerMock).not.toHaveBeenCalled()
  })
})
