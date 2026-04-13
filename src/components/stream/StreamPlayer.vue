<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import StreamControls from './StreamControls.vue'
import StreamErrorPanel from './StreamErrorPanel.vue'
import StreamStatusBadge from './StreamStatusBadge.vue'
import type { StreamError, StreamStats, StreamStatus } from '@/types/stream'

const props = withDefaults(
  defineProps<{
    title?: string
    sourceLabel?: string
    status: StreamStatus
    error?: StreamError | null
    stats?: StreamStats | null
    isPlaying?: boolean
    muted?: boolean
    disabled?: boolean
  }>(),
  {
    title: 'Camera Stream',
    sourceLabel: 'HLS Source',
    error: null,
    stats: null,
    isPlaying: false,
    muted: false,
    disabled: false,
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

const overlayCopy = computed(() => {
  switch (props.status) {
    case 'connecting':
      return {
        icon: 'i-mdi-lan-connect',
        title: 'Connecting to camera',
        body: 'Preparing the HLS session and waiting for the first frames.',
      }
    case 'buffering':
      return {
        icon: 'i-mdi-loading animate-spin',
        title: 'Buffering video',
        body: 'The player is receiving segments and stabilizing playback.',
      }
    case 'reconnecting':
      return {
        icon: 'i-mdi-refresh animate-spin',
        title: 'Reconnecting stream',
        body: 'The connection dropped, attempting recovery now.',
      }
    case 'error':
      return {
        icon: 'i-mdi-alert-circle-outline',
        title: 'Playback interrupted',
        body: 'The stream needs attention before video can resume.',
      }
    case 'stopped':
      return {
        icon: 'i-mdi-stop-circle-outline',
        title: 'Stream stopped',
        body: 'Playback is paused and ready to restart when needed.',
      }
    case 'idle':
      return {
        icon: 'i-mdi-camcorder-off',
        title: 'Ready for playback',
        body: 'Attach a source and start the player to preview the camera feed.',
      }
    default:
      return null
  }
})

const formattedStats = computed(() => {
  if (!props.stats) {
    return []
  }

  return [
    { label: 'Startup', value: `${props.stats.startupTimeMs}ms` },
    { label: 'Reconnects', value: `${props.stats.reconnectCount}` },
    { label: 'Buffers', value: `${props.stats.bufferCount}` },
  ]
})

onMounted(() => {
  if (videoEl.value) {
    emit('videoReady', videoEl.value)
  }
})

defineExpose({
  videoEl,
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

      <StreamStatusBadge :status="status" />
    </header>

    <div class="relative overflow-hidden rounded-2xl border border-[var(--app-border)] bg-slate-950">
      <div
        class="aspect-video w-full bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(180deg,_rgba(15,23,42,0.92),_rgba(2,6,23,1))]"
      >
        <video ref="videoEl" class="h-full w-full object-cover" :muted="muted" playsinline />
      </div>

      <div
        v-if="overlayCopy"
        class="absolute inset-0 flex items-center justify-center bg-slate-950/64 backdrop-blur-[2px]"
      >
        <div
          class="mx-6 max-w-md rounded-2xl border border-white/10 bg-slate-900/78 px-6 py-5 text-center shadow-2xl shadow-black/30"
        >
          <span :class="overlayCopy.icon" class="mx-auto mb-3 block text-3xl text-sky-300" />
          <div class="text-lg font-semibold text-white">{{ overlayCopy.title }}</div>
          <p class="mt-2 text-sm leading-relaxed text-slate-300">{{ overlayCopy.body }}</p>

          <button
            v-if="status === 'error'"
            type="button"
            class="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
            @click="$emit('retry')"
          >
            <span class="i-mdi-refresh" />
            Retry Stream
          </button>
        </div>
      </div>
    </div>

    <div v-if="formattedStats.length > 0" class="grid gap-3 sm:grid-cols-3">
      <div
        v-for="item in formattedStats"
        :key="item.label"
        class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3"
      >
        <div class="text-xs uppercase tracking-[0.18em] text-[var(--app-muted)]">{{ item.label }}</div>
        <div class="mt-1 text-lg font-semibold text-[var(--app-fg-strong)]">{{ item.value }}</div>
      </div>
    </div>

    <StreamErrorPanel :error="error" @retry="$emit('retry')" />

    <StreamControls
      :status="status"
      :is-playing="isPlaying"
      :muted="muted"
      :disabled="disabled"
      @play="$emit('play')"
      @pause="$emit('pause')"
      @stop="$emit('stop')"
      @retry="$emit('retry')"
      @toggle-mute="$emit('toggleMute')"
    />
  </section>
</template>
