export interface PopupRevisionPayload {
  id: string
  revision: number
}

export function shouldClearLmaPopup(system: string, currentSystem: string | null, currentRevision: number, clearRevision: number): boolean {
  return system === 'lma' && currentSystem !== 'can' && currentSystem !== 'charge' && currentRevision <= clearRevision
}

/** Pure delivery gate shared by event and pending-snapshot delivery. */
export class PopupRevisionGate<T extends PopupRevisionPayload> {
  private acceptedRevision = 0
  private lastSoundRevision = 0
  private current: T | null = null

  accept(payload: T): { accepted: boolean; playSound: boolean } {
    if (!Number.isFinite(payload.revision) || payload.revision <= this.acceptedRevision) {
      return { accepted: false, playSound: false }
    }
    this.acceptedRevision = payload.revision
    this.current = payload
    const playSound = payload.revision > this.lastSoundRevision
    this.lastSoundRevision = Math.max(this.lastSoundRevision, payload.revision)
    return { accepted: true, playSound }
  }

  clear(revision: number): void {
    if (revision > this.acceptedRevision) this.acceptedRevision = revision
    if (this.current && this.current.revision <= revision) this.current = null
  }

  close(id: string, revision: number): boolean {
    if (!this.current || this.current.id !== id || this.current.revision !== revision) return false
    this.current = null
    return true
  }

  get currentPayload(): T | null { return this.current }
  get watermark(): number { return this.acceptedRevision }
}
