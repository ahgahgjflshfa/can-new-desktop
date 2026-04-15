<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'

const store = useStore()
const authStore = useAuthStore()

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'tauri-app:sidebarCollapsed'
const isSidebarCollapsed = ref(false)

const navItems = [
  { id: 'notifications', label: 'Alerts', shortLabel: 'Alerts', icon: 'i-mdi-bell-ring-outline' },
  { id: 'stream-test', label: 'Stream Test', shortLabel: 'Streams', icon: 'i-mdi-play-box-multiple-outline' },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: 'i-mdi-cog-outline' },
] as const

const currentNavItem = computed(() => navItems.find(item => item.id === store.currentView) ?? navItems[0])

const userInitial = computed(() => authStore.user?.name?.trim().charAt(0).toUpperCase() ?? 'A')

const userMeta = computed(() => authStore.user?.stationId ?? authStore.user?.role ?? 'Station Service')

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
  <div class="h-screen w-screen overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)] font-sans antialiased">
    <div class="flex h-full w-full overflow-hidden bg-[var(--app-surface)]">
      <aside
        class="relative hidden shrink-0 border-r border-[var(--app-border)] bg-[var(--app-surface)]/98 md:flex md:flex-col"
        :class="[isSidebarCollapsed ? 'w-24' : 'w-[280px]']"
      >
        <div class="px-6 pb-6 pt-10" :class="isSidebarCollapsed ? 'px-4' : ''">
          <div class="flex items-start gap-4" :class="isSidebarCollapsed ? 'flex-col items-center gap-3' : ''">
            <div
              class="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-[var(--app-primary-strong)]"
            >
              <div class="i-mdi-train-car-passenger text-[1.8rem]" />
            </div>
            <div v-if="!isSidebarCollapsed" class="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[1.05rem] font-black tracking-tight text-[var(--app-primary-strong)]">
                  Station Service
                </div>
                <div class="text-sm text-[var(--app-muted)]">Operations Console</div>
              </div>

              <button
                type="button"
                class="group flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] text-[var(--app-muted)] transition-all duration-200 hover:border-[var(--app-primary)] hover:text-[var(--app-primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30"
                :aria-label="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                @click="toggleSidebar"
              >
                <span
                  class="i-mdi-chevron-double-left h-5 w-5 transition-transform duration-200 group-hover:-translate-x-0.5"
                />
              </button>
            </div>

            <button
              v-else
              type="button"
              class="group flex h-9 w-9 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] text-[var(--app-muted)] transition-all duration-200 hover:border-[var(--app-primary)] hover:text-[var(--app-primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30"
              :aria-label="isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
              @click="toggleSidebar"
            >
              <span
                class="i-mdi-chevron-double-right h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </button>
          </div>
        </div>

        <nav class="flex-1 space-y-3 px-4 pb-6 overflow-y-auto overflow-x-hidden">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="setView(item.id)"
            :title="isSidebarCollapsed ? item.label : undefined"
            :aria-label="item.label"
            type="button"
            class="group flex w-full items-center rounded-full border transition-all duration-200"
            :class="[
              store.currentView === item.id
                ? 'border-transparent bg-[var(--app-nav-active-bg)] text-[var(--app-primary-strong)] shadow-[inset_0_0_0_1px_rgba(156,123,215,0.08)]'
                : 'border-transparent text-[var(--app-muted)] hover:border-[var(--app-border)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-fg)]',
              isSidebarCollapsed ? 'mx-auto h-12 w-12 justify-center' : 'px-5 py-4',
            ]"
          >
            <div
              :class="[
                item.icon,
                'shrink-0 transition-colors',
                isSidebarCollapsed ? 'text-2xl' : 'text-[1.35rem]',
                store.currentView === item.id
                  ? 'text-[var(--app-primary-strong)]'
                  : 'text-[var(--app-muted)] group-hover:text-[var(--app-primary-strong)]',
              ]"
            />

            <div v-if="!isSidebarCollapsed" class="ml-4 flex min-w-0 flex-1 items-center justify-between gap-3">
              <span class="truncate text-[1.05rem] font-semibold">{{ item.label }}</span>
            </div>
          </button>
        </nav>

        <div class="border-t border-[var(--app-border)] px-4 pb-6 pt-5">
          <button
            type="button"
            class="flex w-full items-center rounded-full px-4 py-3 text-left text-[var(--app-danger)] transition-colors hover:bg-[var(--app-surface-2)]"
            :class="isSidebarCollapsed ? 'justify-center px-0' : ''"
            @click="handleLogout"
          >
            <span class="i-mdi-logout text-xl" />
            <span v-if="!isSidebarCollapsed" class="ml-4 text-lg font-medium">登出</span>
          </button>
        </div>
      </aside>

      <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-surface-3)]">
        <header class="border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-5 md:px-10">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-[2rem] font-black tracking-tight text-[var(--app-fg-strong)] md:text-[2.2rem]">
                {{ currentNavItem.label }}
              </div>
            </div>

            <div class="flex items-center gap-4">
              <div class="hidden text-right md:block">
                <div class="text-lg font-semibold text-[var(--app-fg-strong)]">{{ userMeta }}</div>
                <div class="text-sm text-[var(--app-muted)]">{{ authStore.user?.name }}</div>
              </div>
              <div
                class="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-accent)] text-2xl font-bold text-[var(--app-primary-strong)]"
              >
                {{ userInitial }}
              </div>
            </div>
          </div>
        </header>

        <div
          class="flex-1 overflow-y-auto pb-20 md:pb-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[color:var(--app-scrollbar-thumb)]"
        >
          <slot />
        </div>
      </main>
    </div>

    <nav
      class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--app-surface)] border-t border-[var(--app-border)] flex items-center justify-around z-50 pb-safe"
    >
      <button
        v-for="item in navItems"
        :key="item.id"
        @click="setView(item.id)"
        class="flex flex-col items-center justify-center w-full h-full space-y-1 active:scale-95 transition-transform"
        :class="[store.currentView === item.id ? 'text-[var(--app-primary-strong)]' : 'text-[var(--app-muted)]']"
      >
        <div :class="[item.icon, 'text-2xl']" />
        <span class="text-[10px] font-medium">{{ item.shortLabel }}</span>
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
