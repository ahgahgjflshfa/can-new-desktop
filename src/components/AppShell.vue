<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from '@/store'
import { useAuthStore } from '@/stores/authStore'

const store = useStore()
const authStore = useAuthStore()

const navItems = [
  { id: 'notifications', label: '警示通知', shortLabel: '警示', icon: 'i-mdi-bell-ring-outline' },
  { id: 'settings', label: '設定', shortLabel: '設定', icon: 'i-mdi-cog-outline' },
] as const

const currentNavItem = computed(() => navItems.find(item => item.id === store.currentView) ?? navItems[0])

const userInitial = computed(() => authStore.user?.name?.trim().charAt(0).toUpperCase() ?? 'A')

const userMeta = computed(() => authStore.user?.stationId ?? authStore.user?.role ?? '車站服務')

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
        class="relative hidden w-[264px] shrink-0 border-r border-[var(--app-border)] bg-[var(--app-surface)]/98 md:flex md:flex-col"
      >
        <div class="px-5 pb-5 pt-8">
          <div class="flex items-center gap-4">
            <div
              class="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-[var(--app-primary-strong)]"
            >
              <div class="i-mdi-train-car-passenger text-[1.55rem]" />
            </div>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div class="min-w-0 self-center">
                <div class="text-[0.98rem] font-black tracking-tight text-[var(--app-primary-strong)]">車站服務</div>
                <div class="text-[0.82rem] text-[var(--app-muted)]">營運控制台</div>
              </div>
            </div>
          </div>
        </div>

        <nav class="flex-1 space-y-2.5 px-4 pb-5 overflow-y-auto overflow-x-hidden">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="setView(item.id)"
            :aria-label="item.label"
            type="button"
            class="group flex w-full items-center rounded-full border transition-all duration-200"
            :class="[
              store.currentView === item.id
                ? 'border-transparent bg-[var(--app-nav-active-bg)] text-[var(--app-primary-strong)] shadow-[inset_0_0_0_1px_rgba(156,123,215,0.08)]'
                : 'border-transparent text-[var(--app-muted)] hover:border-[var(--app-border)] hover:bg-[var(--app-surface-2)] hover:text-[var(--app-fg)]',
              'px-4 py-3.5',
            ]"
          >
            <div
              :class="[
                item.icon,
                'shrink-0 transition-colors',
                'text-[1.2rem]',
                store.currentView === item.id
                  ? 'text-[var(--app-primary-strong)]'
                  : 'text-[var(--app-muted)] group-hover:text-[var(--app-primary-strong)]',
              ]"
            />

            <div class="ml-4 flex min-w-0 flex-1 items-center justify-between gap-3">
              <span class="truncate text-[0.98rem] font-semibold">{{ item.label }}</span>
            </div>
          </button>
        </nav>

        <div class="border-t border-[var(--app-border)] px-4 pb-5 pt-4">
          <button
            type="button"
            class="flex w-full items-center rounded-full px-4 py-2.5 text-left text-[var(--app-danger)] transition-colors hover:bg-[var(--app-surface-2)]"
            @click="handleLogout"
          >
            <span class="i-mdi-logout text-[1.1rem]" />
            <span class="ml-3 text-[1rem] font-medium">登出</span>
          </button>
        </div>
      </aside>

      <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-surface-3)]">
        <header class="border-b border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4 md:px-8">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-[1.8rem] font-black tracking-tight text-[var(--app-fg-strong)] md:text-[2rem]">
                {{ currentNavItem.label }}
              </div>
            </div>

            <div class="flex items-center gap-3">
              <div class="hidden text-right md:block">
                <div class="text-[1rem] font-semibold text-[var(--app-fg-strong)]">{{ userMeta }}</div>
                <div class="text-[0.82rem] text-[var(--app-muted)]">{{ authStore.user?.name }}</div>
              </div>
              <div
                class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-accent)] text-[1.35rem] font-bold text-[var(--app-primary-strong)]"
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
