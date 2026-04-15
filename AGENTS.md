# AGENTS Guide for can-new-desktop

Last updated: 2026-04-15
Scope: Repository root (`/home/ahgahgjflshfa/projects/can-new-desktop`)

## What this repo actually is

- Stack: Tauri 2 + Vue 3 + Vite + TypeScript + Pinia + Tailwind CSS 4.
- The app has **two frontend entrypoints**, not one:
  - main window: `index.html` → `src/main.ts` → `src/App.vue`
  - popup window: `popup.html` → `src/popup-main.ts` → `src/PopupApp.vue`
- Rust entrypoint is `src-tauri/src/main.rs`, which delegates to `src-tauri/src/lib.rs`.
- `src-tauri/AGENTS.md` has the backend-specific rules; read it before changing Rust or window/capability behavior.

## High-value files

- `src/App.vue`: gates notification runtime on auth state.
- `src/main.ts`: initializes Pinia, loads persisted settings, applies theme, and hydrates auth before mount.
- `src/store.ts`: app-wide settings, theme handling, and minimize-to-tray sync to Rust.
- `src/stores/authStore.ts`: persisted auth token/user, plus API token provider hookup.
- `src/stores/notificationStore.ts`: main notification orchestrator; owns polling, popup show/hide decisions, and Rust dismiss-event handling.
- `src/services/notificationPoller.ts`: singleton polling boundary.
- `src/services/taskActionService.ts`: task reply/complete calls into Rust with auth token lookup.
- `src/services/stream/playerCore.ts`: frontend-only HLS playback state authority.
- `src-tauri/src/lib.rs`: registered Tauri commands and global state.
- `src-tauri/src/popup_commands.rs`: dynamic popup window creation and popup IPC.
- `src-tauri/src/window_controls.rs`: main window visibility / always-on-top behavior.
- `src-tauri/tauri.conf.json`: only the `main` window is declared here; the popup is created dynamically in Rust.

## Commands you can trust

Use `pnpm`, not npm/yarn/bun.

- Install deps: `pnpm i`
- Frontend dev server only: `pnpm vite:dev`
- Frontend dev server + Vue devtools: `pnpm dev`
- Full Tauri app in dev: `pnpm tauri dev`
- Fast frontend typecheck: `pnpm type-check`
- Frontend production build: `pnpm build`
- Full desktop build: `pnpm tauri build`
- Unit tests: `pnpm test`
- Preview built frontend: `pnpm preview`
- Rust check via package script: `pnpm check`

There is **no** root `lint` or `format` script. Use direct commands when needed:

- ESLint: `pnpm eslint . --fix`
- Prettier: `pnpm prettier -w .`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust lint: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Rust format: `cargo fmt --manifest-path src-tauri/Cargo.toml`

## Validation shortcuts that save time

- Vitest includes only `tests/unit/**/*.test.ts` and `src/**/*.spec.ts`.
- Single-file test: `pnpm test tests/unit/notificationStore.test.ts`
- By test name: `pnpm test -- -t "handles poll errors"`
- File + name: `pnpm test tests/unit/notificationStore.test.ts -- -t "initializes polling"`
- Watch mode: `pnpm test -- --watch`

Useful verification order:

1. `pnpm type-check`
2. targeted `pnpm test ...`
3. `pnpm build` if you touched Vite entrypoints, generated imports/components, or frontend app wiring
4. `pnpm check` / Rust commands if you touched `src-tauri/`

Why this order matters:

- `pnpm build` already runs `vue-tsc --noEmit` first.
- `pnpm tauri build` already runs `pnpm build` first via `src-tauri/tauri.conf.json` `beforeBuildCommand`.
- CI currently verifies `pnpm test` and `pnpm tauri build`; there is no verified CI lint job.

## Repo-specific wiring that is easy to miss

- `src/App.vue` only initializes the notification runtime when `authStore.isAuthenticated` becomes true. If notifications seem "broken," check auth flow first.
- `src/stores/notificationStore.ts` is the real cross-runtime bridge:
  - starts/stops `notificationPoller`
  - invokes Rust popup commands (`show_alert_popup`)
  - listens for Rust `dismiss-notification` events
- Popup delivery is intentionally redundant to avoid a race:
  - Rust emits `show-notification`
  - `src/PopupApp.vue` also calls `get_pending_notification()` on mount in case the event fired before Vue listeners were ready
- Popup task actions (`reply_task`, `complete_task`) depend on an auth token from `apiClient` or persisted auth storage; if popup actions fail, inspect `src/services/taskActionService.ts` and `src/stores/authStore.ts` together.
- Stream playback is frontend-only (`src/services/stream/playerCore.ts`, `src/stores/streamStore.ts`, stream components). Do not assume Rust is involved there.

## Tauri / windowing constraints

- The popup window label is `alert-popup`; its permissions live in `src-tauri/capabilities/popup.json`.
- The main window permissions live in `src-tauri/capabilities/default.json`.
- If you add a new Tauri capability-dependent feature, update the matching file in `src-tauri/capabilities/` or it can fail as a silent permission issue.
- Closing the popup is handled in Rust by hiding the window instead of destroying it; validate both frontend popup behavior and Rust window handling when changing popup flows.

## Tests and generated files

- Vitest runs in `jsdom` with globals enabled and setup from `tests/setup/testglobals.ts`.
- `tests/setup/testglobals.ts` installs Pinia with real actions (`stubActions: false`), so store tests execute actual action code unless they mock dependencies.
- Do not hand-edit generated files unless the task is specifically about generation:
  - `auto-imports.d.ts`
  - `src/auto-imports.d.ts`
  - `components.d.ts`
  - `.eslintrc-auto-import.json`
  - `src-tauri/gen/*`

## Style and repo conventions worth preserving

- Use `@/*` imports for frontend modules.
- Use `import type` for type-only imports.
- Vue SFCs use `<script setup lang="ts">`.
- JS/TS/Vue use 2-space indentation; HTML uses 4 spaces (`.editorconfig`).
- `eslint.config.cjs` keeps `no-var` as error and reserves underscore-prefixed unused variables/args.
- Do not silently swallow errors; this repo generally logs actionable failures with `console.warn` / `console.error`.

## Existing instruction files checked

- Root: `AGENTS.md` (this file)
- Backend: `src-tauri/AGENTS.md`
- Not present: `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, `opencode.json`
