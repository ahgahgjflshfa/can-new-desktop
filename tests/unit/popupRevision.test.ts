import { describe, expect, test } from 'vitest'
import { PopupRevisionGate, shouldClearLmaPopup } from '@/services/popupRevision'

const payload = (id: string, revision: number) => ({ id, revision })

describe('PopupRevisionGate', () => {
  test('event-first and snapshot-first accept only newer revisions and sound once', () => {
    const eventFirst = new PopupRevisionGate<ReturnType<typeof payload>>()
    expect(eventFirst.accept(payload('event', 2))).toEqual({ accepted: true, playSound: true })
    expect(eventFirst.accept(payload('snapshot', 2))).toEqual({ accepted: false, playSound: false })

    const snapshotFirst = new PopupRevisionGate<ReturnType<typeof payload>>()
    expect(snapshotFirst.accept(payload('snapshot', 3))).toEqual({ accepted: true, playSound: true })
    expect(snapshotFirst.accept(payload('event', 3))).toEqual({ accepted: false, playSound: false })
  })

  test('reused popup updates for a revised event', () => {
    const gate = new PopupRevisionGate<ReturnType<typeof payload>>()
    gate.accept(payload('A', 4))
    expect(gate.accept(payload('B', 5))).toEqual({ accepted: true, playSound: true })
    expect(gate.currentPayload).toEqual(payload('B', 5))
  })

  test('stale close/ack cannot clear a newer pending payload', () => {
    const gate = new PopupRevisionGate<ReturnType<typeof payload>>()
    gate.accept(payload('B', 8))
    expect(gate.close('A', 7)).toBe(false)
    expect(gate.close('B', 7)).toBe(false)
    expect(gate.currentPayload).toEqual(payload('B', 8))
  })

  test('clear fences stale events permanently', () => {
    const gate = new PopupRevisionGate<ReturnType<typeof payload>>()
    gate.accept(payload('A', 9))
    gate.clear(9)
    expect(gate.currentPayload).toBeNull()
    expect(gate.accept(payload('stale', 9))).toEqual({ accepted: false, playSound: false })
    expect(gate.accept(payload('stale', 8))).toEqual({ accepted: false, playSound: false })
  })

  test('LMA clear does not clear CAN or Charge payloads', () => {
    expect(shouldClearLmaPopup('lma', 'can', 10, 10)).toBe(false)
    expect(shouldClearLmaPopup('lma', 'charge', 10, 10)).toBe(false)
    expect(shouldClearLmaPopup('lma', 'lma', 10, 10)).toBe(true)
  })
})
