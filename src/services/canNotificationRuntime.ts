import { fetchCanTasks } from '@/services/canTaskService'
import type { CanTask } from '@/types/can'

export interface CanRuntimeConfig {
  enabled: boolean
  intervalMs: number
  token: string | null
}

export interface CanRuntimeCallbacks {
  onSnapshot: (tasks: CanTask[]) => void
  onError: (error: Error) => void
  onStarted?: () => void
  onStopped?: () => void
  onRequestStarted?: () => void
  onRequestFinished?: () => void
}

export class CanNotificationController {
  private config: CanRuntimeConfig = { enabled: false, intervalMs: 10000, token: null }
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight = false
  private queued = false
  private generation = 0

  constructor(private readonly callbacks: CanRuntimeCallbacks) {}

  reconcile(config: CanRuntimeConfig): void {
    const unchanged = JSON.stringify(this.config) === JSON.stringify(config)
    const restartAfterFlight = this.inFlight
    this.config = { ...config }
    if (unchanged) return
    this.generation++
    this.clearTimer()
    if (!this.isActive()) {
      this.queued = false
      this.callbacks.onStopped?.()
      return
    }
    this.callbacks.onStarted?.()
    if (restartAfterFlight) this.queued = true
    else this.schedule(0)
  }

  async trigger(): Promise<void> {
    if (!this.isActive()) return
    this.clearTimer()
    if (this.inFlight) {
      this.queued = true
      return
    }
    await this.poll(this.generation)
  }

  teardown(): void {
    this.generation++
    this.clearTimer()
    this.queued = false
    this.config = { ...this.config, enabled: false, token: null }
    this.callbacks.onStopped?.()
  }

  getGeneration(): number { return this.generation }

  invalidate(): void {
    this.generation++
    this.clearTimer()
    this.queued = this.inFlight
  }

  private isActive(): boolean {
    return this.config.enabled && Boolean(this.config.token)
  }

  private schedule(delayMs: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => { this.timer = null; void this.trigger() }, delayMs)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private async poll(requestGeneration: number): Promise<void> {
    const { token } = this.config
    if (!token || !this.isActive()) return
    this.inFlight = true
    this.callbacks.onRequestStarted?.()
    try {
      const tasks = await fetchCanTasks(token)
      if (requestGeneration === this.generation && this.isActive()) this.callbacks.onSnapshot(tasks)
    } catch (error) {
      if (requestGeneration === this.generation && this.isActive()) {
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      this.inFlight = false
      this.callbacks.onRequestFinished?.()
      if (!this.isActive()) { this.queued = false; return }
      if (requestGeneration !== this.generation || this.queued) {
        this.queued = false
        void this.poll(this.generation)
      } else {
        this.schedule(this.config.intervalMs)
      }
    }
  }
}
