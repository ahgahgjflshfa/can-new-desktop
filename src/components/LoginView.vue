<script setup lang="ts">
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()

const form = reactive({
  account: '',
  password: '',
})

const formError = ref<string | null>(null)
const showPassword = ref(false)

const canSubmit = computed(() => {
  return form.account.trim().length > 0 && form.password.length > 0 && !authStore.isSubmitting
})

  async function submitLogin() {
    formError.value = null

    if (!canSubmit.value) {
      formError.value = '請輸入帳號與密碼。'
      return
    }

    try {
      await authStore.login('lma', form.account.trim(), form.password)
    } catch {
      formError.value = authStore.lastError ?? '登入失敗，請稍後再試。'
    }
  }
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-4 py-8">
    <div class="w-full max-w-[400px] rounded-[1.4rem] border border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-6 shadow-lg">
      <div class="mb-6 text-center">
        <div
          class="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--app-primary-strong)]"
        >
          <span class="i-mdi-headset text-[1.3rem]" />
        </div>
        <h1 class="text-[1.4rem] font-black tracking-tight text-[var(--app-fg-strong)]">立碼幫幫忙</h1>
        <p class="mt-1 text-[0.88rem] font-semibold text-[var(--app-muted)]">立碼幫幫忙 登入</p>
      </div>

      <form class="flex flex-col gap-3.5" @submit.prevent="submitLogin">
        <label class="block">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--app-muted)]">帳號</span>
          <input
            id="account"
            v-model="form.account"
            autocomplete="username"
            class="m-0 h-12 w-full rounded-[0.95rem] border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 text-base text-[var(--app-fg)] shadow-none transition-all placeholder:text-[var(--app-muted-2)] focus:border-[var(--app-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--app-primary-surface)]"
            placeholder="請輸入帳號"
            type="text"
          />
        </label>

        <label class="block">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--app-muted)]">密碼</span>
          <div class="relative">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              class="m-0 h-12 w-full rounded-[0.95rem] border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 pr-12 text-base text-[var(--app-fg)] shadow-none transition-all placeholder:text-[var(--app-muted-2)] focus:border-[var(--app-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--app-primary-surface)]"
              placeholder="請輸入密碼"
            />

            <button
              :aria-label="showPassword ? '隱藏密碼' : '顯示密碼'"
              class="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[0.95rem] text-[var(--app-muted)] transition-colors hover:text-[var(--app-primary)] focus:outline-none"
              type="button"
              @click="showPassword = !showPassword"
            >
              <span :class="showPassword ? 'i-mdi-eye text-[1.15rem]' : 'i-mdi-eye-off text-[1.15rem]'" />
            </button>
          </div>
        </label>

        <p
          v-if="formError"
          class="rounded-2xl border border-[var(--app-danger)]/20 bg-[var(--app-danger)]/10 px-4 py-3 text-sm font-medium text-[var(--app-danger)]"
        >
          {{ formError }}
        </p>

        <button
          :disabled="!canSubmit"
          class="mt-2 h-12 w-full rounded-full bg-[var(--app-primary-strong)] px-4 text-lg font-bold tracking-[0.16em] text-white shadow-lg transition-all hover:bg-[var(--app-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
        >
          {{ authStore.isSubmitting ? '登入中' : '登入' }}
        </button>
      </form>
    </div>
  </div>
</template>
