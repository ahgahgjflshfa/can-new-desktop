<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerStatus } from '@/services/stream/playerCore'

const props = defineProps<{
  status: PlayerStatus
}>()

const statusConfig = computed(() => {
  switch (props.status) {
    case 'live':
      return {
        label: 'Live',
        dotClass: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]',
        badgeClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      }
    case 'buffering':
      return {
        label: 'Buffering',
        dotClass: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.65)]',
        badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      }
    case 'loading':
      return {
        label: 'Loading',
        dotClass: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.7)]',
        badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
      }
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        dotClass: 'bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.7)]',
        badgeClass: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
      }
    case 'paused':
      return {
        label: 'Paused',
        dotClass: 'bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.65)]',
        badgeClass: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
      }
    case 'error':
      return {
        label: 'Error',
        dotClass: 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.7)]',
        badgeClass: 'border-red-500/40 bg-red-500/10 text-red-300',
      }
    case 'stopped':
      return {
        label: 'Stopped',
        dotClass: 'bg-slate-500',
        badgeClass: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
      }
    default:
      return {
        label: 'Idle',
        dotClass: 'bg-slate-500',
        badgeClass: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
      }
  }
})
</script>

<template>
  <div
    class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]"
    :class="statusConfig.badgeClass"
  >
    <span class="h-2.5 w-2.5 rounded-full" :class="statusConfig.dotClass" />
    <span>{{ statusConfig.label }}</span>
  </div>
</template>
