<script setup lang="ts">
import { computed } from 'vue'
import type { StreamError } from '@/types/stream'

const props = defineProps<{
  error: StreamError | null
}>()

defineEmits<{
  retry: []
}>()

const formattedTime = computed(() => {
  if (!props.error) {
    return ''
  }

  return new Date(props.error.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
})

const errorCodeLabel = computed(() => {
  if (!props.error) {
    return ''
  }

  return props.error.code.split('_').join(' ')
})
</script>

<template>
  <div v-if="error" class="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
    <div class="flex items-start justify-between gap-4">
      <div class="flex items-start gap-3">
        <span class="i-mdi-alert-circle text-xl text-red-400" />
        <div class="space-y-1">
          <div class="font-semibold text-red-300">Playback Error</div>
          <p class="text-sm text-red-200/90">{{ error.message }}</p>
          <div class="text-xs uppercase tracking-[0.18em] text-red-200/60">
            {{ errorCodeLabel }} · {{ formattedTime }}
          </div>
        </div>
      </div>

      <button
        v-if="error.retryable"
        type="button"
        class="shrink-0 rounded-lg border border-red-400/40 px-3 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/10"
        @click="$emit('retry')"
      >
        Retry
      </button>
    </div>
  </div>
</template>
