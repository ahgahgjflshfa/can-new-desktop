# AGENTS Guide for can-new-desktop

Last updated: 2026-03-19
Scope: Repository root (`/home/ahgahgjflshfa/projects/can-new-desktop`)

## Project Snapshot

- Stack: Tauri 2 + Vue 3 + Vite + TypeScript + Pinia + Tailwind CSS 4.
- Frontend code lives in `src/`; Rust backend code lives in `src-tauri/`.
- App has multiple windows (main + popup flow).
- Tests use Vitest with jsdom.

## High-Value Locations

- `src/store.ts`: app-wide settings store.
- `src/stores/notificationStore.ts`: notification state and popup orchestration.
- `src/services/notificationPoller.ts`: polling service boundary.
- `src/services/mockServer.ts`: mock notification source.
- `src/services/stream/playerCore.ts`: HLS player controller and playback state authority.
- `src/components/stream/ManagedStreamPlayer.vue`: stream container that wires the player controller to the UI.
- `src/PopupApp.vue`: popup UI behavior.
- `src-tauri/src/lib.rs`: Tauri commands, windows/tray lifecycle.
- `src-tauri/AGENTS.md`: backend-specific Rust guidance.

## Build, Test, and Validation Commands

Source of truth: `package.json`, `vitest.config.ts`, `README.md`, and `src-tauri/Cargo.toml`.

### Frontend / App Commands

- Install deps: `pnpm i`
- Frontend dev (vite + devtools): `pnpm dev`
- Vite-only dev server: `pnpm vite:dev`
- Run Tauri app in dev: `pnpm tauri dev`
- Build frontend bundle: `pnpm build`
- Type-check frontend: `pnpm type-check`
- Run Vitest suite: `pnpm test`
- Preview built frontend: `pnpm preview`
- Build desktop app bundle: `pnpm tauri build`

### Single-Test Execution (Vitest)

- Single file:
  - `pnpm test tests/unit/notificationStore.test.ts`
- Single test name pattern:
  - `pnpm test -- --testNamePattern="handles poll errors"`
  - `pnpm test -- -t "handles poll errors"`
- Single test name in a specific file:
  - `pnpm test tests/unit/notificationStore.test.ts -- -t "initializes polling"`
- Watch mode:
  - `pnpm test -- --watch`

Notes:

- Use `--` to forward flags through pnpm to Vitest.
- Include patterns are defined in `vitest.config.ts`:
  - `tests/unit/**/*.test.ts`
  - `src/**/*.spec.ts`

### Rust Backend Commands

- Cargo check via script: `pnpm check`
- Direct cargo check: `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml`
- Rust lint (warnings fail): `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Rust format: `cargo fmt --manifest-path src-tauri/Cargo.toml`

### Lint / Format

There is no dedicated root `lint` script.
Use direct commands when needed:

- ESLint: `pnpm eslint . --fix`
- Prettier: `pnpm prettier -w .`

## Code Style Guidelines

These rules come from `.prettierrc.json`, `.editorconfig`, `eslint.config.cjs`, tsconfig, and existing code patterns.

### Formatting

- Prettier:
  - `semi: false`
  - `singleQuote: true`
  - `tabWidth: 2`
  - `printWidth: 120`
  - `arrowParens: avoid`
  - `trailingComma: es5`
- EditorConfig:
  - JS/TS/Vue files: 2 spaces
  - HTML files: 4 spaces
  - UTF-8, final newline, trim trailing whitespace

### Imports and Modules

- Prefer alias imports from `@/*` for frontend (`tsconfig.app.json` + `vite.config.ts`).
- Use `import type` for type-only imports.

### TypeScript and Types

- Prefer explicit domain types in `src/types/*`.
- Avoid `any` unless a boundary absolutely forces it.
- Avoid suppression comments (`@ts-ignore`, `@ts-expect-error`) in normal flow.
- Use primitive `string`/`number`/`boolean` instead of boxed `String`/`Number`/`Boolean`.

### Naming

- Types/interfaces/classes/components: PascalCase.
- Store composables: `useXxxStore`.
- Variables/functions/methods: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants.
- Vue SFC filenames: PascalCase.

### Vue and Pinia

- Use `<script setup lang="ts">` for Vue SFCs.
- Keep store `state`, `getters`, and `actions` clearly separated.
- Keep side effects in actions/services, not getters.

### Error Handling

- Do not silently swallow errors.
- Add contextual logs (`console.warn`/`console.error`) where failures are actionable.
- For Tauri commands in Rust, return `Result<T, String>` and map errors deliberately.
- Avoid empty catch blocks.

### ESLint Conventions Worth Keeping

- `no-var` is error.
- In production: `no-console` and `no-debugger` become warnings.
- `@typescript-eslint/no-unused-vars` enforces underscore-ignore conventions (`^_`).

## Testing Guidance

- Preferred unit test locations:
  - `tests/unit/**/*.test.ts`
  - `src/**/*.spec.ts`
- Use deterministic tests; avoid uncontrolled timers/network dependencies.

## Generated and Tool-Managed Files

Do not hand-edit generated declaration or schema files unless task explicitly requires it.

- `auto-imports.d.ts`
- `components.d.ts`
- `src/auto-imports.d.ts`
- `src-tauri/gen/schemas/*`

## Agent Guardrails

- Keep changes scoped to the request.
- If changing popup behavior, validate both frontend popup flow and Rust window handling.
- If command/script behavior changes, update this AGENTS.md in the same change.

## Cursor / Copilot Rules

Checked locations:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

Result: no Cursor or Copilot rule files are present in this repository at the time of writing.
