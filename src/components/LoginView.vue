<script setup lang="ts">
import { useAuthStore } from '@/stores/authStore'

const authStore = useAuthStore()

const form = reactive({
  account: '',
  password: '',
})

const formError = ref<string | null>(null)

const canSubmit = computed(() => {
  return form.account.trim().length > 0 && form.password.length > 0 && !authStore.isSubmitting
})

async function submitLogin() {
  formError.value = null

  if (!canSubmit.value) {
    formError.value = 'Please enter account and password.'
    return
  }

  try {
    await authStore.login(form.account.trim(), form.password)
  } catch {
    formError.value = authStore.lastError ?? 'Unable to login.'
  }
}
</script>

<template>
  <div class="min-h-screen w-screen bg-[var(--app-bg)] text-[var(--app-fg)] grid place-items-center px-6">
    <div class="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-6 sm:p-8">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[var(--app-fg-strong)]">Sign in</h1>
        <p class="mt-2 text-sm text-[var(--app-muted)]">Use your employee account to continue.</p>
      </div>

      <form class="space-y-4" @submit.prevent="submitLogin">
        <div>
          <label class="mb-1 block text-sm text-[var(--app-muted)]" for="account">Account</label>
          <input
            id="account"
            v-model="form.account"
            autocomplete="username"
            class="m-0 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-2 text-[var(--app-fg)] focus:border-sky-500 focus:outline-none"
            placeholder="Enter account"
            type="text"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm text-[var(--app-muted)]" for="password">Password</label>
          <input
            id="password"
            v-model="form.password"
            autocomplete="current-password"
            class="m-0 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-2 text-[var(--app-fg)] focus:border-sky-500 focus:outline-none"
            placeholder="Enter password"
            type="password"
          />
        </div>

        <p v-if="formError" class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {{ formError }}
        </p>

        <button
          :disabled="!canSubmit"
          class="w-full rounded-lg bg-sky-600 px-4 py-2 font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
        >
          {{ authStore.isSubmitting ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
