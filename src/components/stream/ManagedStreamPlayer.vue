<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import StreamPlayer from './StreamPlayer.vue'
import { logAppEvent } from '@/services/appLogger'
import { createPlayerController } from '@/services/stream/playerCore'
import { useStreamStore } from '@/stores/streamStore'
import type { StreamConfig } from '@/types/stream'

const LOG_SOURCE = 'managed-stream-player'

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
  logAppEvent('info', LOG_SOURCE, 'Initializing stream load', {
    sourceType: props.streamConfig.sourceType,
    sourceUrl: props.streamConfig.sourceUrl,
    autoplay: props.autoplay,
  })
  await controller.load(props.streamConfig, { autoplay: props.autoplay })
}

async function handleVideoReady(videoElement: HTMLVideoElement) {
  controller.attach(videoElement)
  controller.setMuted(streamStore.muted)
  logAppEvent('info', LOG_SOURCE, 'Video element is ready for stream playback', {
    muted: streamStore.muted,
    autoplay: props.autoplay,
  })
  await loadInitialStream()
}

async function handlePlay() {
  logAppEvent('info', LOG_SOURCE, 'User requested stream playback')
  await controller.play()
}

function handlePause() {
  logAppEvent('info', LOG_SOURCE, 'User paused stream playback')
  controller.pause()
}

async function handleStop() {
  logAppEvent('info', LOG_SOURCE, 'User stopped stream playback')
  await controller.stop()
}

async function handleRetry() {
  logAppEvent('warn', LOG_SOURCE, 'User requested stream retry')
  await controller.retry()
}

function handleToggleMute() {
  const nextMuted = !streamStore.muted
  logAppEvent('info', LOG_SOURCE, 'User toggled stream mute state', { muted: nextMuted })
  streamStore.setMuted(nextMuted)
  controller.setMuted(nextMuted)
}

onMounted(() => {
  streamStore.init()
  logAppEvent('info', LOG_SOURCE, 'Managed stream player mounted', {
    disposeOnUnmount: props.disposeOnUnmount,
  })
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
  logAppEvent('info', LOG_SOURCE, 'Managed stream player unmounted', {
    disposeOnUnmount: props.disposeOnUnmount,
  })

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
