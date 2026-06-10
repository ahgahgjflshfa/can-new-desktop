import { defineStore } from 'pinia'
import { useAuthStore } from './authStore'

export const useSystemStore = defineStore('system', {
  state: () => ({
    currentView: 'lma' as 'lma' | 'can' | 'settings',
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
    currentSystemLabel: state => {
      switch (state.currentView) {
        case 'lma': return '立碼幫幫忙'
        case 'can': return 'Q 潔淨立馬清'
        case 'settings': return '設定'
      }
    },
  },

  actions: {
    switchView(view: 'lma' | 'can' | 'settings') {
      if (this.currentView === view) return
      this.currentView = view

      if (view === 'lma' || view === 'can') {
        const authStore = useAuthStore()
        authStore.switchSystem(view)
      }
    },
  },
})
