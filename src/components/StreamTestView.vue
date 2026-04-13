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
  <div class="min-h-full px-6 py-8">
    <div class="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-6">
      <div class="space-y-2 text-center">
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--app-muted)]">Internal Test Surface</p>
        <h1 class="text-3xl font-bold text-[var(--app-fg-strong)]">Stream Test</h1>
        <p class="mx-auto max-w-2xl text-sm leading-relaxed text-[var(--app-muted)]">
          Use this tab to validate HLS playback, state transitions, retry behavior, and control wiring before placing
          the player into the production flow.
        </p>
      </div>

      <section
        class="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)]"
      >
        <div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label class="block">
            <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]"
              >HLS URL</span
            >
            <input
              v-model="streamUrlInput"
              type="url"
              class="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 py-3 text-sm text-[var(--app-fg-strong)] outline-none transition-colors placeholder:text-[var(--app-muted-2)] focus:border-sky-500/60"
              placeholder="https://example.com/live.m3u8"
              spellcheck="false"
            />
          </label>

          <button
            type="button"
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canLoad"
            @click="applyStreamUrl"
          >
            <span class="i-mdi-play-circle-outline text-base" />
            Load Stream
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1"
            >Source: HLS</span
          >
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1"
            >Centered sandbox</span
          >
          <span class="rounded-full border border-[var(--app-border)] bg-[var(--app-surface-2)] px-3 py-1">
            No production placement yet
          </span>
        </div>
      </section>

      <div class="mx-auto w-full max-w-5xl">
        <ManagedStreamPlayer
          :key="playerKey"
          :stream-config="activeConfig"
          title="Camera Playback Sandbox"
          source-label="HLS Verification"
          :autoplay="true"
        />
      </div>
    </div>
  </div>
</template>
