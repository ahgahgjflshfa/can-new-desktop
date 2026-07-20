import { defineStore } from 'pinia'
import { useAuthStore } from './authStore'
import type { SystemType } from '@/types/system'

export const useSystemStore = defineStore('system', {
  state: () => ({
    currentView: 'lma' as SystemType | 'settings',
  }),

  getters: {
    isLmaAuthenticated: () => {
      const authStore = useAuthStore()
      return authStore.isSystemAuthenticated('lma')
    },
    isCanAuthenticated: () => {
      const authStore = useAuthStore()
      return authStore.isSystemAuthenticated('can')
    },
    isChargeAuthenticated: () => {
      const authStore = useAuthStore()
      return authStore.isSystemAuthenticated('charge')
    },
    currentSystemLabel: state => {
      switch (state.currentView) {
        case 'lma': return '立碼幫幫忙'
        case 'can': return 'Q 潔淨立馬清'
        case 'charge': return '無線充故障'
        case 'settings': return '設定'
      }
    },
  },

  actions: {
    switchView(view: SystemType | 'settings') {
      if (this.currentView === view) return
      this.currentView = view

      if (view === 'lma' || view === 'can' || view === 'charge') {
        const authStore = useAuthStore()
        authStore.switchSystem(view)
      }
    },
  },
})
