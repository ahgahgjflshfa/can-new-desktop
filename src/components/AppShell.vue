<script setup lang="ts">
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'

const store = useStore()
const authStore = useAuthStore()

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'tauri-app:sidebarCollapsed'
const isSidebarCollapsed = ref(false)

const navItems = [
  { id: 'home', label: 'Home', icon: 'i-mdi-home' },
  { id: 'notifications', label: 'Alerts', icon: 'i-mdi-bell-ring' },
  { id: 'settings', label: 'Settings', icon: 'i-mdi-cog' },
] as const

onMounted(() => {
  if (typeof localStorage === 'undefined') return
  isSidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
})

function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, isSidebarCollapsed.value ? '1' : '0')
}

function setView(view: typeof store.currentView) {
  store.currentView = view
}

async function handleLogout() {
  void authStore.logout()
}
</script>

<template>
  <div class="flex h-screen w-screen bg-[var(--app-bg)] text-[var(--app-fg)] overflow-hidden font-sans antialiased">
    <!-- Desktop Sidebar -->
    <aside
      class="hidden md:flex flex-col bg-[var(--app-surface)] border-r border-[var(--app-border)] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] relative"
      :class="[isSidebarCollapsed ? 'w-20' : 'w-64']"
    >
      <button
        type="button"
        class="group absolute top-1/2 -right-4 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] shadow-md shadow-black/40 transition-all duration-200 hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        :aria-label="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        <span
          v-if="!isSidebarCollapsed"
          class="i-mdi-chevron-double-left h-5 w-5 transition-transform duration-200 group-hover:-translate-x-0.5"
        />
        <span
          v-else
          class="i-mdi-chevron-double-right h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </button>

      <div
        class="border-b border-[var(--app-border)] overflow-hidden"
        :class="
          isSidebarCollapsed
            ? 'h-20 flex flex-col items-center justify-center gap-2 py-3'
            : 'h-16 flex items-center px-4 whitespace-nowrap'
        "
      >
        <div
          class="rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-900/20"
          :class="isSidebarCollapsed ? 'w-9 h-9' : 'w-8 h-8'"
        >
          <div class="i-mdi-rocket-launch text-[var(--app-fg-strong)] text-lg" />
        </div>

        <span v-if="!isSidebarCollapsed" class="font-bold text-lg tracking-tight text-[var(--app-fg-strong)] ml-3"
          >Tauri App</span
        >
      </div>

      <nav class="flex-1 p-3 space-y-2 overflow-y-auto overflow-x-hidden">
        <button
          v-for="item in navItems"
          :key="item.id"
          @click="setView(item.id)"
          :title="isSidebarCollapsed ? item.label : undefined"
          :aria-label="item.label"
          type="button"
          class="w-full flex items-center rounded-xl transition-all duration-200 group relative"
          :class="[
            store.currentView === item.id
              ? 'bg-[var(--app-nav-active-bg)] text-sky-400 shadow-md shadow-black/10'
              : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]',
            isSidebarCollapsed ? 'h-12 w-12 mx-auto justify-center' : 'px-3 py-3',
          ]"
        >
          <div
            :class="[
              item.icon,
              'transition-colors shrink-0',
              isSidebarCollapsed ? 'text-2xl' : 'text-xl',
              store.currentView === item.id
                ? 'text-sky-400'
                : 'text-[var(--app-muted)] group-hover:text-[var(--app-fg)]',
            ]"
          />

          <span v-if="!isSidebarCollapsed" class="font-medium whitespace-nowrap ml-3">{{ item.label }}</span>
        </button>
      </nav>

      <div class="p-3 border-t border-[var(--app-border)] flex flex-col gap-2">
        <div
          v-if="!isSidebarCollapsed"
          class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-2 text-xs"
        >
          <div class="font-medium text-[var(--app-fg)]">{{ authStore.user?.name }}</div>
          <div class="text-[var(--app-muted)]">{{ authStore.user?.stationId }} · {{ authStore.user?.role }}</div>
        </div>

        <button
          type="button"
          class="w-full rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
          @click="handleLogout"
        >
          <span class="i-mdi-logout mr-1" />
          Sign out
        </button>

        <div
          class="text-xs text-[var(--app-muted-2)] text-center overflow-hidden whitespace-nowrap transition-opacity duration-300"
          :class="[isSidebarCollapsed ? 'opacity-0 h-0' : 'opacity-100']"
        >
          v{{ store.version }}
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col relative overflow-hidden bg-[var(--app-bg)]">
      <div
        class="flex-1 overflow-y-auto pb-20 md:pb-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[color:var(--app-scrollbar-thumb)]"
      >
        <slot />
      </div>
    </main>

    <!-- Mobile Bottom Nav -->
    <nav
      class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--app-surface)] border-t border-[var(--app-border)] flex items-center justify-around z-50 pb-safe"
    >
      <button
        v-for="item in navItems"
        :key="item.id"
        @click="setView(item.id)"
        class="flex flex-col items-center justify-center w-full h-full space-y-1 active:scale-95 transition-transform"
        :class="[store.currentView === item.id ? 'text-sky-400' : 'text-[var(--app-muted)]']"
      >
        <div :class="[item.icon, 'text-2xl']" />
        <span class="text-[10px] font-medium">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* Safe area padding for mobile devices */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom);
}
</style>
