<script setup lang="ts">
import { computed, ref } from 'vue'
import { ManagedStreamPlayer } from '@/components/stream'
import type { StreamConfig } from '@/types/stream'

const streamUrlInput = ref('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
const activeConfig = ref<StreamConfig>({
  sourceType: 'hls',
  sourceUrl: streamUrlInput.value,
})

const canLoad = computed(() => streamUrlInput.value.trim().length > 0)
const playerKey = computed(() => `${activeConfig.value.sourceType}:${activeConfig.value.sourceUrl}`)

function applyStreamUrl() {
  const nextUrl = streamUrlInput.value.trim()
  if (!nextUrl) {
    return
  }

  activeConfig.value = {
    sourceType: 'hls',
    sourceUrl: nextUrl,
  }
}
</script>

<template>
  <div class="min-h-full px-6 py-6 md:px-8 md:py-8">
    <div class="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-6">
      <div class="space-y-2 text-center">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--app-muted)]">內部測試頁面</p>
        <h1 class="text-3xl font-bold text-[var(--app-fg-strong)]">串流測試</h1>
        <p class="mx-auto max-w-2xl text-sm leading-relaxed text-[var(--app-muted)]">
          可在此頁籤驗證 HLS 播放、狀態切換、重試行為與控制邏輯，再整合進正式流程。
        </p>
      </div>

      <section
        class="rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[0_18px_40px_rgba(29,27,32,0.08)]"
      >
        <div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label class="block">
            <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]"
              >HLS 位址</span
            >
            <input
              v-model="streamUrlInput"
              type="url"
              class="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 py-3 text-sm text-[var(--app-fg-strong)] outline-none transition-colors placeholder:text-[var(--app-muted-2)] focus:border-[var(--app-primary)]"
              placeholder="https://example.com/live.m3u8"
              spellcheck="false"
            />
          </label>

          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--app-primary-strong)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--app-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canLoad"
            @click="applyStreamUrl"
          >
            <span class="i-mdi-play-circle-outline text-base" />
            載入串流
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1"
            >來源：HLS</span
          >
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1"
            >置中測試區</span
          >
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1">
            尚未放入正式介面
          </span>
        </div>
      </section>

      <div class="mx-auto w-full max-w-5xl">
        <ManagedStreamPlayer
          :key="playerKey"
          :stream-config="activeConfig"
          title="攝影機播放測試"
          source-label="HLS 驗證"
          :autoplay="true"
        />
      </div>
    </div>
  </div>
</template>
