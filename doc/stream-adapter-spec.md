# Stream Adapter Specification v0.1

## Goal

Define a consistent lifecycle contract for `mock`, `webrtc`, and `hls` adapters so the player can operate through one unified API.

## Interface

```ts
export interface StreamAdapter {
  connect(config: StreamAdapterConfig): Promise<void>
  disconnect(): Promise<void>

  attach(videoEl: HTMLVideoElement): void
  detach(): void

  start(): Promise<void>
  stop(): Promise<void>

  onEvent(handler: (event: AdapterEvent) => void): () => void
}
```

## Lifecycle Responsibilities

- `connect`: establish transport/session only. No playback side effects.
- `attach`: bind a target `HTMLVideoElement` and DOM listeners only.
- `start`: begin media flow and transition into streaming.
- `stop`: stop media flow while keeping session reusable.
- `disconnect`: fully tear down session/transport resources.
- `onEvent`: publish lifecycle/error events with unsubscribe support.

## State Model

- `idle`
- `connected`
- `streaming`
- `stopped`

Recommended default sequence:

`connect -> attach -> start -> stop -> detach -> disconnect`
Allowed variant:

- `connect -> start` is allowed, but without `attach` there must be no DOM playback side effects.

## Method Contracts (Pre/Post)

### connect(config)

- Pre: adapter is `idle` (or already disconnected/teardown-complete).
- Post: adapter is `connected`.
- Must not: start playback implicitly.

### attach(videoEl)

- Pre: valid `HTMLVideoElement` provided.
- Post: adapter stores/binds this render target.
- Must not: open network connections.

### start()

- Pre: `connect` completed successfully.
- Post: adapter enters `streaming`.
- Must: emit streaming lifecycle events (`buffering`, `started` or equivalent).

### stop()

- Pre: adapter is streaming (or started).
- Post: streaming stopped, session remains reusable.
- Must: be safe for repeated calls.

### detach()

- Pre: none (idempotent).
- Post: render target and DOM bindings are removed.
- Must not: implicitly disconnect transport.

### disconnect()

- Pre: none (idempotent).
- Post: transport/session resources are released and adapter returns to `idle`.

## Event Contract

Recommended event set:

```ts
type AdapterEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'buffering' }
  | { type: 'started' }
  | { type: 'stopped' }
  | {
      type: 'error'
      code: 'network_timeout' | 'unauthorized' | 'source_unavailable' | 'unknown'
      message: string
    }
```

Rules:

- Event emission must reflect lifecycle transitions consistently.
- `onEvent` must return a working unsubscribe function.
- Error events must include actionable `code` and human-readable `message`.

## Error Handling Policy

Use a single project-wide strategy and keep it consistent:

- Preferred: `throw` on invalid call order and emit `error` event for UI/telemetry visibility.

## MockAdapter MVP Requirements

- `connect`: simulate session setup delay, then emit `connected`.
- `start`: emit `buffering`, bind mock media source, emit `started`.
- `stop`: halt media flow and emit `stopped`.
- `disconnect`: cleanup and emit `disconnected`.

## Minimum Acceptance Tests

1. `start` before `connect` fails deterministically.
2. `connect -> attach -> start` produces expected event order.
3. `stop` after `start` is successful and repeat-safe.
4. `detach` does not crash and allows re-attach.
5. `disconnect` fully resets and requires new `connect` before `start`.
6. Unsubscribed handlers do not receive further events.

## Migration Notes

- This interface change is breaking for existing adapters.
- `mockAdapter`, `hlsAdapter`, and `webrtcAdapter` must all implement the new lifecycle.
- `AdapterFactory` can remain unchanged as long as it still returns `StreamAdapter`.
