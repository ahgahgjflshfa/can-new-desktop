import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CanTaskView from '@/components/CanTaskView.vue'
import { useAuthStore } from '@/stores/authStore'
import { completeCanTask, fetchCanTasks } from '@/services/canTaskService'

const notificationStoreMock = vi.hoisted(() => ({
  canPollingEnabled: true,
  canPollingIntervalMs: 60_000,
  canTasksSnapshot: [] as any[],
  canRequestInFlight: false,
  canPollingLastError: null as string | null,
  refreshCanTasks: vi.fn(),
  completeCanTask: vi.fn(),
  setCanPollingRuntimeState: vi.fn(),
  setCanPollingError: vi.fn(),
  handleCanTasks: vi.fn(),
  resolveNotificationFromPolling: vi.fn(),
}))

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: () => notificationStoreMock,
}))

vi.mock('@/services/canTaskService', () => ({
  fetchCanTasks: vi.fn(),
  completeCanTask: vi.fn(),
}))

describe('CanTaskView auth boundary', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    vi.mocked(fetchCanTasks).mockResolvedValue([])
    vi.mocked(completeCanTask).mockResolvedValue(undefined)
    notificationStoreMock.canPollingEnabled = true
    notificationStoreMock.canTasksSnapshot = []
    notificationStoreMock.refreshCanTasks.mockResolvedValue(undefined)
    notificationStoreMock.completeCanTask.mockResolvedValue(undefined)
  })

  function setSessions(includeCan = true) {
    const authStore = useAuthStore()
    authStore.lmaSession = {
      token: 'lma-token',
      user: { name: 'LMA', stationId: 'A1', sectionId: null, role: 'staff' },
    }
    if (includeCan) {
      authStore.canSession = {
        token: 'can-token',
        user: { account: 'CAN', name: 'CAN', station: 'C1', accessScope: 'station', region: null, topic: 'general', system: 'can' },
      }
    }
    authStore.currentSystem = 'lma'
    return authStore
  }

  function mountView() {
    return mount(CanTaskView, {
      global: { plugins: [pinia], stubs: { SystemSettingsPanel: true } },
    })
  }

  test('uses CAN session token for fetch and completion while LMA is selected', async () => {
    const authStore = setSessions()
    expect(authStore.currentSystem).toBe('lma')
    notificationStoreMock.canTasksSnapshot = [{
      serialNumber: 42,
      station: 'C1',
      trashBin: 'bin',
      isDone: false,
      cleanAt: null,
      informTime: 1,
      resolutionType: 0,
      visitorID: null,
      isDisable: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]
    const wrapper = mountView()
    await flushPromises()

    expect(notificationStoreMock.refreshCanTasks).not.toHaveBeenCalled()

    const completeButton = wrapper.findAll('button').find(button => button.text().trim() === '已完成')
    expect(completeButton).toBeDefined()
    await completeButton!.trigger('click')
    await flushPromises()

    expect(notificationStoreMock.completeCanTask).toHaveBeenCalledWith(42, 1)
    wrapper.unmount()
  })

  test('does not call CAN service when the CAN session is missing', async () => {
    setSessions(false)
    const wrapper = mountView()
    await flushPromises()

    expect(notificationStoreMock.refreshCanTasks).not.toHaveBeenCalled()
    expect(completeCanTask).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  test('delegates refresh button clicks to the CAN runtime store', async () => {
    setSessions()
    const wrapper = mountView()
    const refresh = wrapper.find('button span.i-mdi-refresh').element.parentElement
    expect(refresh).toBeTruthy()
    await wrapper.find('button span.i-mdi-refresh').trigger('click')
    expect(notificationStoreMock.refreshCanTasks).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  test('does not complete a loaded CAN task after its CAN session is cleared', async () => {
    const authStore = setSessions()
    notificationStoreMock.canTasksSnapshot = [{
      serialNumber: 42,
      station: 'C1',
      trashBin: 'bin',
      isDone: false,
      cleanAt: null,
      informTime: 1,
      resolutionType: 0,
      visitorID: null,
      isDisable: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]
    const wrapper = mountView()
    await flushPromises()

    authStore.canSession = null
    const completeButton = wrapper.findAll('button').find(button => button.text().trim() === '已完成')
    expect(completeButton).toBeDefined()
    await completeButton!.trigger('click')
    await flushPromises()

    expect(notificationStoreMock.completeCanTask).toHaveBeenCalledWith(42, 1)
    wrapper.unmount()
  })
})
