# AGENTS Guide for can-new-desktop

Last updated: 2026-02-10
Scope: Repository root (`/home/ahgahgjflshfa/projects/can-new-desktop`)

## Project Snapshot

- Stack: Tauri 2 + Vue 3 + Vite + TypeScript + Pinia + Tailwind CSS 4.
- Frontend lives in `src/`; Rust backend lives in `src-tauri/`.
- Multi-window app: main window + popup window (`popup.html`).
- Tests: Vitest (`tests/unit/**/*.test.ts`, `src/**/*.spec.ts`).

## High-Value Locations

- `src/store.ts`: app-wide settings store (theme, sidebar, tray behavior).
- `src/stores/notificationStore.ts`: notification domain store and popup orchestration.
- `src/services/notificationPoller.ts`: polling service abstraction.
- `src/services/mockServer.ts`: mock notification API source.
- `src/types/notification.ts`: notification domain types.
- `src/PopupApp.vue`: popup UI and event handling.
- `src-tauri/src/lib.rs`: Tauri commands and window/tray lifecycle.
- `src-tauri/AGENTS.md`: Rust-focused conventions and gotchas.

## Build, Lint, and Test Commands

Commands below are validated from `package.json`, `vitest.config.ts`, and repository docs/config.

### Frontend / Full App Commands

- Install deps: `pnpm i`
- Frontend dev (+ devtools): `pnpm dev`
- Vite-only dev entry used by `pnpm dev`: `pnpm vite:dev`
- Run Tauri app in dev mode: `pnpm tauri dev`
- Production frontend build: `pnpm build`
- Type check only: `pnpm type-check`
- Run unit tests: `pnpm test`
- Preview built frontend: `pnpm preview`

### Single-Test Execution (Vitest)

- Run one file:
  - `pnpm test tests/unit/notificationStore.test.ts`
- Run one test name/pattern:
  - `pnpm test -- --testNamePattern="handles poll errors"`
  - Short form also works: `pnpm test -- -t "handles poll errors"`
- Run one test name inside one file:
  - `pnpm test tests/unit/notificationStore.test.ts -- -t "initializes polling"`
- Watch mode:
  - `pnpm test -- --watch`

Notes:

- Use `--` when forwarding CLI flags to Vitest through `pnpm test`.
- Test include patterns come from `vitest.config.ts`:
  - `tests/unit/**/*.test.ts`
  - `src/**/*.spec.ts`

### Rust Backend Commands

- Cargo check via npm script: `pnpm check`
- Direct cargo check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust lint: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Rust format: `cargo fmt --manifest-path src-tauri/Cargo.toml`

### Lint / Format

There is no dedicated `lint` script in root `package.json`.
Use direct commands:

- ESLint: `pnpm eslint . --fix`
- Prettier: `pnpm prettier -w .`

## Coding Conventions

These are based on current repository config and observed patterns.

### Formatting and Whitespace

- Prettier config (`.prettierrc.json`):
  - no semicolons
  - single quotes
  - `tabWidth: 2`
  - `printWidth: 120`
  - `arrowParens: avoid`
  - `trailingComma: es5`
- `.editorconfig`:
  - JS/TS/Vue use 2-space indentation
  - HTML uses 4-space indentation
  - UTF-8, final newline, trim trailing whitespace

### Imports and Module Structure

- Prefer alias imports from `@/*` for frontend modules (configured in `tsconfig.app.json` and `vite.config.ts`).
- Keep import groups stable and readable; current code typically keeps framework imports first, then app imports.
- Use `import type` for type-only imports where applicable.
- Avoid deep relative import chains when alias import is available.

### Vue and Pinia Patterns

- Use `<script setup lang="ts">` in Vue SFCs.
- Use Pinia `defineStore` with clear separation of `state`, `getters`, and `actions`.
- Keep side effects in actions/services, not in getters.
- Keep popup-specific logic minimal and focused (`src/PopupApp.vue` pattern).

### Naming Conventions

- Types/interfaces: PascalCase (`NotificationState`, `PollingStats`).
- Store composables: `useXxxStore` (`useStore`, `useNotificationStore`).
- Functions/variables: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants (`MAX_STORED_NOTIFICATIONS`).
- Vue components: PascalCase filenames (`PopupApp.vue`, `NotificationsView.vue`).

### Type Safety Rules

- Prefer explicit domain types from `src/types/*` over inline broad objects.
- Avoid `any`.
- Avoid type suppression comments (`@ts-ignore`, `@ts-expect-error`) in source code.
- Parse `unknown` values defensively (see localStorage parsing patterns in stores).

### Error Handling and Logging

- Wrap Tauri `invoke()` and event setup in `try/catch`.
- Do not swallow errors silently; log with context (`console.warn`/`console.error`).
- Rust commands should return `Result<T, String>` and map errors explicitly.
- Avoid empty catch blocks.

### Rust/Tauri Backend Patterns

- Register commands in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
- Keep window labels/capabilities aligned (`main`, `alert-popup`).
- Use managed state for shared cross-window data (`PendingNotificationState`).
- Avoid `unwrap()` in command paths where failure can be handled.

## Testing Guidelines

- Prefer unit tests under `tests/unit/` for stores/services.
- Use Vitest + Pinia test utilities (`createTestingPinia`) for store tests.
- Mock Tauri APIs and polling service boundaries in tests.
- Keep tests deterministic; avoid time/network randomness unless explicitly controlled.

## Generated or Tool-Managed Files

Do not hand-edit generated declaration files; regenerate via normal dev/build workflows:

- `auto-imports.d.ts`
- `components.d.ts`
- `src/auto-imports.d.ts`
- `src-tauri/gen/schemas/*`

## Agent Guardrails

- Keep fixes minimal; do not refactor unrelated code during a bug fix.
- Follow existing store/service boundaries unless the task explicitly asks for restructuring.
- If changing popup behavior, verify both frontend (`src/PopupApp.vue`) and Rust (`src-tauri/src/lib.rs`) flow.
- If changing commands or scripts, keep this file in sync.

## Cursor / Copilot Rules

Checked paths:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

Result: no Cursor or Copilot rule files are present in this repository at the time of writing.
