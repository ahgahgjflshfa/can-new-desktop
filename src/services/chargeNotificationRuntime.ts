import { fetchChargeTasks, isChargeForbidden } from '@/services/chargeTaskService'
import type { ChargeTask } from '@/types/charge'

function formatChargeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
export interface ChargeRuntimeConfig {
  enabled: boolean
  intervalMs: number
  token: string | null
  station: string | null
}

export interface ChargeRuntimeCallbacks {
  onSnapshot: (tasks: ChargeTask[], context: ChargeRuntimeContext) => void
  onError: (error: Error, context: ChargeRuntimeContext) => void
  onForbidden?: (context: ChargeRuntimeContext) => void
  onRequestStarted?: (context: ChargeRuntimeContext) => void
  onRequestFinished?: (context: ChargeRuntimeContext) => void
  onStarted?: (context: ChargeRuntimeContext) => void
  onStopped?: (context: ChargeRuntimeContext) => void
}

export interface ChargeRuntimeContext {
  controller: ChargeNotificationController
  generation: number
  token: string
  station: string
}

export class ChargeNotificationController {
  private config: ChargeRuntimeConfig = { enabled: false, intervalMs: 10000, token: null, station: null }
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private queued = false
  private generation = 0

  constructor(private readonly callbacks: ChargeRuntimeCallbacks) {}

  reconcile(config: ChargeRuntimeConfig): void {
    const unchanged = this.config.enabled === config.enabled && this.config.intervalMs === config.intervalMs &&
      this.config.token === config.token && this.config.station === config.station
    const restart = this.inFlight
    this.config = { ...config, station: config.station?.trim() || null }
    if (unchanged) return
    this.generation++
    this.clearTimer()
    if (!this.isActive()) {
      this.queued = false
      this.callbacks.onStopped?.(this.context())
      return
    }
    this.callbacks.onStarted?.(this.context())
    this.queued = restart
    if (!restart) this.schedule(0)
  }

  async trigger(): Promise<void> {
    if (!this.isActive()) return
    this.clearTimer()
    if (this.inFlight) { this.queued = true; return }
    await this.poll(this.generation)
  }

  invalidate(): void { this.generation++; this.clearTimer(); this.queued = false }

  teardown(): void {
    this.generation++
    this.clearTimer()
    this.queued = false
    this.inFlight = false
    this.config = { ...this.config, enabled: false, token: null, station: null }
    this.callbacks.onStopped?.(this.context())
  }

  getGeneration(): number { return this.generation }

  isUsable(): boolean { return this.isActive() }

  private context(generation = this.generation): ChargeRuntimeContext {
    return { controller: this, generation, token: this.config.token?.trim() ?? '', station: this.config.station?.trim() ?? '' }
  }

  private isActive(): boolean {
    return this.config.enabled && Boolean(this.config.token?.trim()) && Boolean(this.config.station?.trim())
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delay: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => { this.timer = null; void this.trigger() }, delay)
  }

  private async poll(requestGeneration: number): Promise<void> {
    const token = this.config.token?.trim()
    const station = this.config.station?.trim()
    if (!token || !station || !this.isActive()) return
    this.inFlight = true
    const context = this.context(requestGeneration)
    this.callbacks.onRequestStarted?.(context)
    try {
      const tasks = await fetchChargeTasks(token, station)
      if (requestGeneration !== this.generation || !this.isActive()) return
      this.callbacks.onSnapshot(tasks, context)
    } catch (error) {
      if (requestGeneration !== this.generation || !this.isActive()) return
      if (isChargeForbidden(error)) {
        this.invalidate()
        this.config = { ...this.config, enabled: false }
        const transitionedContext = this.context()
        this.callbacks.onStopped?.(transitionedContext)
        this.callbacks.onForbidden?.(transitionedContext)
      }
      else this.callbacks.onError(new Error(formatChargeError(error)), context)
    } finally {
      this.inFlight = false
      this.callbacks.onRequestFinished?.(this.context())
      if (!this.isActive()) { this.queued = false; return }
      if (this.queued) {
        const queued = this.queued
        this.queued = false
        if (queued) void this.poll(this.generation)
        return
      }
      this.schedule(this.config.intervalMs)
    }
  }
}
