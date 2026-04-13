<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import StreamPlayer from './StreamPlayer.vue'
import { useStreamStore } from '@/stores/streamStore'
import type { StreamConfig } from '@/types/stream'

const props = withDefaults(
  defineProps<{
    streamConfig: StreamConfig
    title?: string
    sourceLabel?: string
    autoplay?: boolean
    disposeOnUnmount?: boolean
  }>(),
  {
    title: 'Camera Stream',
    sourceLabel: 'HLS Source',
    autoplay: false,
    disposeOnUnmount: true,
  }
)

const streamStore = useStreamStore()

const status = computed(() => streamStore.status)
const stats = computed(() => streamStore.stats)
const error = computed(() => streamStore.lastError)
const isPlaying = computed(() => streamStore.isPlaying)
const muted = computed(() => streamStore.muted)
const disabled = computed(() => streamStore.isPending)

async function loadInitialStream() {
  try {
    await streamStore.loadStream(props.streamConfig, props.autoplay)
  } catch (err) {
    console.warn('failed to load stream', err)
  }
}

async function handlePlay() {
  try {
    await streamStore.play()
  } catch (err) {
    console.warn('failed to start playback', err)
  }
}

async function handleStop() {
  try {
    await streamStore.stop()
  } catch (err) {
    console.warn('failed to stop playback', err)
  }
}

async function handleRetry() {
  try {
    await streamStore.retry()
  } catch (err) {
    console.warn('failed to retry playback', err)
  }
}

onMounted(async () => {
  streamStore.init()
  await loadInitialStream()
})

onUnmounted(() => {
  if (props.disposeOnUnmount) {
    void streamStore.dispose()
  }
})
</script>

<template>
  <StreamPlayer
    :title="title"
    :source-label="sourceLabel"
    :status="status"
    :stats="stats"
    :error="error"
    :is-playing="isPlaying"
    :muted="muted"
    :disabled="disabled"
    @video-ready="streamStore.attachVideoElement"
    @play="handlePlay"
    @pause="streamStore.pause"
    @stop="handleStop"
    @retry="handleRetry"
    @toggle-mute="streamStore.toggleMute"
  />
</template>
