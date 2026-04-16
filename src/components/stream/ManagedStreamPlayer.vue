<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import StreamPlayer from './StreamPlayer.vue'
import { createPlayerController } from '@/services/stream/playerCore'
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
    title: '攝影機串流',
    sourceLabel: 'HLS 來源',
    autoplay: false,
    disposeOnUnmount: true,
  }
)

const streamStore = useStreamStore()
const controller = createPlayerController()
const playerState = computed(() => streamStore.playerState)
const muted = computed(() => streamStore.muted)

let unsubscribeController: (() => void) | null = null

async function loadInitialStream() {
  streamStore.setCurrentConfig(props.streamConfig)
  await controller.load(props.streamConfig, { autoplay: props.autoplay })
}

async function handleVideoReady(videoElement: HTMLVideoElement) {
  controller.attach(videoElement)
  controller.setMuted(streamStore.muted)
  await loadInitialStream()
}

async function handlePlay() {
  await controller.play()
}

function handlePause() {
  controller.pause()
}

async function handleStop() {
  await controller.stop()
}

async function handleRetry() {
  await controller.retry()
}

function handleToggleMute() {
  const nextMuted = !streamStore.muted
  streamStore.setMuted(nextMuted)
  controller.setMuted(nextMuted)
}

onMounted(() => {
  streamStore.init()
  unsubscribeController = controller.onStateChange(state => {
    streamStore.setPlayerState(state)
  })
  controller.setMuted(streamStore.muted)
  streamStore.setPlayerState(controller.getState())
})

onUnmounted(async () => {
  unsubscribeController?.()
  unsubscribeController = null
  streamStore.resetPlayerState()

  if (props.disposeOnUnmount) {
    await controller.dispose()
  }
})
</script>

<template>
  <StreamPlayer
    :title="title"
    :source-label="sourceLabel"
    :state="playerState"
    :muted="muted"
    @video-ready="handleVideoReady"
    @play="handlePlay"
    @pause="handlePause"
    @stop="handleStop"
    @retry="handleRetry"
    @toggle-mute="handleToggleMute"
  />
</template>
