# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**tuinnel** — a CLI tool for managing Cloudflare Tunnels with a TUI dashboard. Written in TypeScript, developed with Bun, distributed as a self-contained Node 20+ ESM bundle.

## Commands

```bash
# Build (produces dist/index.js — single-file bundle, ~1.3 MB)
bun run build

# Build in watch mode
bun run dev

# Type-check (no emit)
bunx tsc --noEmit

# Run all tests
bun test

# Run a single test file
bun test tests/cloudflare/api.test.ts

# Run tests matching a pattern
bun test --grep "paginate"

# Smoke test the built CLI
node dist/index.js --help
```

## Architecture

### Layers

```
src/index.ts              Commander.js CLI entry — dynamic imports per command
  └─ src/commands/*.ts    Command handlers (init, up, down, add, remove, list, status, zones, doctor, purge)
       ├─ src/cloudflare/ CF REST API client layer (fetch + Zod validation + retry + pagination)
       ├─ src/cloudflared/ Binary management + process spawning + log parsing
       ├─ src/config/     Zod-validated JSON config (~/.tuinnel/config.json)
       ├─ src/tui/        Ink v6 (React 19) TUI dashboard — App, Sidebar, MainPanel, LogView, Metrics, HelpBar
       └─ src/utils/      Port probing, clipboard, structured logger
```

### Key patterns

- **CLI entry** (`src/index.ts`): Commander.js with `parseAsync()`. Each command uses a dynamic `import()` so only the relevant module loads. Global `--verbose` flag wired via `preAction` hook.
- **CF API** (`src/cloudflare/api.ts`): Single `cfFetch()` function wraps all API calls with 30s timeout, Zod schema validation of response envelopes, and automatic retry (429 rate-limit with Retry-After, 5xx with backoff, network errors). Page-based pagination via `paginate()` async generator (per_page=50).
- **Error classification** (`src/cloudflare/errors.ts`): Errors are categorized as fatal/recoverable/transient. Recoverable (409 conflict) is returned to caller; fatal throws with user-facing message including remediation URLs.
- **Tunnel lifecycle** (`src/cloudflare/tunnel-manager.ts`): 4-step startup (create/get tunnel → update ingress → create/verify DNS CNAME → spawn cloudflared). Fail-fast with rollback on error via `cleanupOnFailure()`. Tunnel names are prefixed with `tuinnel-`.
- **cloudflared process** (`src/cloudflared/process.ts`): Spawns cloudflared with `--no-autoupdate --metrics 127.0.0.1:0 --protocol quic`. Flags go BEFORE `run`, `--token` goes AFTER `run`. Graceful SIGTERM with 5s timeout then SIGKILL.
- **Config** (`src/config/store.ts`): Atomic writes via tmp+rename, chmod 0600. Token resolution: `CLOUDFLARE_API_TOKEN` env → `TUINNEL_API_TOKEN` env → `~/.tuinnel/config.json`.
- **TUI** (`src/tui/`): Ink v6 + React 19 components. Hooks in `src/tui/hooks/` manage health polling (5s interval), Prometheus metrics scraping (3s interval), and cloudflared stderr log parsing (ring buffer, 1000 events max).

### Build system (tsup)

The `tsup.config.ts` has critical settings:
- `noExternal: [/.*/]` — bundles ALL dependencies (including transitive). Required because global npm install doesn't hoist deps.
- `banner.js` — injects `createRequire` for bundled CJS code (Commander.js) that calls `require()`.
- `esbuildOptions.alias` — deduplicates React (prevents multiple React instances breaking hooks) and stubs out `react-devtools-core` (Ink optional dev dep) via `src/stubs/react-devtools-core.ts`.
- `process.env.NODE_ENV` defined as `"production"` for React production mode.

### Testing

Tests use `bun:test` (Bun's built-in test runner). API tests mock `globalThis.fetch` and restore original after each test. TUI component tests use `ink-testing-library` with `render()` and `lastFrame()`. Each test file re-imports modules in `beforeEach` to reset cached state (e.g., `clearAccountIdCache()`).

## Conventions

- All internal imports use `.js` extension (required by Node16 module resolution)
- CF API endpoints use `/accounts/{account_id}/cfd_tunnel` (not `/tunnels`)
- CF API uses page-based pagination (not cursor-based), max 50 per page
- Zod schemas validate both config files and API responses
- JSX uses `react-jsx` transform (no React import needed in .tsx files)
- macOS cloudflared downloads are `.tgz` archives; Linux are bare binaries
