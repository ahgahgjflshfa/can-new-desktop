# AGENTS Guide for can-new-desktop

Last verified: 2026-04-29
Scope: `/Users/sabrina/Projects/can-new-desktop`

## What this repo is

- Desktop app: Tauri 2 + Vue 3 + Vite + TypeScript + Pinia.
- Single root `pnpm` package plus a nested Rust crate in `src-tauri/`. There is no `pnpm-workspace.yaml`.
- Do not trust the template residue in `README.md` or `src-tauri/Cargo.toml` for repo identity; prefer executable config and source.

## Read these first

- `package.json` — real commands and script names.
- `vite.config.ts` — this app has **two** frontend build inputs: `index.html` and `popup.html`.
- `src-tauri/tauri.conf.json` — Tauri dev/build hooks and the only statically declared window.
- `src/main.ts`, `src/App.vue`, `src/stores/authStore.ts`, `src/stores/notificationStore.ts` — main bootstrap and notification/auth wiring.
- `src-tauri/AGENTS.md` before changing Rust, window behavior, tray behavior, or capability files.

## Entry points and boundaries

- Main window: `index.html` → `src/main.ts` → `src/App.vue`
- Popup window: `popup.html` → `src/popup-main.ts` → `src/PopupApp.vue`
- Rust entrypoint: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs`
- `src-tauri/tauri.conf.json` declares only the `main` window. The popup window is created dynamically in Rust.

## Repo wiring that is easy to miss

- Notification runtime is auth-gated. `src/App.vue` only initializes notification polling after `authStore.isAuthenticated` becomes true.
- `src/stores/notificationStore.ts` is the real frontend↔Rust bridge for notifications: it starts/stops polling, invokes `show_alert_popup`, and listens for Rust `dismiss-notification` events.
- Popup delivery is intentionally redundant to avoid missed events: Rust emits `show-notification`, and `src/PopupApp.vue` also calls `get_pending_notification()` on mount. Do not remove one side without validating the race.
- Popup task actions depend on an auth token from `apiClient` or persisted auth storage. If popup reply/complete breaks, inspect `src/services/taskActionService.ts` and `src/stores/authStore.ts` together.
- Theme is pre-applied in `index.html` before Vue mounts. If you are debugging theme flash or initial theme selection, do not start with `src/main.ts`.

## Commands you can trust

Use `pnpm`, not npm/yarn/bun.

- Install deps: `pnpm i`
- Frontend dev server only: `pnpm vite:dev`
- Frontend dev server + Vue devtools: `pnpm dev`
- Full desktop dev: `pnpm tauri dev`
- Typecheck: `pnpm type-check`
- Unit tests: `pnpm test`
- Frontend build: `pnpm build`
- Rust check via package script: `pnpm check`
- Full desktop build: `pnpm tauri build`

There is no root `lint` or `format` script. Run tools directly when needed:

- `pnpm eslint . --fix`
- `pnpm prettier -w .`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- `cargo fmt --manifest-path src-tauri/Cargo.toml`

## Verification shortcuts

- Vitest includes only `tests/unit/**/*.test.ts` and `src/**/*.spec.ts`.
- Single-file test: `pnpm test tests/unit/notificationStore.test.ts`
- By test name: `pnpm test -- -t "handles poll errors"`
- File + name: `pnpm test tests/unit/notificationStore.test.ts -- -t "initializes polling"`
- Useful order:
  1. `pnpm type-check`
  2. targeted `pnpm test ...`
  3. `pnpm build` if you changed Vite entrypoints, generated imports/components, or app wiring
  4. `pnpm check` or Rust commands if you changed `src-tauri/`

Why this order matters:

- `pnpm build` already runs `vue-tsc --noEmit` first.
- `pnpm tauri build` already runs `pnpm build` first via `beforeBuildCommand`.
- CI is split: `.github/workflows/test.yml` runs `pnpm test`, `.github/workflows/test-build.yml` runs `pnpm tauri build`, and `.github/workflows/package-test.yml` is manual packaging.

## Generated files and test setup

- Do not hand-edit generated frontend types: `auto-imports.d.ts`, `components.d.ts`. Vite generates them and `tsconfig.app.json` includes them.
- Do not hand-edit `src-tauri/gen/*`.
- Vitest runs in `jsdom` with setup from `tests/setup/testglobals.ts`.
- `tests/setup/testglobals.ts` installs Pinia with `stubActions: false`, so store tests execute real actions unless they mock dependencies.

## Conventions worth preserving

- Use `@/*` imports for frontend modules.
- Use `import type` for type-only imports.
- Vue SFCs use `<script setup lang="ts">`.
- JS/TS/Vue use 2-space indentation; HTML uses 4 spaces.
- Errors are generally logged with `console.warn` / `console.error`; do not silently swallow failures.

## Existing instruction files

- Root: `AGENTS.md`
- Backend: `src-tauri/AGENTS.md`
- Not present when last verified: `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`, `opencode.json`
