<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerStatus } from '@/services/stream/playerCore'

const props = withDefaults(
  defineProps<{
    status: PlayerStatus
    muted?: boolean
  }>(),
  {
    muted: false,
  }
)

defineEmits<{
  play: []
  pause: []
  stop: []
  retry: []
  toggleMute: []
}>()

const canPlay = computed(() => ['idle', 'paused', 'stopped', 'error'].includes(props.status))
const canPause = computed(() => ['live', 'buffering'].includes(props.status))
const canStop = computed(() => ['loading', 'live', 'buffering', 'paused', 'reconnecting'].includes(props.status))
const canRetry = computed(() => props.status === 'error')
const primaryAction = computed(() => (canPause.value ? 'pause' : 'play'))
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!(canPlay || canPause)"
      @click="primaryAction === 'pause' ? $emit('pause') : $emit('play')"
    >
      <span :class="primaryAction === 'pause' ? 'i-mdi-pause' : 'i-mdi-play'" class="text-base" />
      {{ primaryAction === 'pause' ? 'Pause' : 'Play' }}
    </button>

    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 py-2 text-sm font-medium text-[var(--app-fg-strong)] transition-colors hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!canStop"
      @click="$emit('stop')"
    >
      <span class="i-mdi-stop text-base" />
      Stop
    </button>

    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-2)] px-4 py-2 text-sm font-medium text-[var(--app-fg-strong)] transition-colors hover:bg-[var(--app-hover)]"
      @click="$emit('toggleMute')"
    >
      <span :class="props.muted ? 'i-mdi-volume-off' : 'i-mdi-volume-high'" class="text-base" />
      {{ props.muted ? 'Unmute' : 'Mute' }}
    </button>

    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="!canRetry"
      @click="$emit('retry')"
    >
      <span class="i-mdi-refresh text-base" />
      Retry
    </button>
  </div>
</template>
