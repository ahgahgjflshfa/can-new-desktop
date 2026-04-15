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
  <div
    class="min-h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(103,80,164,0.08),_transparent_30%),linear-gradient(180deg,_#f7f2fa_0%,_#f3f0f4_100%)] px-4 py-5 text-[#1d1b20] sm:px-6 sm:py-6"
  >
    <div class="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-3xl place-items-center sm:min-h-[calc(100vh-4rem)]">
      <div
        class="flex min-h-[458px] w-full max-w-[390px] flex-col rounded-[1.5rem] border border-[#cac4d0] bg-[#fffbfe] px-5 py-6 shadow-[0_18px_36px_rgba(29,27,32,0.08)] sm:px-7 sm:py-7"
      >
        <div class="mb-6 text-center sm:mb-7">
          <div
            class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#e8def8] text-[#6750a4] shadow-[0_8px_18px_rgba(103,80,164,0.14)]"
          >
            <span class="i-mdi-headset text-[1.45rem]" />
          </div>

          <h1 class="text-[1.65rem] font-black tracking-tight text-[#1d1b20] sm:text-[1.95rem]">車站服務系統後台</h1>
          <p class="mt-1.5 text-[0.95rem] font-semibold text-[#625b71] sm:text-[1.15rem]">
            Station Service System Login
          </p>
        </div>

        <form class="flex flex-1 flex-col gap-3.5" @submit.prevent="submitLogin">
          <label class="block">
            <span class="mb-1.5 block text-xs font-semibold tracking-wide text-[#625b71]">帳號 (Account)</span>
            <input
              id="account"
              v-model="form.account"
              autocomplete="username"
              class="m-0 h-12 w-full rounded-[0.95rem] border border-[#79747e] bg-[#fffbfe] px-4 text-base text-[#1d1b20] shadow-none transition-all placeholder:text-[#938f99] focus:border-[#6750a4] focus:outline-none focus:ring-4 focus:ring-[#e8def8]"
              placeholder="請輸入帳號"
              type="text"
            />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs font-semibold tracking-wide text-[#625b71]">密碼 (Password)</span>
            <div class="relative">
              <input
                id="password"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                class="m-0 h-12 w-full rounded-[0.95rem] border border-[#79747e] bg-[#fffbfe] px-4 pr-12 text-base text-[#1d1b20] shadow-none transition-all placeholder:text-[#938f99] focus:border-[#6750a4] focus:outline-none focus:ring-4 focus:ring-[#e8def8]"
                placeholder="請輸入密碼"
              />

              <button
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                class="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[0.95rem] text-[#625b71] transition-colors hover:text-[#6750a4] focus:outline-none"
                type="button"
                @click="showPassword = !showPassword"
              >
                <span :class="showPassword ? 'i-mdi-eye text-[1.15rem]' : 'i-mdi-eye-off text-[1.15rem]'" />
              </button>
            </div>
          </label>

          <p
            v-if="formError"
            class="rounded-2xl border border-[#f2b8b5] bg-[#f9dedc] px-4 py-3 text-sm font-medium text-[#b3261e]"
          >
            {{ formError }}
          </p>

          <button
            :disabled="!canSubmit"
            class="mt-auto h-12 w-full rounded-full bg-[#6750a4] px-4 text-lg font-bold tracking-[0.16em] text-white shadow-[0_14px_26px_rgba(103,80,164,0.22)] transition-all hover:bg-[#5d4698] disabled:cursor-not-allowed disabled:bg-[#d0c7dd] disabled:text-[#7b7585] disabled:shadow-none"
            type="submit"
          >
            {{ authStore.isSubmitting ? '登入中' : '登入' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
