# tuinnel — Unified Execution Plan v3

> Supersedes v2. Incorporates validated research findings (Feb 2026) for all critical decisions. All package versions, API endpoints, and CLI flags verified against current sources.

---

## Critical Decisions (Resolve Before Writing Code)

### Decision 1: Runtime & Distribution

**Problem:** The spec says Bun runtime + `npm i -g` distribution. These are contradictory — npm runs on Node, not Bun.

**Decision:** Develop with Bun, distribute as Node-compatible npm package.
- Use `tsup` (esbuild wrapper) to transpile TS/TSX to Node-compatible ESM
- `package.json` → `"engines": { "node": ">=20" }` (Node 18 EOL'd April 2025)
- Bun users get speed benefits when running via `bun`; Node users get compatibility
- **Not** using `bun build --compile` (90MB binaries, no npm distribution)
- **tsup MUST bundle ALL dependencies as non-external.** Global npm install has no dependency hoisting guarantee. Set `noExternal: [/.*/]` (regex) in `tsup.config.ts` to bundle everything into a self-contained file. Listing only top-level packages misses transitive deps (Ink alone has 24+ runtime deps including `react-reconciler`, `yoga-layout`, `ws`, etc.). Validate with `npm pack && npm i -g ./tuinnel-*.tgz` in CI
- **React deduplication is critical.** esbuild can create multiple React copies from different dependency paths, breaking hooks. Use `esbuildOptions.alias` to force single instance (see Appendix A)
- **Ink does NOT use `react-dom`.** It uses `react-reconciler` directly as a custom renderer. Do not include `react-dom` in dependencies

### Decision 2: Bun + Ink Compatibility

**Problem:** Ink has a known stdin issue under Bun ([oven-sh/bun#6862](https://github.com/oven-sh/bun/issues/6862), open since Nov 2023). Bun doesn't auto-resume `process.stdin`, so Ink apps exit immediately without accepting keyboard input.

**Status (Feb 2026):** This is a **medium risk, not critical**. Research confirms (Bun 1.3.9, latest):
- Basic rendering (Box, Text, static output) works fine under Bun
- `bun build --compile` with Ink works (resolved mid-2025)
- `stdin.ref()` crash: fixed in Bun 1.2.1 ([#16678](https://github.com/oven-sh/bun/issues/16678))
- Ink script crash: fixed ([#16805](https://github.com/oven-sh/bun/issues/16805))
- `readline.close()` breaks stdin with `useInput`: fixed ([#21189](https://github.com/oven-sh/bun/issues/21189))
- `tty.ReadStream.ref` missing: fixed ([#22372](https://github.com/oven-sh/bun/issues/22372))
- EPERM stdin with `@clack/prompts`: fixed in Bun 1.3.2 ([#24615](https://github.com/oven-sh/bun/issues/24615))
- **Umbrella issue [#6862](https://github.com/oven-sh/bun/issues/6862) is still OPEN** but all individual sub-issues are resolved
- The `@inkjs/ui` components (TextInput, Select) work with the workaround below

**The one remaining issue:** `process.stdin` doesn't keep the process alive. Clean workaround:

```tsx
// Add to root <App> component — 3 lines
const { isRawModeSupported, setRawMode } = useStdin();
useEffect(() => {
  if (isRawModeSupported) setRawMode(true);
  return () => { setRawMode(false); };
}, []);
```

This preserves proper cleanup, `waitUntilExit()`, and single Ctrl+C exit. Also use explicit `useApp().exit()` to avoid a macOS cursor-disappearing bug ([oven-sh/bun#26642](https://github.com/oven-sh/bun/issues/26642)).

**Decision:** Proceed with Ink + Bun using the `setRawMode` workaround. Use Ink v6.7.0 + React 19.2.4.

**HOWEVER: A 2-hour validation spike is mandatory before Phase 3b** (see Validation Tasks section). The spike must build a minimal Ink v6 + React 19 + @inkjs/ui (TextInput, Select) app and verify it works under both Bun 1.3.9+ AND Node 20. This is non-negotiable — if it fails, we need to know before building the TUI.

**Validated package versions (Feb 2026):**
- `ink@6.7.0` — React >=19, Node >=20. Notable v6.x features: `maxFps` (6.3.0), `incrementalRendering` (6.5.0), `onRender` hook (6.4.0), React concurrent rendering (6.7.0), Kitty keyboard protocol (6.7.0), synchronized updates to fix terminal flickering (6.7.0), Home/End key support in `useInput` (6.6.0)
- `react@19.2.4` — latest stable, required by Ink v6
- `@inkjs/ui@2.0.0` — peer dep: `ink >=5`, compatible with Ink v6. Components: TextInput, EmailInput, PasswordInput, ConfirmInput, Select, MultiSelect, Spinner, ProgressBar, Badge, StatusMessage, Alert, UnorderedList, OrderedList
- `@types/react@19.2.13` — dev dependency
- `ink-testing-library@4.0.0` — **RISK**: built for Ink v5 / React 18, no official Ink v6 update. Likely works at runtime since it just wraps Ink's `render()`. Test during spike. Fallback: write thin wrapper around Ink's `render()` for testing
- Bun: `>=1.3.9` (current latest, targets Node.js 22 API compat)

### Decision 3: TUI Data Sources — Scope Reduction

**Problem:** The spec's TUI shows per-request access logs with HTTP method, path, status code, response time, headers, client IP, and geo info. **cloudflared does not emit this data.** At `--loglevel debug`, it logs some request info (URL, method) but NOT status codes, NOT response times, NOT CF-Connecting-IP, NOT CF-IPCountry. Getting the spec's mockup would require a local reverse proxy — too complex for v1.

**Decision:** Two-tier approach for v1:
- **Phase 3b TUI (core):** Show connection events parsed from cloudflared stderr only. No Prometheus scraping. This gets the TUI working with minimal complexity.
- **Phase 4 (enhanced):** Add Prometheus metrics scraping (`--metrics 127.0.0.1:0`) for aggregate stats. Validated available metrics: `cloudflared_tunnel_total_requests` (counter), `cloudflared_tunnel_request_errors` (counter), `cloudflared_tunnel_response_by_code` (counter vec, label: `status_code`), `cloudflared_tunnel_concurrent_requests_per_tunnel` (gauge), `cloudflared_tunnel_ha_connections` (gauge), `cloudflared_proxy_connect_latency` (histogram, buckets: 1/10/25/50/100/500/1000/5000ms), QUIC RTT metrics. **NOTE: No bandwidth/bytes-transferred metrics exist in cloudflared.** Remove bandwidth from TUI mockup. Scrape every 2-3 seconds.
- **v2 consideration:** Optional local proxy for full request/response inspection

### Decision 4: `tuinnel down` Default Behavior Fix

**Problem (spec contradiction):** The spec says `tuinnel down` (default) removes the tunnel config from CF API but keeps DNS records for "fast restart." But the CNAME points to `<tunnel-uuid>.cfargotunnel.com` — deleting the tunnel invalidates the UUID, so the DNS record points to nothing. Next `tuinnel up` creates a new tunnel with a new UUID, but the old CNAME is stale.

**Decision:** `tuinnel down` (default) should:
- Stop the cloudflared connector process
- **Keep the tunnel resource on CF** (just stop the connection, don't delete the tunnel)
- Keep DNS records intact
- Result: fast restart — same tunnel UUID, same DNS record, just reconnect

`tuinnel down --clean` should:
- Stop the cloudflared connector
- Delete the tunnel from CF
- Delete the DNS CNAME record
- Full cleanup

**Confirmation behavior:**
- `tuinnel down <name>` — stops the named tunnel, no confirmation needed
- `tuinnel down` with no args in interactive mode — prompt: "Stop all N running tunnels? (y/N)" or list and ask
- `tuinnel down` with no args in non-interactive mode — require `--all` flag, error otherwise
- `tuinnel down --all` — stops all, no confirmation

### Decision 5: Quick Tunnels Must Bypass Setup Wizard

**Problem:** The spec says "any command" without a token triggers the setup wizard, but quick tunnels don't need a token.

**Decision:** `tuinnel up <port> --quick` bypasses token validation entirely. The setup wizard only triggers for commands that actually require an API token (named tunnels, zones, doctor, etc.).

**Additionally:** `tuinnel up <port>` without `--quick` and without a configured token should default to quick tunnel mode with a message: "No API token configured. Running as quick tunnel (random subdomain). For custom domains, run `tuinnel init` first." This reduces friction for first-time users.

### Decision 6: CLI Framework

**Problem:** Spec says "Commander.js or yargs (TBD)."

**Decision:** Commander.js v14 (`commander@14.0.3`) — smaller (~60KB vs ~200KB), better TypeScript support, `.command()` + `.action()` maps cleanly to verb-based CLI structure. Ships own `.d.ts` types. Optional `@commander-js/extra-typings@14.0.0` for inferred `.opts()` return types. Requires Node >=20. Use `await program.parseAsync(process.argv)` for async action handlers (not `.parse()`). Dynamic `await import()` per command for fast startup.

**Bare `tuinnel` command behavior:** Attach `.action()` to root `program` object. Do NOT render Commander.js default help wall.
- If no config exists: print welcome message + suggest `tuinnel up <port>` for quick tunnel or `tuinnel init` for custom domains
- If config exists: print brief help showing top 4 commands (`up`, `down`, `list`, `status`) with one-line descriptions
- Full `--help` still available via flag

### Decision 7: Inline Add Flow Design

**Problem:** When a user runs `tuinnel up <port>` for a port not in config, the flow needs to seamlessly add the tunnel and start it. The transition from Ink prompts to TUI rendering is under-specified.

**Decision:** The inline add flow works as follows:

1. User runs `tuinnel up 4200`
2. Port 4200 not found in config
3. **Smart framework detection:** Read `package.json` in CWD, parse `scripts.dev` field. `next dev` -> suggest "next", `ng serve` -> suggest "angular", `vite` -> suggest "vite". Fall back to port-map.ts static table. ~20 lines of code.
4. Ink renders a mini-wizard inline:
   - "Subdomain suggestion: `angular` — accept? (Y/n)" (single keypress, no Enter needed)
   - Zone picker if multiple zones (Select component)
5. On confirmation, the same Ink render tree transitions from wizard components to TUI components — no process restart, no re-render. The App component switches state from `mode: 'setup'` to `mode: 'dashboard'`.
6. Tunnel creation + DNS + ingress happens during a "Starting..." loading state inside the TUI

If `--no-tui` is active, the prompts are standard stdin line-based (or require all params via flags in non-interactive mode).

### Decision 8: Startup Sequence (Explicit 4-Step Reconciliation)

**Problem:** The startup sequence for `tuinnel up` is under-specified. Multiple things can go wrong, and the order matters for idempotency.

**Decision:** The startup sequence for each tunnel follows this exact order:

1. **Create-or-get tunnel:** Call CF API to create named tunnel. If it already exists (409 Conflict), fetch the existing tunnel by name — this is success, not an error. Extract tunnel UUID and connector token.
2. **ALWAYS update ingress config:** Push the current ingress rules to CF API on every `up`, even if the tunnel already existed. This ensures config drift is corrected. The ingress config maps the public hostname to `http://localhost:<port>` (or `https://` if auto-detected).
3. **Create-or-verify DNS:** Create CNAME record `subdomain.zone` -> `<tunnel-uuid>.cfargotunnel.com`. If CNAME already exists and points to our tunnel UUID, this is success. If it points to a different tunnel, warn and ask to overwrite.
4. **Spawn connector:** Start `cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 --loglevel debug run --token <connector-token>`

**Multi-tunnel ordering:** Sequential, not parallel. This gives clear error attribution and avoids CF API rate limits. Show per-tunnel progress as each completes.

**On failure at any step:** Log what was created to stderr. Best-effort cleanup of resources created in the current session. Tell user to run `tuinnel purge` if cleanup fails. No formal transaction log — see Decision 9.

### Decision 9: Simplify Error Recovery for v1

**Problem:** The v1 plan calls for a transaction log with rollback — this is enterprise-grade complexity that delays shipping.

**Decision:** For v1, replace the transaction log with:
1. Log every CF resource creation to stderr as it happens (e.g., "Created tunnel tuinnel-angular (uuid: abc123)")
2. On failure, best-effort cleanup: iterate created resources in reverse, delete each, log success/failure
3. If cleanup itself fails, print: "Some resources could not be cleaned up. Run `tuinnel purge` to remove orphaned tunnels."
4. `tuinnel purge` is the safety net (moved to Phase 3a — available from day one of tunnel testing)

Formal transaction logging with write-ahead PID is deferred to v2.

---

## Architecture Overview

### Tech Stack (Finalized)

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| Language | TypeScript | 5.x | Spec requirement |
| Dev runtime | Bun | >=1.3.9 | Fast tests, native TS/JSX, targets Node 22 API compat |
| Dist runtime | Node | >=20 | Node 18 EOL'd April 2025; universal npm compat |
| Build tool | tsup (esbuild) | 8.5.1 | TS+JSX -> ESM, `noExternal: [/.*/]` bundles ALL deps for self-contained CLI |
| TUI framework | Ink + React | 6.7.0 + 19.2.4 | Latest actively maintained, Bun compat confirmed with `setRawMode` workaround |
| TUI components | @inkjs/ui | 2.0.0 | TextInput, Select, Spinner, ProgressBar, etc. Peer dep: `ink >=5` |
| CLI framework | Commander.js | 14.0.3 | Lean, ships .d.ts types, async parseAsync(), dynamic imports per command |
| Validation | Zod | 3.x | Config + API response validation |
| CF API | Raw fetch + Zod | — | No SDK — spec says direct REST, SDK is heavy |
| HTTP client | Native fetch | — | Built into Node 20+ and Bun |

### Production Dependencies (7 packages, exact versions)

```json
{
  "ink": "^6.7.0",
  "react": "^19.2.4",
  "@inkjs/ui": "^2.0.0",
  "commander": "^14.0.3",
  "zod": "^3.24.0",
  "chalk": "^5.4.0",
  "cli-table3": "^0.6.5"
}
```

**Dev Dependencies:**
```json
{
  "@types/react": "^19.2.13",
  "ink-testing-library": "^4.0.0",
  "tsup": "^8.5.1",
  "typescript": "^5.7.0",
  "@commander-js/extra-typings": "^14.0.0"
}
```

**Removed:** `clipboardy` — replaced with direct `pbcopy`/`xclip` child process spawn. `react-dom` — Ink uses `react-reconciler` directly, not react-dom.

**Honest sizing:** The tsup bundle (with ALL deps inlined via `noExternal: [/.*/]`) should be ~1.5-2.5MB unminified. Largest contributor is `yoga-layout` WASM blob (~200-300KB). React 19 is ~174-186KB minified. With `treeshake: true` and `minify: true`, bundle can be ~600KB-1MB. Track bundle size in CI to catch regressions.

### Project Structure

```
tuinnel/
├── src/
│   ├── index.ts                  # Entry: CLI command routing via Commander
│   ├── types.ts                  # Shared domain types crossing module boundaries
│   ├── commands/
│   │   ├── init.ts               # Setup wizard (Ink: TextInput, Select)
│   │   ├── add.ts                # Add tunnel mapping (config only, does NOT start)
│   │   ├── remove.ts             # Remove tunnel mapping
│   │   ├── up.ts                 # Start tunnels → TUI
│   │   ├── down.ts               # Stop tunnels
│   │   ├── list.ts               # List tunnels (table output)
│   │   ├── status.ts             # Check running tunnel status (non-TUI)
│   │   ├── doctor.ts             # Diagnostic checks
│   │   ├── purge.ts              # Clean orphaned resources
│   │   └── zones.ts              # List CF zones
│   ├── tui/
│   │   ├── App.tsx               # Root Ink component, useReducer state
│   │   ├── Sidebar.tsx           # Tunnel list with health indicators
│   │   ├── MainPanel.tsx         # Selected tunnel details
│   │   ├── Metrics.tsx           # Live metrics from Prometheus scraping (Phase 4)
│   │   ├── LogView.tsx           # Connection event stream (ring buffer)
│   │   ├── HelpBar.tsx           # Context-sensitive keyboard shortcuts
│   │   └── hooks/
│   │       ├── useTunnelHealth.ts  # TCP port probe every 5s
│   │       ├── useMetrics.ts       # Prometheus endpoint scraper (Phase 4)
│   │       └── useCloudflaredLogs.ts # stderr line parser
│   ├── cloudflare/
│   │   ├── api.ts                # CF REST client (fetch + Zod validation + pagination)
│   │   ├── types.ts              # API response Zod schemas + inferred types
│   │   ├── errors.ts             # CF error code classification + user message mapping
│   │   └── tunnel-manager.ts     # Tunnel lifecycle orchestrator (create → DNS → ingress → spawn → cleanup)
│   ├── cloudflared/
│   │   ├── binary.ts             # Download, checksum verify, version check
│   │   ├── process.ts            # Spawn/manage cloudflared child processes
│   │   ├── config.ts             # Ingress YAML config generation for cloudflared
│   │   └── log-parser.ts         # Parse stderr for connection events + metrics port discovery
│   ├── config/
│   │   ├── store.ts              # Read/write ~/.tuinnel/config.json (atomic, 0600 permissions)
│   │   ├── schema.ts             # Zod config schema (version field from day one)
│   │   └── port-map.ts           # Port → framework name suggestions + CWD package.json detection
│   └── utils/
│       ├── port-probe.ts         # TCP connect probe for health checks
│       ├── clipboard.ts          # Direct pbcopy/xclip spawn (no clipboardy)
│       └── logger.ts             # Styled stderr output for non-TUI commands
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── bunfig.toml
└── SPEC.md
```

**Key additions vs v1:**
- `src/types.ts` — shared domain types (TunnelState, TunnelConfig, etc.) that cross module boundaries, avoids circular imports
- `src/cloudflare/tunnel-manager.ts` — restored from spec. Orchestrates the full tunnel lifecycle (create -> DNS -> ingress -> spawn -> cleanup). Without this, complex orchestration logic ends up in `commands/up.ts`
- `src/cloudflared/config.ts` — dedicated module for generating cloudflared ingress config. The YAML/JSON generation is non-trivial and doesn't belong in process.ts
- `src/commands/status.ts` — check running tunnel status without TUI, critical for `--no-tui` workflow and scripting

---

## UX Decisions

### First-Run Experience

1. **Quick tunnels need zero setup:** `tuinnel up 3000 --quick` works immediately after install — no wizard, no token
2. **Tokenless `tuinnel up <port>`:** If no token configured and no `--quick` flag, default to quick tunnel mode with message: "No API token configured. Running as quick tunnel. For custom domains, run `tuinnel init` first"
3. **Pre-wizard permission guidance:** Before prompting for token paste, print the required API token permissions:
   ```
   Required API Token Permissions:
     - Zone:Read       (list your domains)
     - DNS:Edit        (create/delete CNAME records)
     - Cloudflare Tunnel:Edit  (create/manage tunnels)

   Create a token at: https://dash.cloudflare.com/profile/api-tokens
   ```
4. **Token handling:** Strip whitespace, mask after paste (show last 4 chars), detect Global API Key vs API Token format mismatch, support `CLOUDFLARE_API_TOKEN` env var
5. **Existing config detection:** Check for `CLOUDFLARE_API_TOKEN` env var and `~/.cloudflared/` on init — offer to reuse
6. **Post-setup nudge:** After wizard completes, suggest: "Try: `tuinnel up 3000`" (NOT `tuinnel add 3000` — users want to see something work, not do more configuration)
7. **First-run binary download UX:** Show progress bar during cloudflared download, SHA256 checksum verification with visible confirmation, and on failure: "Download failed. Run `tuinnel doctor` to diagnose."

### Command Ergonomics

1. **Zero-config `tuinnel up <port>`:** If the port isn't in config, run an inline add flow (detect framework from CWD package.json, suggest subdomain, pick zone, start tunnel) — no separate `add` step required
2. **`tuinnel add` vs `tuinnel up` clarity:** Help text for `add` must explicitly state: "Saves tunnel configuration only. Does NOT start the tunnel. Use `tuinnel up` to start." This prevents confusion
3. **Subdomain parsing:** Match `angular.mysite.com` against known zones from the user's account to split subdomain/zone unambiguously. Support explicit flags: `--subdomain angular --zone mysite.com`
4. **`tuinnel down` with no args:** Confirmation required (see Decision 4)
5. **`tuinnel status`:** New command — shows running tunnel status in a table. Critical for `--no-tui` and scripting workflows. Output: name, public URL, local port, status (connected/disconnected), uptime
6. **`tuinnel add --adopt`:** For tunnels that exist on CF but not in local config (migration scenario). Lists `tuinnel-*` tunnels on CF, lets user select, imports into local config
7. **Aliases:** `ls` -> `list`, `rm` -> `remove`, `start` -> `up`, `stop` -> `down`
8. **Non-interactive mode:** Detect `!process.stdin.isTTY` AND `!process.stdout.isTTY` — require all params via flags, no prompts. Force `--no-tui` if stdout is piped
9. **`--json` flag:** Available in Phase 1 for `list`, `zones`, and `status` commands. Essential for scripting from day one
10. **Multi-tunnel startup progress:** Show per-tunnel progress as each completes:
    ```
    Starting tunnels...
      ✓ angular.mysite.com ← :4200  (1/3)
      ✓ vite.mysite.com ← :3000    (2/3)
      ⠋ api.mysite.com ← :8080     (3/3)
    ```

### Smart Port Suggestions (Enhanced)

Port suggestions now use a two-tier approach:

1. **CWD framework detection (preferred):** Read `package.json` in the current working directory. Parse the `scripts.dev` (or `scripts.start`) field:
   - Contains `next` -> "next"
   - Contains `vite` -> "vite"
   - Contains `ng serve` -> "angular"
   - Contains `react-scripts` -> "react"
   - Contains `nuxt` -> "nuxt"
   - Contains `remix` -> "remix"
   - Contains `astro` -> "astro"
   - ~20 lines of code, actually useful

2. **Static port map (fallback):** When no package.json found or scripts don't match:
   - `4200` -> "angular"
   - `3000` -> "app" (too ambiguous for framework guess)
   - `8080` -> "api"
   - `5173` -> "vite"
   - `8000` -> "django"
   - `5000` -> "flask" (warn on macOS: "Note: port 5000 is used by AirPlay Receiver")
   - `3001` -> "next"
   - `4000` -> "graphql"
   - Unknown -> "app-{port}"

### Bare `tuinnel` Command Behavior

**If no config exists:**
```
Welcome to tuinnel!

  Quick start (no account needed):
    tuinnel up 3000              Start a quick tunnel on port 3000

  Custom domains:
    tuinnel init                 Set up your Cloudflare account

  Learn more:
    tuinnel --help               Show all commands
```

**If config exists:**
```
tuinnel — Cloudflare tunnel manager

  tuinnel up [port...]           Start tunnels (TUI dashboard)
  tuinnel down [name...]         Stop tunnels
  tuinnel list                   Show configured tunnels
  tuinnel status                 Check running tunnel status

  tuinnel --help                 Show all commands
```

### TUI Dashboard

1. **Minimum terminal:** 80x24. Below that, collapse sidebar to a status line
2. **Single tunnel:** Hide sidebar, full-width detail panel
3. **Log auto-scroll:** Default on. Scrolling up pauses with "PAUSED -- press End to resume" indicator
4. **Empty state:** "Waiting for connections... Try visiting https://angular.mysite.com"
5. **`NO_COLOR` support:** Respect the `NO_COLOR` env var standard
6. **`--no-tui` flag:** Plain log output to stdout for SSH/tmux/CI contexts
7. **TTY detection:** Check BOTH `stdin.isTTY` AND `stdout.isTTY` before rendering Ink. Force `--no-tui` if stdout is piped
8. **Focus model:** Focused panel gets brighter border and highlighted title. HelpBar updates to show context-sensitive shortcuts for the focused panel
9. **Color accessibility:** Health indicators use text labels alongside symbols: `● UP`, `○ DOWN`, `◌ CONNECTING` — not just color-coded dots
10. **Metrics data freshness:** Show "Metrics: 42s ago" timestamp. Dim values when last scrape is >10 seconds old (Phase 4)

### TUI Mockup (Reflects Actual Available Data)

```
┌──────────────────┬───────────────────────────────────────────────┐
│  TUNNELS         │  angular.mysite.com <- :4200                  │
│                  │                                                │
│  ● UP  angular   │  Status: ● Connected    Uptime: 00:12:34     │
│        :4200     │  Local:  http://localhost:4200                 │
│  ● UP  vite      │  Public: https://angular.mysite.com           │
│        :3000     │                                                │
│  ○ DOWN api      │  ── Connection Events ─────────────────────── │
│        :8080     │  14:23:01 INF  Registered tunnel connection   │
│                  │               connIndex=0 location=DFW        │
│                  │  14:23:01 INF  Registered tunnel connection   │
│                  │               connIndex=1 location=LAX        │
│                  │  14:23:05 INF  Registered tunnel connection   │
│                  │               connIndex=2 location=ORD        │
│                  │  14:23:05 INF  Registered tunnel connection   │
│                  │               connIndex=3 location=EWR        │
│                  │  14:22:58 INF  Connection established          │
│                  │                                                │
│                  │  ── Metrics (Phase 4) ─────────────────────── │
│                  │  Requests: 142   Errors: 2   Active: 3        │
│                  │  2xx: 138  4xx: 2  5xx: 2                     │
│                  │  Connect latency p50: 12ms  p95: 48ms         │
│                  │  HA connections: 4   Metrics: 3s ago           │
└──────────────────┴───────────────────────────────────────────────┘
  ↑↓ Navigate  Tab Focus  c Copy URL  o Open  r Restart  ? Help  q Quit
```

**Phase 3b (initial):** Shows connection events from stderr only. Metrics section shows "Enable with Phase 4" or is hidden.

**Phase 4 (enhanced):** Adds live Prometheus metrics in the Metrics section, scraped every 2-3 seconds.

### TUI Tunnel States

The TUI reducer uses explicit states for each tunnel:

| State | Display | Description |
|-------|---------|-------------|
| `creating` | `◌ CREATING` | CF API calls in progress (create tunnel, DNS, ingress) |
| `connecting` | `◌ CONNECTING` | cloudflared process spawned, waiting for first connection event |
| `connected` | `● UP` | At least one connection registered, local port is listening |
| `disconnected` | `○ DOWN` | cloudflared running but lost all connections |
| `port_down` | `⚠ PORT DOWN` | Tunnel connected but local port not responding (502s will occur) |
| `restarting` | `◌ RESTARTING` | Restart in progress (after user `r` or crash auto-restart) |
| `error` | `✗ ERROR` | Fatal error, will not auto-recover |
| `stopped` | `- STOPPED` | Gracefully stopped by user |

### Keyboard Shortcuts

| Key | Action | Notes |
|-----|--------|-------|
| `Up/Down` | Navigate tunnels | Universal |
| `Tab` | Switch focus: sidebar <-> logs | Needed for log scrolling |
| `c` | Copy public URL | Flash "Copied: https://..." in HelpBar for 2 seconds |
| `o` | Open URL in browser | `open`/`xdg-open` |
| `r` | Restart selected tunnel | |
| `/` | Filter logs | Standard search convention |
| `Esc` | Clear filter / back | |
| `?` | Show shortcut overlay | Discoverability |
| `q` | Quit (graceful shutdown) | See quit behavior below |
| `Ctrl+C` | Force quit | |

**`q` quit behavior:** Quit defaults to YES, cleanup defaults to NO. Exact prompt:
```
Stop all tunnels and exit? Tunnels remain on CF for fast restart. (Y/n)
```

**Removed:** `Space` for toggle — too easy to hit accidentally. Use `r` for restart, `x` for stop (with confirmation).

### URL Copy Behavior

- On `c` keypress, copy selected tunnel's public URL to clipboard
- Flash confirmation in HelpBar: "Copied: https://angular.mysite.com" for 2 seconds, then restore normal shortcuts
- **Clipboard implementation:** Direct `pbcopy` (macOS) / `xclip` or `xsel` (Linux) spawn via `child_process.execSync`
- **Linux clipboard detection:** On startup, check if `xclip` or `xsel` is available. If neither found, show `c` shortcut as dimmed with tooltip "(install xclip for clipboard support)" instead of crashing

### Error Messages

Pattern: `error: <what>\n\n<why>\n<remediation with exact command>`

Every error includes: (1) what went wrong, (2) why it happened, (3) what to do about it with a concrete command or URL. Exit codes: 0=success, 1=error, 2=usage error, 130=SIGINT.

---

## Cloudflare API Client Design

### Pagination

All CF API list endpoints use **page-based** pagination (NOT cursor-based). Default `per_page` is 20 (min: 5, max: 50). Users with >20 zones or tunnels will silently lose results without proper pagination.

**Response `result_info` format:**
```json
{
  "page": 1,
  "per_page": 20,
  "count": 20,
  "total_count": 200,
  "total_pages": 10
}
```

**Implementation:** Generic async generator:

```typescript
async function* paginate<T>(
  endpoint: string,
  params: Record<string, string>,
  token: string
): AsyncGenerator<T> {
  let page = 1;
  while (true) {
    const response = await cfFetch(endpoint, { ...params, page: String(page), per_page: '50' }, token);
    const data = response.result as T[];
    for (const item of data) yield item;
    if (!response.result_info || response.result_info.page >= response.result_info.total_pages) break;
    page++;
  }
}
```

Use this for all list endpoints: zones, tunnels, DNS records.

**CF API standard response envelope:**
```typescript
interface CFResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
    total_pages: number;
  };
}
```

### Fetch Timeout

30-second `AbortController` timeout on all CF API calls. Show spinner for operations taking >2 seconds.

```typescript
async function cfFetch(url: string, opts?: RequestInit): Promise<CFResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}
```

### Retry Logic

| Error Type | Behavior |
|------------|----------|
| HTTP 429 (rate limit) | Read `Retry-After` header, wait, retry up to 3 times |
| HTTP 5xx (server error) | Retry once with exponential backoff (1s, then 2s) |
| HTTP 4xx (non-429) | Fail immediately — client error, retrying won't help |
| Network error / timeout | Retry once after 2 seconds |

### Error Classification

CF API errors must be classified into three categories with different handling:

| Category | Examples | Handling |
|----------|----------|----------|
| **Fatal** | Invalid token (403), insufficient permissions | Fail with clear remediation guidance, suggest `tuinnel doctor` |
| **Recoverable** | Tunnel already exists (409), DNS record already correct | Treat as success, log at debug level |
| **Transient** | Rate limit (429), server error (5xx), timeout | Retry with backoff per retry logic above |

**Zone-scoped token gotcha:** CF API tokens can be scoped to specific zones. A token might work for `mysite.com` but return 403 for `othersite.com`. When a 403 occurs on a zone-specific operation, include in the error message: "Your API token may not have access to this zone. Check token permissions at https://dash.cloudflare.com/profile/api-tokens"

---

## Process Management

### cloudflared Process Spawning

```typescript
// IMPORTANT: --no-autoupdate, --metrics, --loglevel go BEFORE 'run'
// --token goes AFTER 'run'
const child = spawn(cloudflaredPath, [
  'tunnel',
  '--no-autoupdate',
  '--metrics', '127.0.0.1:0',  // Port 0 = OS assigns random port, discover from stderr
  '--loglevel', 'info',        // Valid: debug, info, warn, error, fatal
  '--protocol', 'quic',        // Options: auto (default), http2, quic
  'run',
  '--token', connectorToken    // Or use --token-file /path (v2025.4.0+) for ps aux privacy
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false
});
```

**Note:** Without `--metrics`, cloudflared defaults to ports 20241-20245, then random. Using `127.0.0.1:0` forces OS random port assignment, which is safer for multi-tunnel scenarios.

### Signal Handling

Handle all relevant signals and child process events:

| Signal/Event | Handler |
|-------------|---------|
| `SIGTERM` | Graceful shutdown: send SIGTERM to all cloudflared children, wait up to 5s, then SIGKILL |
| `SIGINT` | Same as SIGTERM (Ctrl+C) |
| `SIGPIPE` | Ignore (prevents crash when piped output closes) |
| `SIGHUP` | Ignore (prevents crash when terminal closes; tunnels keep running only with future daemon mode) |
| `child.on('error')` | Log spawn failure, set tunnel state to `error` |
| `child.on('exit', code, signal)` | If unexpected: attempt auto-restart with backoff (1s, 2s, 4s, max 3 attempts). If persistent crash: set state to `error`, log last 10 stderr lines |
| `child.stderr.on('error')` | Log and ignore (prevents unhandled exception crash) |
| `process.on('exit')` | Terminal restoration safety net — ensure raw mode is disabled even on abnormal exit |

### Metrics Port Discovery

cloudflared prints the metrics port to stderr in this exact format:
```
2024-07-01T18:40:32Z INF Starting metrics server on 127.0.0.1:20241/metrics
```

The log-parser regex: `/Starting metrics server on ([\d.]+:\d+)\/metrics/`. Extract host:port for Prometheus scraping (Phase 4). The metrics endpoint is at `http://<addr>/metrics`.

### cloudflared Stderr Log Format

**Timestamp format:** `YYYY-MM-DDTHH:MM:SSZ` (UTC ISO 8601, second precision)

**Log level abbreviations:** `DBG`, `INF`, `WRN`, `ERR`, `FTL`

**Startup sequence (exact lines):**
```
<TS> INF Version 2025.8.0 (Checksum <hash>)
<TS> INF GOOS: <os>, GOVersion: <go_ver>, GoArch: <arch>
<TS> INF Settings: map[no-autoupdate:true]
<TS> INF Generated Connector ID: <uuid>
<TS> INF Initial protocol quic
<TS> INF Starting metrics server on 127.0.0.1:<PORT>/metrics
<TS> INF Registered tunnel connection connIndex=0 connection=<uuid> event=0 ip=<edge_ip> location=<colo> protocol=quic
<TS> INF Registered tunnel connection connIndex=1 connection=<uuid> event=0 ip=<edge_ip> location=<colo> protocol=quic
<TS> INF Registered tunnel connection connIndex=2 ...
<TS> INF Registered tunnel connection connIndex=3 ...
```

**Registration line fields:** `connIndex` (0-3, four HA connections), `connection` (UUID), `event` (counter), `ip` (Cloudflare edge IP), `location` (datacenter code like `lax08`, `sjc07`, `ORD`), `protocol` (`quic` or `http2`)

### PID Tracking and Concurrent Instance Protection

**Moved from Phase 4 to Phase 3a.** Two `tuinnel up` instances will spawn conflicting cloudflared processes pointing at the same tunnel UUID — this causes connection flapping.

Implementation:
- Write `~/.tuinnel/.pids.json` with `{ tunnelName: pid }` mapping
- On startup, check if PIDs in the file are still running (`process.kill(pid, 0)`)
- If a tunnel is already running, refuse to start a duplicate: "Tunnel 'angular' is already running (PID 12345). Use `tuinnel down angular` first."
- Write PID to file BEFORE confirming tunnel started (write-ahead). On startup, check for PIDs with no corresponding live process — these are crash orphans, clean up their entries

### cloudflared Crash Restart

When a cloudflared child process exits unexpectedly:
1. Use the same connector token (tokens don't expire between restarts within a session)
2. Backoff: 1s, 2s, 4s (3 attempts max)
3. If all restarts fail, set tunnel state to `error` and show last stderr output
4. If the crash happens within 5 seconds of spawn (fast crash), skip to error state immediately — likely a config issue, not transient

### Connector Token Security

Tunnel connector tokens are visible in `ps aux` output. This is a known limitation of cloudflared's `--token` flag. Document as a v1 known limitation. **For v2: `--token-file /path` flag exists since cloudflared v2025.4.0+** — reads token from file instead of CLI arg. This is the preferred approach for production use.

### Binary Update Safety

Never auto-update cloudflared while tunnels are running. On version check:
- If tunnels are running: show notification "cloudflared update available (v2024.x.y). Will update on next `tuinnel up`."
- If no tunnels running: update during next `tuinnel up` startup sequence

---

## Security

1. **Config file permissions:** Create `~/.tuinnel/config.json` with mode `0600`
2. **Env var support:** `TUINNEL_API_TOKEN` overrides config file token
3. **Binary verification:** SHA256 checksum of cloudflared download against published checksums
4. **Atomic downloads:** Download to `.tmp`, verify, then rename — prevents corrupt binaries
5. **Token in ps output:** Known v1 limitation, document it. **v2: use `--token-file`** (available since cloudflared v2025.4.0+) to read token from file instead of CLI arg

---

## Tunnel Naming Convention

Internal CF tunnel names use format: `tuinnel-{name}` (e.g., `tuinnel-angular`). This prefix:
- Identifies tuinnel-managed tunnels for `purge` and `--adopt` commands
- Is never shown to the user — they just see "angular"
- Applied consistently in `add`, `up`, `purge`, and `--adopt` commands

---

## Implementation Phases

### Phase 1: Foundation + Validation

**Goal:** Set up project, config management, CF API client with proper pagination/retry/timeout, and validate the Ink+Bun stack.

**Tasks:**
- [ ] Initialize project: `package.json` (`"type": "module"`, `"engines": { "node": ">=20" }`, `"bin": { "tuinnel": "dist/index.js" }`, `"files": ["dist"]`), `tsconfig.json` (module: Node16/NodeNext), `bunfig.toml`, `tsup.config.ts` (with `noExternal: [/.*/]`, `treeshake: true`, esbuild alias for React dedup — see Appendix A)
- [ ] `src/types.ts`: Shared domain types (`TunnelConfig`, `TunnelState`, `Zone`, etc.)
- [ ] Config store: read/write/validate `~/.tuinnel/config.json` with Zod, atomic writes, 0600 permissions, `version` field from day one
- [ ] Config schema: Zod schema with `version: 1` field. No migration infrastructure yet — write migrations when v2 actually changes the schema
- [ ] CF API client (`src/cloudflare/api.ts`) with:
  - Base URL: `https://api.cloudflare.com/client/v4`, auth: `Authorization: Bearer <token>`
  - Zod response schemas (see Appendix I) for type-safe parsing
  - `async function* paginate<T>()` generator for all list endpoints (page-based, per_page=50, max=50)
  - 30s `AbortController` timeout on all fetch calls
  - Retry logic: 429 (read Retry-After, 3 retries), 5xx (1 retry, exponential backoff), 4xx (fail immediately)
  - Error classification: fatal / recoverable / transient (see Appendix D)
  - Account ID discovery: `GET /zones` → `result[0].account.id` (cache after first call)
  - Spinner for operations >2 seconds
- [ ] `tuinnel init` command: pre-wizard permission guidance, token input, validation, zone selection
- [ ] `tuinnel zones` command: list zones in table format, with `--json` flag
- [ ] `tuinnel list` command: table output, with `--json` flag
- [ ] `tuinnel doctor` command: token check, permissions check, network check, config check, cloudflared binary check
- [ ] Bare `tuinnel` command: context-aware help (no config vs has config)
- [ ] Unit tests for API client (mocked fetch), config store, pagination, retry logic

**Exit criteria:** User can `tuinnel init`, see zones, run doctor. CF API client handles pagination, timeouts, and retries correctly. `--json` works for `list` and `zones`.

### Phase 2: Binary Management + Tunnel Config

**Goal:** cloudflared download and tunnel CRUD without starting tunnels.

**Tasks:**
- [ ] Platform detection: `process.platform` + `process.arch` → asset map (see Appendix G). **macOS = `.tgz` archive** (must extract), **Linux = bare binary**
- [ ] Binary download with progress bar from `https://github.com/cloudflare/cloudflared/releases/latest/download/<asset>`. SHA256 checksum verification — parse from release notes body via GitHub API (`gh api repos/cloudflare/cloudflared/releases/latest --jq '.body'`). Atomic install (download to `.tmp`, verify, rename)
- [ ] Download failure UX: clear error message + suggest `tuinnel doctor`
- [ ] Version tracking in `~/.tuinnel/bin/.version`. Check with `cloudflared version --short` → `2025.8.0`
- [ ] `tuinnel add` command: port mapping, smart subdomain suggestion (CWD package.json detection + port-map fallback), zone picker
- [ ] `tuinnel add` help text: explicitly state "Saves config only. Does NOT start tunnel."
- [ ] `tuinnel add --adopt`: list `tuinnel-*` tunnels on CF not in local config, let user import
- [ ] `tuinnel remove` command
- [ ] Port map with CWD package.json detection (`src/config/port-map.ts`)
- [ ] Unit tests for binary manager, port map, framework detection

**Exit criteria:** User can add/remove/list tunnels, cloudflared downloads correctly on both platforms. Framework detection works from CWD package.json.

### Phase 3a: Tunnel Runtime (No TUI)

**Goal:** Start and stop tunnels with `--no-tui` output. Process management, PID tracking, concurrent instance protection, and purge command.

**Tasks:**
- [ ] `src/cloudflare/tunnel-manager.ts`: Orchestrator implementing the 4-step startup sequence (see Appendix E for exact API endpoints): (1) `POST /accounts/{id}/cfd_tunnel` with `config_src: "cloudflare"`, handle 409 → `GET ?name=...&is_deleted=false`, fetch token via `GET .../token`; (2) `PUT .../configurations` with ingress rules + catch-all; (3) `POST /zones/{id}/dns_records` CNAME → `{uuid}.cfargotunnel.com` proxied:true; (4) spawn connector
- [ ] `src/cloudflared/config.ts`: Ingress config generation module
- [ ] `src/cloudflared/process.ts`: Spawn/manage cloudflared child processes
- [ ] `src/cloudflared/log-parser.ts`: Parse stderr for connection events and metrics port discovery (see Appendix J for implementation-ready parser with regex patterns)
- [ ] Process spawning with all signal handlers (SIGTERM, SIGINT, SIGPIPE, SIGHUP, child error/exit, stderr error)
- [ ] Terminal restoration trap: `process.on('exit', ...)` as safety net for raw mode cleanup
- [ ] PID tracking in `~/.tuinnel/.pids.json` with write-ahead logging
- [ ] Concurrent instance protection: refuse to start duplicate tunnels
- [ ] `tuinnel up` command with `--no-tui` flag: startup sequence, plain log output to stdout
- [ ] `tuinnel up <port>` inline flow (non-TUI path): detect framework, prompt for subdomain/zone, add to config, start
- [ ] Multi-tunnel sequential startup with per-tunnel progress display
- [ ] `tuinnel down` command: stop connector (default) or full clean (`--clean`), confirmation for no-args
- [ ] `tuinnel status` command: running tunnel status table with `--json` flag
- [ ] `tuinnel purge` command: find orphaned `tuinnel-*` tunnels, prompt for deletion
- [ ] Quick tunnel mode: `tuinnel up <port> --quick` (no API, trycloudflare.com)
- [ ] Tokenless `tuinnel up <port>`: default to quick tunnel with guidance message
- [ ] Best-effort cleanup on failure (log to stderr, suggest `tuinnel purge`)
- [ ] cloudflared crash auto-restart with backoff (1s, 2s, 4s, max 3 attempts)
- [ ] Non-interactive mode: detect `!process.stdin.isTTY`, require flags, no prompts
- [ ] TTY detection: check `stdout.isTTY`, force `--no-tui` if stdout is piped
- [ ] Integration tests: create/start/stop/purge tunnel lifecycle
- [ ] **Bun+Ink validation spike** (2 hours max): build minimal Ink v6 + React 19 + @inkjs/ui (TextInput, Select) app, test under Bun latest AND Node 20. Document results. MUST pass before Phase 3b begins

**Exit criteria:** User can start/stop tunnels via CLI with `--no-tui`. PID tracking prevents conflicts. Purge cleans orphans. Bun+Ink spike passes.

### Phase 3b: TUI Dashboard

**Goal:** Full TUI dashboard showing tunnel status and connection events from stderr.

**Tasks:**
- [ ] TUI `App.tsx`: Root component with `useReducer` state, mode switching (setup -> dashboard), explicit tunnel states
- [ ] TUI `Sidebar.tsx`: Tunnel list with accessible health indicators (`● UP`, `○ DOWN`, `◌ CONNECTING`)
- [ ] TUI `MainPanel.tsx`: Selected tunnel details (status, uptime, URLs)
- [ ] TUI `LogView.tsx`: Connection event stream (ring buffer, 1000 entries), auto-scroll with pause
- [ ] TUI `HelpBar.tsx`: Context-sensitive shortcuts based on focused panel
- [ ] Focus model: Tab to switch panels, brighter border on focused panel
- [ ] `useTunnelHealth.ts` hook: TCP port probe every 5s
- [ ] `useCloudflaredLogs.ts` hook: stderr line parser for connection events
- [ ] Inline add flow (TUI path): mini-wizard -> dashboard transition within same Ink render tree
- [ ] Keyboard shortcuts: navigate, quit, copy URL, open browser, restart, filter, help overlay
- [ ] `q` quit behavior: "Stop all tunnels and exit? Tunnels remain on CF for fast restart. (Y/n)"
- [ ] URL copy with HelpBar confirmation flash (2 seconds)
- [ ] Clipboard availability detection on Linux (xclip/xsel check)
- [ ] Log filtering (`/` shortcut)
- [ ] `?` shortcut overlay
- [ ] `o` to open URL in browser
- [ ] Minimum terminal size handling (80x24, sidebar collapse)
- [ ] Single tunnel layout (hide sidebar)
- [ ] `NO_COLOR` support
- [ ] `Ctrl+C` force quit
- [ ] `setRawMode` workaround for Bun compatibility
- [ ] Terminal restoration on abnormal exit
- [ ] TUI component tests with `ink-testing-library` (do NOT defer to Phase 5)

**Exit criteria:** User can start tunnels and see live TUI with connection events, health indicators, and working keyboard shortcuts. TUI components have test coverage.

### Phase 4: Metrics, Polish, Adoption

**Goal:** Prometheus metrics in TUI, enhanced features, and production polish.

**Tasks:**
- [ ] Prometheus metrics scraper (`useMetrics.ts` hook): `cloudflared_tunnel_total_requests`, `cloudflared_tunnel_request_errors`, `cloudflared_tunnel_response_by_code`, `cloudflared_tunnel_concurrent_requests_per_tunnel`, `cloudflared_proxy_connect_latency`, `cloudflared_tunnel_ha_connections`, QUIC RTT metrics. **No bandwidth metrics available.** See Appendix K for full metric names. Scrape every 2-3 seconds
- [ ] Metrics port discovery from cloudflared stderr: regex `/Starting metrics server on ([\d.]+:\d+)\/metrics/` (already in log-parser from Phase 3a)
- [ ] `Metrics.tsx` component: live-updating aggregate stats in TUI
- [ ] Metrics data freshness indicator: "Metrics: 3s ago", dim when stale (>10s)
- [ ] Background update check for cloudflared (non-blocking, cached 24h, never update while tunnels running)
- [ ] `--verbose` / `--debug` global flag
- [ ] Command aliases (ls, rm, start, stop)
- [ ] Zero-config `tuinnel up <port>` polish (edge cases, error handling)

**Exit criteria:** TUI shows live Prometheus metrics. Production polish complete.

### Phase 5: Testing + Release

**Tasks:**
- [ ] E2E test script (local server -> tunnel -> curl public URL -> verify)
- [ ] CI pipeline: lint, type-check, unit tests, build, bundle size tracking
- [ ] CI: `npm pack && npm i -g ./tuinnel-*.tgz` test (validates tsup bundling works for global install)
- [ ] Integration tests with real CF account (full lifecycle)
- [ ] npm publish workflow
- [ ] README with quick start, commands reference, examples

**Exit criteria:** Published to npm, CI green, global install verified, documented.

---

## Validation Tasks

These must be completed before their dependent phases begin. They are explicitly NOT part of normal development flow — they are go/no-go gates.

### VT-1: Bun + Ink Spike (Before Phase 3b)

**Time budget:** 2 hours maximum.

**Build:**
- Minimal `ink@6.7.0` + `react@19.2.4` app
- Include `@inkjs/ui@2.0.0` TextInput and Select components
- Include `useInput` for keyboard handling (test Home/End keys added in 6.6.0)
- Include `setRawMode` workaround
- Include `useApp().exit()` for clean exit
- **Also test `ink-testing-library@4.0.0`** with Ink v6 (not officially updated — validate it works)

**Test under:**
- Bun >= 1.3.9 (current latest)
- Node 20

**Verify:**
- App starts and stays alive (stdin keeps process running)
- TextInput accepts input and submits
- Select component navigates and selects
- `useInput` receives keyboard events
- Single Ctrl+C exits cleanly
- No cursor artifacts on macOS
- `waitUntilExit()` resolves properly
- `ink-testing-library` can render and assert on components

**If spike fails:** Evaluate fallback options before proceeding: (1) Ink v5 instead of v6, (2) different workaround, (3) Bun-only or Node-only, (4) custom test wrapper if `ink-testing-library` fails. Document findings.

### VT-2: Global npm Install Test (Before Phase 5 Release)

**Build:** Run in CI on every build:
```bash
npm pack
npm i -g ./tuinnel-*.tgz
tuinnel --version        # Verify binary works
tuinnel doctor           # Verify all imports resolve
tuinnel zones --json     # Verify Ink/React bundled correctly (this triggers import)
npm uninstall -g tuinnel
```

**Verify:**
- No "Cannot find module" errors (proves tsup bundled React/Ink correctly)
- No peer dependency warnings
- Binary is in PATH and executable
- All commands at least parse without crashing

### VT-3: Bundle Size Baseline (Phase 1)

After initial tsup config, record the bundle size. Track in CI — any jump >50KB should trigger investigation (likely a new dependency being pulled in or something being unbundled).

---

## Risk Register

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | tsup bundles dependencies as external -> global npm install breaks with "Cannot find module" | **Critical** | High | Set `noExternal: [/.*/]` (regex) in tsup config to bundle ALL deps. Add esbuild `alias` for React deduplication. VT-2 CI test validates global install on every build |
| 2 | Two `tuinnel up` instances spawn conflicting cloudflared processes | **High** | High | PID lockfile with concurrent instance protection in Phase 3a (not Phase 4) |
| 3 | Ink stdin quirk under Bun (#6862 still open) | **Medium** | Medium | All sub-issues fixed in Bun 1.3.x. `setRawMode(true)` workaround in root App. VT-1 spike validates before Phase 3b |
| 4 | CF API page-based pagination silently truncates results (>20 zones/tunnels, default per_page=20, max=50) | **Medium** | High | `async function* paginate<T>()` generator on all list endpoints from Phase 1 |
| 5 | No fetch timeout -> CLI hangs on slow/dead CF API | **Medium** | Medium | 30s AbortController timeout on all API calls, spinner after 2s |
| 6 | cloudflared log format changes between versions | **High** | Low | Use Prometheus metrics as primary data source (stable API); stderr parser as secondary. Pin cloudflared version range |
| 7 | TUI access logs can't show what spec promises | **High** | Certain | Already scoped down — Phase 3b shows connection events, Phase 4 adds aggregate Prometheus metrics |
| 8 | CF API rate limits during batch operations | **Medium** | Medium | Sequential operations (not parallel), 429 retry with Retry-After header, up to 3 retries |
| 9 | TUI crashes when stdout is piped | **Medium** | High | Check `stdout.isTTY` before Ink render, force `--no-tui` if piped |
| 10 | Incomplete cleanup on crash leaves orphaned CF resources | **Medium** | Medium | Best-effort cleanup + `tuinnel purge` as safety net (Phase 3a). No complex transaction log in v1 |
| 11 | CF API tokens are zone-scoped -> mysterious 403s on some domains | **Medium** | Medium | Include zone-scoping hint in 403 error messages: "Your token may not have access to this zone" |
| 12 | Tunnel connector token visible in `ps aux` | **Low-Med** | Certain | Document as v1 known limitation. `--token-file` flag exists since cloudflared v2025.4.0+ — use in v2 |
| 13 | `clipboardy` fragility / execa dep tree on Linux | **Medium** | Medium | Replaced with direct `pbcopy`/`xclip`/`xsel` spawn. Detect availability, gracefully degrade |
| 14 | Connector tokens can expire between `down` and next `up` | **Low-Med** | Low | On 401 from cloudflared, re-fetch connector token from CF API and retry spawn once |
| 15 | cloudflared download URL/format changes | **Medium** | Low | Version-pinned URL pattern; `tuinnel doctor` detects stale/missing binary |
| 16 | DNS propagation delay confuses users | **Low** | Medium | Show "URL may take a moment to resolve" message; CF edge is near-instant for CNAMEs |
| 17 | macOS port 5000 conflict with AirPlay | **Low** | Medium | Warn in smart suggestions when port 5000 is detected on macOS |
| 18 | Phase 3 scope creep (was a "death march" in v1) | **High** | High | Split into 3a (runtime, no TUI) and 3b (TUI). Get tunnels working with `--no-tui` first |
| 19 | Bundle size regression from new dependency | **Low** | Medium | Track bundle size in CI. Alert on >50KB jump |
| 20 | `ink-testing-library@4.0.0` built for Ink v5/React 18, not officially updated for Ink v6 | **Medium** | Medium | Likely works at runtime (just wraps `render()`). Validate during VT-1 spike. Fallback: write thin test wrapper around Ink's `render()` |
| 21 | esbuild creates duplicate React instances → hooks break | **Critical** | High | `esbuildOptions.alias` in tsup config forces single React copy. Validated approach from esbuild issue #3419 |
| 22 | macOS cloudflared downloads are .tgz archives (not bare binaries like Linux) | **Low** | Certain | Binary manager must detect `.tgz` extension and extract with `tar -xzf` before chmod +x |
| 23 | No SHA256SUMS file for cloudflared releases | **Medium** | Certain | Checksums embedded in release notes body. Parse via `gh api repos/cloudflare/cloudflared/releases/latest --jq '.body'` |
| 24 | CF API Dec 2025 change: deleted tunnels no longer returned by default | **Low** | Certain | Always pass `is_deleted=false` in list queries for clarity |

---

## Deferred to v2+

### From original plan:
- Per-request access logs with headers/geo (requires local proxy)
- Latency percentiles (p50/p95) per individual request
- HTTPS auto-detection (default to HTTP, user specifies `--protocol https`)
- System keychain token storage
- Shell completions
- `bun build --compile` standalone binary distribution
- Config import/export
- Cloudflare Access integration

### From review (explicit deferrals):
- `tuinnel up --background` daemon mode (requires proper daemonization, PID files, log rotation)
- `tuinnel config` command (edit config interactively)
- `tuinnel up --dry-run` (show what would happen without doing it)
- `tuinnel help <topic>` (topic-based help pages)
- Formal transaction log / write-ahead rollback (v1 uses best-effort cleanup + purge)
- Config migration infrastructure (v1 has `version` field, write migrations when schema actually changes)
- Tunnel token via `--token-file` instead of `--token` (ps aux privacy) — flag available since cloudflared v2025.4.0+
- Concurrent config store write protection (v1 is last-write-wins, documented limitation)

---

## Appendix A: tsup Configuration (Validated)

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,          // Uses Rollup for dead code elimination
  // CRITICAL: Bundle ALL dependencies into the output.
  // Global npm install does not hoist dependencies.
  // Listing only top-level packages misses transitive deps
  // (Ink alone has 24+ runtime deps: react-reconciler, yoga-layout, ws, etc.)
  noExternal: [/.*/],        // Regex: bundle everything
  // NOTE: Do NOT use banner for shebang. Instead, put #!/usr/bin/env node
  // as the first line of src/index.ts — tsup auto-preserves it AND
  // sets chmod +x on the output file. The banner approach may not chmod +x.
  esbuildOptions(options) {
    // CRITICAL: Force single React instance.
    // esbuild can bundle multiple React copies from different dependency paths,
    // which breaks React hooks entirely (shared internal state requirement).
    options.alias = {
      'react': 'react',
      'react-reconciler': 'react-reconciler',
    };
    // Ensure React runs in production mode (smaller, no dev warnings)
    options.define = {
      ...options.define,
      'process.env.NODE_ENV': '"production"',
    };
  },
});
```

**package.json required fields:**
```json
{
  "name": "tuinnel",
  "type": "module",
  "bin": { "tuinnel": "dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" }
}
```

**Why `noExternal: [/.*/]` instead of listing packages:**
- Ink has 24+ transitive runtime deps (`react-reconciler`, `scheduler`, `yoga-layout`, `ws`, `chalk`, `ansi-styles`, `ansi-escapes`, `cli-cursor`, `cli-truncate`, `cli-boxes`, `slice-ansi`, `string-width`, `wrap-ansi`, `widest-line`, `signal-exit`, `patch-console`, `stack-utils`, `code-excerpt`, `es-toolkit`, `auto-bind`, `type-fest`, etc.)
- Listing only top-level packages leaves transitive deps as external `import` statements → "Cannot find module" on global install
- `yoga-layout` ships WASM as inline base64 blob (SINGLE_FILE=1 build) — bundles correctly with `platform: 'node'`, no special WASM loader needed
- Ink does NOT use `react-dom` — it uses `react-reconciler` directly as a custom terminal renderer

## Appendix B: Config Schema

```typescript
// src/config/schema.ts
import { z } from 'zod';

const TunnelConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  subdomain: z.string().min(1),
  zone: z.string().min(1),
  protocol: z.enum(['http', 'https']).default('http'),
});

const ConfigSchema = z.object({
  version: z.literal(1),
  apiToken: z.string().optional(),
  defaultZone: z.string().optional(),
  tunnels: z.record(z.string(), TunnelConfigSchema).default({}),
});

type Config = z.infer<typeof ConfigSchema>;
type TunnelConfig = z.infer<typeof TunnelConfigSchema>;
```

## Appendix C: Shared Domain Types

```typescript
// src/types.ts

/** Tunnel states as rendered in the TUI */
export type TunnelState =
  | 'creating'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'port_down'
  | 'restarting'
  | 'error'
  | 'stopped';

/** Runtime tunnel info (combines config + live state) */
export interface TunnelRuntime {
  name: string;
  config: TunnelConfig;
  state: TunnelState;
  pid: number | null;
  tunnelId: string | null;     // CF tunnel UUID
  publicUrl: string | null;    // https://subdomain.zone.com
  connectorToken: string | null;
  metricsPort: number | null;  // Discovered from stderr
  uptime: number;              // ms since connected
  lastError: string | null;
  connections: ConnectionEvent[];
}

/** Parsed from cloudflared stderr */
export interface ConnectionEvent {
  timestamp: Date;
  level: 'DBG' | 'INF' | 'WRN' | 'ERR' | 'FTL';
  message: string;
  connIndex?: number;
  connectionId?: string;   // UUID of individual connection
  location?: string;       // datacenter code (lax08, sjc07, ORD, etc.)
  edgeIp?: string;         // Cloudflare edge IP
  protocol?: string;       // 'quic' or 'http2'
}

/** Prometheus metrics (Phase 4) — validated against cloudflared source */
export interface TunnelMetrics {
  totalRequests: number;           // cloudflared_tunnel_total_requests (counter)
  requestErrors: number;           // cloudflared_tunnel_request_errors (counter)
  concurrentRequests: number;      // cloudflared_tunnel_concurrent_requests_per_tunnel (gauge)
  haConnections: number;           // cloudflared_tunnel_ha_connections (gauge)
  activeStreams: number;           // cloudflared_tunnel_active_streams (gauge)
  responseCodeCounts: Record<string, number>;  // cloudflared_tunnel_response_by_code{status_code="200"}: 142
  connectLatencyMs: {              // cloudflared_proxy_connect_latency (histogram, buckets: 1/10/25/50/100/500/1000/5000ms)
    p50: number;
    p95: number;
    p99: number;
  };
  quicRtt: {                       // quic_client_smoothed_rtt / quic_client_min_rtt (gauge, ms)
    smoothed: number;
    min: number;
  };
  lastScrapedAt: Date;
  // NOTE: No bandwidth/bytes-transferred metrics exist in cloudflared
}
```

## Appendix D: CF Error Classification

```typescript
// src/cloudflare/errors.ts

interface CFError {
  code: number;
  message: string;
}

type ErrorCategory = 'fatal' | 'recoverable' | 'transient';

function classifyError(status: number, errors: CFError[]): ErrorCategory {
  // Fatal: bad credentials, insufficient permissions
  if (status === 401 || status === 403) return 'fatal';

  // Recoverable: resource already exists (tunnel, DNS record)
  if (status === 409) return 'recoverable';

  // Transient: rate limited
  if (status === 429) return 'transient';

  // Transient: server errors
  if (status >= 500) return 'transient';

  // Check specific CF error codes
  for (const err of errors) {
    if (err.code === 1003) return 'fatal';       // Invalid token
    if (err.code === 9109) return 'recoverable'; // Tunnel name already exists
    if (err.code === 81053) return 'recoverable'; // DNS record already exists
  }

  // Default: fatal (unknown errors should not be retried)
  return 'fatal';
}
```

## Appendix E: Startup Sequence Detail (Validated API Endpoints)

**CF API Base URL:** `https://api.cloudflare.com/client/v4`
**Auth header:** `Authorization: Bearer <API_TOKEN>`

```
tuinnel up angular vite api
│
├── 1. Validate prerequisites
│   ├── Check cloudflared binary (download if missing)
│   ├── Validate API token (or default to quick tunnel)
│   ├── Discover account_id from zones: GET /zones → result[0].account.id
│   └── Check PID lockfile (refuse if tunnels already running)
│
├── 2. For each tunnel (sequential):
│   │
│   ├── Step 1: Create-or-get tunnel
│   │   ├── POST /accounts/{account_id}/cfd_tunnel
│   │   │   { "name": "tuinnel-angular", "config_src": "cloudflare" }
│   │   ├── If 409: GET /accounts/{account_id}/cfd_tunnel?name=tuinnel-angular&is_deleted=false
│   │   ├── Extract tunnel UUID from result.id
│   │   └── Get token: GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/token → result (string)
│   │
│   ├── Step 2: Update ingress config (ALWAYS)
│   │   └── PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
│   │       { "config": {
│   │           "ingress": [
│   │             { "hostname": "angular.mysite.com",
│   │               "service": "http://localhost:4200",
│   │               "originRequest": {} },
│   │             { "service": "http_status:404" }
│   │           ]
│   │       }}
│   │
│   ├── Step 3: Create-or-verify DNS
│   │   ├── Check: GET /zones/{zone_id}/dns_records?type=CNAME&name=angular.mysite.com
│   │   ├── If not exists: POST /zones/{zone_id}/dns_records
│   │   │   { "type": "CNAME", "name": "angular.mysite.com",
│   │   │     "content": "{uuid}.cfargotunnel.com", "proxied": true, "ttl": 1 }
│   │   ├── If exists & content matches our UUID: success (no-op)
│   │   └── If exists & content differs: warn + ask to overwrite
│   │
│   ├── Step 4: Spawn connector
│   │   ├── Write PID to .pids.json (write-ahead)
│   │   ├── spawn('cloudflared', ['tunnel', '--no-autoupdate',
│   │   │     '--metrics', '127.0.0.1:0', '--loglevel', 'info',
│   │   │     '--protocol', 'quic', 'run', '--token', connectorToken])
│   │   └── Wait for first "Registered tunnel connection" event on stderr
│   │
│   └── Display: ✓ angular.mysite.com ← :4200  (1/3)
│
└── 3. Enter TUI (or --no-tui log output)
```

**Teardown sequence (`tuinnel down --clean`):**
```
For each tunnel:
├── SIGTERM cloudflared process (wait 5s, then SIGKILL)
├── DELETE /zones/{zone_id}/dns_records/{record_id}
├── DELETE /accounts/{account_id}/cfd_tunnel/{tunnel_id}/connections  (clean active connections)
└── DELETE /accounts/{account_id}/cfd_tunnel/{tunnel_id}  (or ?cascade=true)
```

**Quick tunnel command:** `cloudflared tunnel --url http://localhost:<PORT>`
- No API token needed
- URL reported on stderr in a box: `https://<word>-<word>-<word>-<word>.trycloudflare.com`
- Parse with regex: `/https:\/\/[a-z-]+\.trycloudflare\.com/`

## Appendix F: Clipboard Implementation

```typescript
// src/utils/clipboard.ts
import { execSync } from 'child_process';
import { platform } from 'os';

let clipboardAvailable: boolean | null = null;

function detectClipboard(): { available: boolean; command: string | null } {
  if (platform() === 'darwin') {
    return { available: true, command: 'pbcopy' };
  }
  // Linux: try xclip, then xsel
  try {
    execSync('which xclip', { stdio: 'ignore' });
    return { available: true, command: 'xclip -selection clipboard' };
  } catch {}
  try {
    execSync('which xsel', { stdio: 'ignore' });
    return { available: true, command: 'xsel --clipboard --input' };
  } catch {}
  return { available: false, command: null };
}

export function isClipboardAvailable(): boolean {
  if (clipboardAvailable === null) {
    clipboardAvailable = detectClipboard().available;
  }
  return clipboardAvailable;
}

export function copyToClipboard(text: string): boolean {
  const { available, command } = detectClipboard();
  if (!available || !command) return false;
  try {
    execSync(command, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}
```

## Appendix G: cloudflared Binary Downloads (Validated)

### Download URL Pattern

**Latest release:**
```
https://github.com/cloudflare/cloudflared/releases/latest/download/<ASSET_NAME>
```

**Specific version:**
```
https://github.com/cloudflare/cloudflared/releases/download/<VERSION>/<ASSET_NAME>
```

### Platform Asset Map

| Platform | Asset Name | Notes |
|----------|-----------|-------|
| macOS ARM64 (Apple Silicon) | `cloudflared-darwin-arm64.tgz` | **Archive** — must extract binary |
| macOS AMD64 | `cloudflared-darwin-amd64.tgz` | **Archive** — must extract binary |
| Linux AMD64 | `cloudflared-linux-amd64` | Bare binary |
| Linux ARM64 | `cloudflared-linux-arm64` | Bare binary |

**IMPORTANT:** macOS downloads are `.tgz` archives, not bare binaries. Must `tar -xzf` to extract the `cloudflared` binary.

### SHA256 Checksums

**No separate `SHA256SUMS` file exists** ([Issue #1410](https://github.com/cloudflare/cloudflared/issues/1410) open). Checksums are embedded in the GitHub release notes body text:

```
cloudflared-darwin-arm64.tgz: <64-char-hex-hash>
cloudflared-linux-amd64: <64-char-hex-hash>
```

To fetch programmatically:
```bash
gh api repos/cloudflare/cloudflared/releases/latest --jq '.body'
```

Parse the body text to extract checksum for the target asset.

### Version Check

```bash
cloudflared --version
# Output: cloudflared version 2025.8.0 (built 2025-08-06-1234 UTC)

cloudflared version --short
# Output: 2025.8.0
```

### Binary Manager Implementation

```typescript
// src/cloudflared/binary.ts
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const ASSET_MAP: Record<string, string> = {
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
  'linux-arm64': 'cloudflared-linux-arm64',
  'linux-x64': 'cloudflared-linux-amd64',
};

function getAssetName(): string {
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSET_MAP[key];
  if (!asset) throw new Error(`Unsupported platform: ${key}`);
  return asset;
}

function isTarball(asset: string): boolean {
  return asset.endsWith('.tgz');
}
```

## Appendix H: Commander.js Entry Point (Validated Skeleton)

```typescript
#!/usr/bin/env node
// src/index.ts

import { Command } from 'commander';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('tuinnel')
  .description('Cloudflare Tunnel manager')
  .version(VERSION, '-v, --version')
  .configureHelp({ showGlobalOptions: true })
  .helpCommand(false);

// Global options
program.option('--verbose', 'Enable verbose output');

// Bare command: custom help
program.action((_options, command) => {
  showCustomHelp();
});

// tuinnel init
program
  .command('init')
  .description('Set up Cloudflare account')
  .action(async () => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand();
  });

// tuinnel up [ports...]
program
  .command('up')
  .description('Start tunnels (TUI dashboard)')
  .argument('[ports...]', 'Ports to tunnel')
  .option('-q, --quick', 'Quick tunnel (no account needed)')
  .option('--no-tui', 'Plain log output instead of TUI')
  .alias('start')
  .action(async (ports: string[], options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { upCommand } = await import('./commands/up.js');
    await upCommand(ports, { ...options, ...globalOpts });
  });

// tuinnel down [names...]
program
  .command('down')
  .description('Stop tunnels')
  .argument('[names...]', 'Tunnel names to stop')
  .option('-c, --clean', 'Delete tunnel and DNS records')
  .option('-a, --all', 'Stop all running tunnels')
  .alias('stop')
  .action(async (names: string[], options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { downCommand } = await import('./commands/down.js');
    await downCommand(names, { ...options, ...globalOpts });
  });

// tuinnel add <port>
program
  .command('add')
  .description('Add tunnel config (does NOT start tunnel)')
  .argument('<port>', 'Local port to tunnel')
  .option('--adopt', 'Adopt existing Cloudflare tunnel')
  .action(async (port: string, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { addCommand } = await import('./commands/add.js');
    await addCommand(port, { ...options, ...globalOpts });
  });

// tuinnel remove <name>
program
  .command('remove')
  .description('Remove tunnel from config')
  .argument('<name>', 'Tunnel name')
  .alias('rm')
  .action(async (name: string, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { removeCommand } = await import('./commands/remove.js');
    await removeCommand(name, { ...options, ...globalOpts });
  });

// tuinnel list
program
  .command('list')
  .description('List configured tunnels')
  .option('--json', 'Output as JSON')
  .alias('ls')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { listCommand } = await import('./commands/list.js');
    await listCommand({ ...options, ...globalOpts });
  });

// tuinnel status
program
  .command('status')
  .description('Check running tunnel status')
  .option('--json', 'Output as JSON')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { statusCommand } = await import('./commands/status.js');
    await statusCommand({ ...options, ...globalOpts });
  });

// tuinnel zones
program
  .command('zones')
  .description('List Cloudflare zones')
  .option('--json', 'Output as JSON')
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const { zonesCommand } = await import('./commands/zones.js');
    await zonesCommand({ ...options, ...globalOpts });
  });

// tuinnel doctor
program
  .command('doctor')
  .description('Run diagnostics')
  .action(async () => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand();
  });

// tuinnel purge
program
  .command('purge')
  .description('Clean orphaned Cloudflare resources')
  .action(async () => {
    const { purgeCommand } = await import('./commands/purge.js');
    await purgeCommand();
  });

function showCustomHelp(): void {
  // Check if config exists to show appropriate help
  // (implementation reads from config store)
  console.log(`
  tuinnel v${VERSION} — Cloudflare Tunnel manager

  Quick start (no account needed):
    tuinnel up 3000              Start a quick tunnel on port 3000

  Custom domains:
    tuinnel init                 Set up your Cloudflare account

  Learn more:
    tuinnel --help               Show all commands
`);
}

// MUST use parseAsync for async action handlers
await program.parseAsync(process.argv);
```

**Key design patterns:**
- Dynamic `await import()` per command → fast startup (only load code for invoked command)
- `--no-tui` is a Commander negatable boolean: creates `options.tui` that defaults to `true`, set to `false` when `--no-tui` passed
- `--json` is per-command (not global) so `tuinnel up --json` doesn't silently succeed
- `.alias()` goes before `.action()` — only first alias shows in help
- Top-level `await` requires `"type": "module"` in package.json

## Appendix I: CF API Zod Schemas (Implementation-Ready)

```typescript
// src/cloudflare/types.ts
import { z } from 'zod';

// ── Standard CF API envelope ──────────────────────────────────

const CFErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

const CFResultInfoSchema = z.object({
  page: z.number(),
  per_page: z.number(),
  count: z.number(),
  total_count: z.number(),
  total_pages: z.number(),
});

export function cfResponseSchema<T extends z.ZodType>(resultSchema: T) {
  return z.object({
    success: z.boolean(),
    errors: z.array(CFErrorSchema),
    messages: z.array(CFErrorSchema),
    result: resultSchema,
    result_info: CFResultInfoSchema.optional(),
  });
}

// ── Zone ──────────────────────────────────────────────────────

export const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'pending', 'initializing', 'moved']),
  account: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export type Zone = z.infer<typeof ZoneSchema>;

// ── Tunnel ────────────────────────────────────────────────────

export const TunnelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['inactive', 'healthy', 'down', 'degraded']),
  created_at: z.string(),
  deleted_at: z.string().nullable().optional(),
  connections: z.array(z.object({
    colo_name: z.string(),
    uuid: z.string(),
    is_pending_reconnect: z.boolean(),
    opened_at: z.string(),
    origin_ip: z.string(),
    client_id: z.string().optional(),
    client_version: z.string().optional(),
  })).optional(),
  token: z.string().optional(),
});

export type Tunnel = z.infer<typeof TunnelSchema>;

// ── DNS Record ────────────────────────────────────────────────

export const DNSRecordSchema = z.object({
  id: z.string(),
  zone_id: z.string(),
  zone_name: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  proxied: z.boolean(),
  ttl: z.number(),
  created_on: z.string(),
  modified_on: z.string(),
});

export type DNSRecord = z.infer<typeof DNSRecordSchema>;

// ── Tunnel Configuration (Ingress) ───────────────────────────

export const IngressRuleSchema = z.object({
  hostname: z.string().optional(),  // Omitted only for catch-all
  path: z.string().optional(),
  service: z.string(),              // e.g., "http://localhost:4200" or "http_status:404"
  originRequest: z.record(z.unknown()).optional(),
});

export const TunnelConfigurationSchema = z.object({
  config: z.object({
    ingress: z.array(IngressRuleSchema),
    originRequest: z.record(z.unknown()).optional(),
    'warp-routing': z.object({ enabled: z.boolean() }).optional(),
  }),
});

export type TunnelConfiguration = z.infer<typeof TunnelConfigurationSchema>;
```

## Appendix J: cloudflared Log Parser (Implementation-Ready)

```typescript
// src/cloudflared/log-parser.ts

import type { ConnectionEvent } from '../types.js';

/** Regex patterns for parsing cloudflared stderr */
const PATTERNS = {
  // General log line: 2024-02-08T06:25:48Z INF Some message key=value key2=value2
  logLine: /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+(DBG|INF|WRN|ERR|FTL)\s+(.+)$/,

  // Registered tunnel connection connIndex=0 connection=<uuid> event=0 ip=<ip> location=<loc> protocol=<proto>
  registration: /Registered tunnel connection\s+connIndex=(\d+)\s+connection=(\S+)\s+event=\d+\s+ip=(\S+)\s+location=(\S+)\s+protocol=(\S+)/,

  // Starting metrics server on 127.0.0.1:20241/metrics
  metricsServer: /Starting metrics server on ([\d.]+:\d+)\/metrics/,

  // Quick tunnel URL: https://word-word-word-word.trycloudflare.com
  quickTunnelUrl: /(https:\/\/[a-z]+-[a-z]+-[a-z]+-[a-z]+\.trycloudflare\.com)/,

  // Version line: Version 2025.8.0 (Checksum <hash>)
  version: /Version\s+(\S+)/,

  // Generated Connector ID: <uuid>
  connectorId: /Generated Connector ID:\s+(\S+)/,
};

export interface ParsedLogLine {
  timestamp: Date;
  level: ConnectionEvent['level'];
  message: string;
  fields: Record<string, string>;
}

export function parseLogLine(line: string): ParsedLogLine | null {
  const match = line.match(PATTERNS.logLine);
  if (!match) return null;

  const [, timestamp, level, rest] = match;

  // Extract key=value fields from the rest of the line
  const fields: Record<string, string> = {};
  const fieldRegex = /(\w+)=(\S+)/g;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(rest)) !== null) {
    fields[fieldMatch[1]] = fieldMatch[2];
  }

  // Message is everything before the first key=value
  const message = rest.replace(/\s+\w+=\S+/g, '').trim();

  return {
    timestamp: new Date(timestamp),
    level: level as ConnectionEvent['level'],
    message,
    fields,
  };
}

export function extractMetricsAddr(line: string): string | null {
  const match = line.match(PATTERNS.metricsServer);
  return match ? match[1] : null;
}

export function extractRegistration(line: string): Partial<ConnectionEvent> | null {
  const match = line.match(PATTERNS.registration);
  if (!match) return null;
  return {
    connIndex: parseInt(match[1], 10),
    connectionId: match[2],
    edgeIp: match[3],
    location: match[4],
    protocol: match[5],
  };
}

export function extractQuickTunnelUrl(line: string): string | null {
  const match = line.match(PATTERNS.quickTunnelUrl);
  return match ? match[1] : null;
}
```

## Appendix K: Prometheus Metrics Reference (Validated from cloudflared source)

### Available Metrics at `http://127.0.0.1:<PORT>/metrics`

#### Request/Response (from `proxy/metrics.go`)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `cloudflared_tunnel_total_requests` | Counter | — | Total requests proxied |
| `cloudflared_tunnel_request_errors` | Counter | — | Errors proxying to origin |
| `cloudflared_tunnel_response_by_code` | CounterVec | `status_code` | Responses by HTTP status |
| `cloudflared_tunnel_concurrent_requests_per_tunnel` | Gauge | — | Active concurrent requests |

#### Connections (from `connection/metrics.go`)
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `cloudflared_tunnel_ha_connections` | Gauge | — | Active HA connections (max 4) |
| `cloudflared_tunnel_active_streams` | Gauge | — | Total active streams |
| `cloudflared_tunnel_server_locations` | GaugeVec | `connection_id`, `edge_location` | Datacenter per connection |
| `cloudflared_tunnel_tunnel_register_success` | CounterVec | `rpcName` | Successful registrations |
| `cloudflared_tunnel_tunnel_register_fail` | CounterVec | `error`, `rpcName` | Failed registrations |

#### Latency (from `proxy/metrics.go`)
| Metric | Type | Buckets (ms) | Description |
|--------|------|-------------|-------------|
| `cloudflared_proxy_connect_latency` | Histogram | 1, 10, 25, 50, 100, 500, 1000, 5000 | Origin connection time |

#### QUIC (from `quic/metrics.go`)
| Metric | Type | Description |
|--------|------|-------------|
| `quic_client_latest_rtt` | Gauge | Latest RTT in ms |
| `quic_client_smoothed_rtt` | Gauge | Smoothed RTT in ms |
| `quic_client_min_rtt` | Gauge | Minimum RTT in ms |

**NOT available:** Bandwidth/bytes transferred, per-request latency, individual request logs.

### Scraping Implementation Sketch

```typescript
// src/tui/hooks/useMetrics.ts
async function scrapeMetrics(addr: string): Promise<RawMetrics> {
  const res = await fetch(`http://${addr}/metrics`);
  const text = await res.text();
  return parsePrometheusText(text);
}

function parsePrometheusText(text: string): RawMetrics {
  const metrics: RawMetrics = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    // Format: metric_name{label="value"} 42.0
    // or:     metric_name 42.0
    const match = line.match(/^(\S+?)(\{[^}]*\})?\s+(\S+)$/);
    if (match) {
      const [, name, labels, value] = match;
      metrics[name] = metrics[name] || [];
      metrics[name].push({ labels: labels || '', value: parseFloat(value) });
    }
  }
  return metrics;
}
```
