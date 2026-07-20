import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import SystemSettingsPanel from '@/components/SystemSettingsPanel.vue'
import ChargeTaskView from '@/components/ChargeTaskView.vue'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSystemStore } from '@/stores/systemStore'
import { invoke } from '@tauri-apps/api/core'
import { fetchChargeTasks } from '@/services/chargeTaskService'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/services/chargeTaskService', () => ({ fetchChargeTasks: vi.fn() }))

describe('App charge routing', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('mounts authenticated charge settings without starting any task or polling lifecycle', () => {
    const authStore = useAuthStore()
    const systemStore = useSystemStore()
    const notificationStore = useNotificationStore()
    authStore.currentSystem = 'charge'
    authStore.chargeSession = {
      token: 'charge-token',
      user: { account: 'charge-account', name: 'Charge User', station: 'S1', system: 'charge' },
    }
    systemStore.currentView = 'charge'

    const pollingMutations = [
      vi.spyOn(notificationStore, 'setPollingEnabled'),
      vi.spyOn(notificationStore, 'setCanPollingEnabled'),
      vi.spyOn(notificationStore, 'setPollingInterval'),
      vi.spyOn(notificationStore, 'setCanPollingInterval'),
    ]
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const wrapper = mount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          LoginView: true,
          CanLoginView: true,
          CanTaskView: true,
          ChargeLoginView: true,
          NotificationsView: true,
          SettingsView: true,
        },
      },
    })

    expect(wrapper.findComponent(SystemSettingsPanel).exists()).toBe(true)
    expect(wrapper.text()).toContain('Charge User')
    expect(wrapper.text()).toContain('charge-account')
    expect(wrapper.text()).toContain('S1')
    expect(wrapper.text()).toContain('已建立')
    expect(pollingMutations.every(spy => spy.mock.calls.length === 0)).toBe(true)
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('charge_fetch_tasks')
    expect(wrapper.text()).not.toContain('無線充故障任務畫面即將推出。')
    expect(fetchChargeTasks).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('charge_fetch_tasks', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('charge_complete_task', expect.anything())
  })

  test('mounted ChargeTaskView is lifecycle-free and delegates refresh/completion to the store', async () => {
    const store = useNotificationStore()
    store.chargeTasksSnapshot = [{ serialNumber: 42, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'fault', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' }]
    const refresh = vi.spyOn(store, 'refreshChargeTasks').mockResolvedValue(undefined)
    const complete = vi.spyOn(store, 'completeChargeTask').mockResolvedValue(undefined)
    const timerSpy = vi.spyOn(globalThis, 'setInterval')
    const fetchSpy = vi.mocked(fetchChargeTasks)
    const wrapper = mount(ChargeTaskView, { global: { plugins: [pinia], stubs: { SystemSettingsPanel: true } } })
    expect(timerSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(42)
  })

  test('ChargeTaskView renders rejected action errors and charge settings dispatch interval while disabled', async () => {
    const store = useNotificationStore()
    store.chargePollingEnabled = false
    store.chargeTasksSnapshot = [{ serialNumber: 43, deviceCode: 'D', station: 'S1', status: 'pending', faultDescription: 'fault', faultType: 'x', resolutionType: 0, isDisable: false, createdAt: 'now', updatedAt: 'now' }]
    vi.spyOn(store, 'completeChargeTask').mockRejectedValue(new Error('completion failed'))
    vi.spyOn(store, 'refreshChargeTasks').mockRejectedValue(new Error('refresh failed'))
    const interval = vi.spyOn(store, 'setChargePollingInterval')
    const wrapper = mount(ChargeTaskView, { global: { plugins: [pinia], stubs: { SystemSettingsPanel: true } } })
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.text()).toContain('completion failed')
    const settings = mount(SystemSettingsPanel, { props: { system: 'charge' }, global: { plugins: [pinia] } })
    expect(settings.find('input[type="checkbox"]').exists()).toBe(true)
    await settings.find('input[type="checkbox"]').setValue(true)
    await settings.find('select').setValue('30')
    expect(interval).toHaveBeenCalledWith(30)
  })
})
