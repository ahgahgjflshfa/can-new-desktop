<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlayerState } from '@/services/stream/playerCore'
import StreamControls from './StreamControls.vue'
import StreamStatusBadge from './StreamStatusBadge.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    sourceLabel?: string
    state: PlayerState
    muted?: boolean
  }>(),
  {
    title: 'Camera Stream',
    sourceLabel: 'HLS Source',
    muted: false,
  }
)

const emit = defineEmits<{
  play: []
  pause: []
  stop: []
  retry: []
  toggleMute: []
  videoReady: [HTMLVideoElement]
}>()

const videoEl = ref<HTMLVideoElement | null>(null)

const shouldShowCompactBuffering = computed(() => props.state.status === 'buffering')

const overlayModel = computed(() => {
  if (props.state.status === 'error' && props.state.error) {
    return {
      kind: 'error' as const,
      icon: 'i-mdi-alert-circle-outline',
      title: 'Playback interrupted',
      body: props.state.error.message,
      actionLabel: props.state.error.retryable ? 'Retry Stream' : null,
    }
  }

  if (props.state.status === 'reconnecting') {
    return {
      kind: 'loading' as const,
      icon: 'i-mdi-refresh animate-spin',
      title: 'Reconnecting stream',
      body: 'The connection dropped. Attempting to restore playback.',
      actionLabel: null,
    }
  }

  if (props.state.status === 'loading') {
    return {
      kind: 'loading' as const,
      icon: 'i-mdi-loading animate-spin',
      title: 'Loading video',
      body: 'Preparing the first frames for playback.',
      actionLabel: null,
    }
  }

  if (props.state.status === 'paused') {
    return {
      kind: 'action' as const,
      icon: 'i-mdi-play-circle',
      title: 'Paused',
      body: 'Press play to continue from the current frame.',
      actionLabel: 'Resume',
    }
  }

  if (props.state.status === 'stopped') {
    return {
      kind: 'action' as const,
      icon: 'i-mdi-replay',
      title: 'Playback stopped',
      body: 'Press play to start the stream again.',
      actionLabel: 'Play Again',
    }
  }

  if (props.state.status === 'idle') {
    return {
      kind: 'action' as const,
      icon: 'i-mdi-play-circle-outline',
      title: 'Ready to play',
      body: 'Start playback when you want to preview the stream.',
      actionLabel: 'Start Playback',
    }
  }

  return null
})

onMounted(() => {
  if (videoEl.value) {
    emit('videoReady', videoEl.value)
  }
})
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-2)] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]"
  >
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--app-muted)]">{{ sourceLabel }}</p>
        <h2 class="mt-1 text-2xl font-bold text-[var(--app-fg-strong)]">{{ title }}</h2>
      </div>

      <StreamStatusBadge :status="state.status" />
    </header>

    <div class="relative overflow-hidden rounded-2xl border border-[var(--app-border)] bg-slate-950">
      <div
        class="aspect-video w-full bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(180deg,_rgba(15,23,42,0.92),_rgba(2,6,23,1))]"
      >
        <video ref="videoEl" class="h-full w-full object-cover" :muted="muted" playsinline />
      </div>

      <div
        v-if="shouldShowCompactBuffering"
        class="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-slate-950/78 px-3 py-1.5 text-xs font-semibold tracking-[0.12em] text-white shadow-lg shadow-black/25 backdrop-blur-md"
      >
        <span class="i-mdi-loading animate-spin text-sm text-sky-300" />
        Buffering
      </div>

      <div
        v-if="overlayModel"
        class="absolute inset-0 flex items-center justify-center bg-slate-950/64 backdrop-blur-[2px]"
      >
        <div
          class="mx-6 max-w-md rounded-2xl border border-white/10 bg-slate-900/78 px-6 py-5 text-center shadow-2xl shadow-black/30"
        >
          <span :class="overlayModel.icon" class="mx-auto mb-3 block text-3xl text-sky-300" />
          <div class="text-lg font-semibold text-white">{{ overlayModel.title }}</div>
          <p class="mt-2 text-sm leading-relaxed text-slate-300">{{ overlayModel.body }}</p>

          <button
            v-if="overlayModel.actionLabel"
            type="button"
            class="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
            @click="overlayModel.kind === 'error' ? $emit('retry') : $emit('play')"
          >
            <span :class="overlayModel.kind === 'error' ? 'i-mdi-refresh' : 'i-mdi-play'" />
            {{ overlayModel.actionLabel }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="state.stats" class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
        <div class="text-xs uppercase tracking-[0.18em] text-[var(--app-muted)]">Startup</div>
        <div class="mt-1 text-lg font-semibold text-[var(--app-fg-strong)]">{{ state.stats.startupTimeMs }}ms</div>
      </div>
      <div class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
        <div class="text-xs uppercase tracking-[0.18em] text-[var(--app-muted)]">Reconnects</div>
        <div class="mt-1 text-lg font-semibold text-[var(--app-fg-strong)]">{{ state.stats.reconnectCount }}</div>
      </div>
      <div class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
        <div class="text-xs uppercase tracking-[0.18em] text-[var(--app-muted)]">Buffers</div>
        <div class="mt-1 text-lg font-semibold text-[var(--app-fg-strong)]">{{ state.stats.bufferCount }}</div>
      </div>
    </div>

    <StreamControls
      :status="state.status"
      :muted="muted"
      @play="$emit('play')"
      @pause="$emit('pause')"
      @stop="$emit('stop')"
      @retry="$emit('retry')"
      @toggle-mute="$emit('toggleMute')"
    />
  </section>
</template>
