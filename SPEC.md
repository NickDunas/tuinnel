# tuinnel — Cloudflare Tunnel CLI Tool

## Specification Document

---

## 1. Overview

**tuinnel** is a TypeScript CLI tool that uses Cloudflare Tunnels to expose localhost ports to the web via subdomains on domains already in the user's Cloudflare account. It provides a TUI dashboard for monitoring multiple tunnels simultaneously with real-time access logs and live metrics.

**Target platforms:** macOS and Linux only.

---

## 2. Authentication & Setup

### Token Storage
- Single Cloudflare API token stored in `~/.tuinnel/config.json`.
- No multi-account/profile support.

### First Run Experience
- Running any `tuinnel` command without a configured token triggers an **interactive setup wizard**:
  1. Prompt user to paste their Cloudflare API token.
  2. Validate the token against the CF API.
  3. Run a permissions diagnostic (see Section 10).
  4. Let user select a default zone from available zones.
  5. Write config to `~/.tuinnel/config.json`.
- `tuinnel init` can re-run the wizard at any time to reconfigure.

### Config File Structure
```jsonc
// ~/.tuinnel/config.json
{
  "apiToken": "cf-api-token-here",
  "defaultZone": "mysite.com",  // optional, selected during init
  "tunnels": {
    "angular-dev": {
      "port": 4200,
      "subdomain": "angular",
      "zone": "mysite.com",
      "protocol": "http"  // or "https" if auto-detected
    },
    "vite-app": {
      "port": 3000,
      "subdomain": "vite",
      "zone": "mysite.com",
      "protocol": "http"
    }
  }
}
```

---

## 3. cloudflared Binary Management

tuinnel **fully manages** the `cloudflared` binary:

- On first use (or if binary is missing), auto-download the correct `cloudflared` binary for the current platform (macOS arm64/x64, Linux arm64/x64) to `~/.tuinnel/bin/cloudflared`.
- Check for updates on each run (non-blocking, background check). Notify user if a newer version is available.
- Use the managed binary by default. If a system-installed `cloudflared` exists on PATH, prefer the managed version for consistency.
- Store binary version metadata in `~/.tuinnel/bin/.version`.

---

## 4. Tunnel Management Architecture

### API + cloudflared Hybrid Approach
- **Cloudflare API** handles all CRUD operations:
  - Create/delete named tunnels
  - Create/delete DNS CNAME records
  - List zones, tunnels, and DNS records
  - Retrieve tunnel configuration
- **cloudflared binary** is used solely as the **tunnel runtime** (connector):
  - `cloudflared tunnel --no-autoupdate run --token <connector-token>`
  - tuinnel spawns and manages the cloudflared process

### Tunnel Types
- **Named tunnels** (primary): Full API-managed tunnels with custom subdomains. Requires API token.
- **Quick tunnels** (secondary): Ephemeral tunnels via trycloudflare.com. No DNS config, random subdomain. Activated via `--quick` flag on the `up` command.

---

## 5. CLI Command Structure

Verb-based command structure. All commands except `up` produce **stdout-friendly output** (tables, plain text) suitable for scripting and piping.

### Commands

| Command | Description |
|---------|-------------|
| `tuinnel init` | Interactive setup wizard. Configure API token and default zone. |
| `tuinnel add <port> [subdomain.zone.com]` | Add a new tunnel mapping to the config. Interactive zone picker if zone not specified. Smart subdomain suggestion if subdomain not specified. |
| `tuinnel remove <name\|port>` | Remove a tunnel mapping from the config. |
| `tuinnel list` | List all configured tunnel mappings with their status (active/inactive, health). |
| `tuinnel up [name\|port...]` | Start one or more tunnels. Opens TUI dashboard. If no arguments, starts all configured tunnels. |
| `tuinnel up <port> --quick` | Start an ephemeral quick tunnel (trycloudflare.com) for the given port. |
| `tuinnel down <name\|port> [--clean]` | Stop a tunnel. With `--clean`, also remove CF-side DNS records and tunnel config. Without `--clean`, only stop the local process (DNS records persist for fast restart). |
| `tuinnel doctor` | Diagnostic command. Checks API token permissions, cloudflared binary status, network connectivity, and reports any issues with remediation steps. |
| `tuinnel purge` | Find and remove orphaned tunnels and DNS records from previous sessions that weren't cleaned up (e.g., after a crash). |
| `tuinnel zones` | List all available zones (domains) on the CF account. |

### Flags (Global)

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help for any command. |
| `--version, -v` | Show tuinnel version. |
| `--json` | Output in JSON format (for scriptable commands). |

---

## 6. Adding Tunnels — `tuinnel add`

### Flow
1. User runs `tuinnel add 4200` (port only) or `tuinnel add 4200 angular.mysite.com` (full spec).
2. If subdomain not provided:
   - **Smart suggestion**: Check port against a known-ports map and suggest a name:
     - `4200` → "angular"
     - `3000` → "vite" or "react"
     - `8080` → "api"
     - `5173` → "vite"
     - `8000` → "django"
     - `5000` → "flask"
     - `3001` → "next"
     - `4000` → "graphql"
     - Unknown ports → "app-{port}"
   - Prompt user to accept or override the suggestion.
3. If zone not provided:
   - **Interactive picker**: Fetch zones from CF API, display a selectable list.
   - If a default zone is configured, pre-select it but allow override.
4. Validate that the subdomain doesn't already exist as a DNS record (unless it's a CNAME pointing to a tuinnel-managed tunnel).
5. Save to `~/.tuinnel/config.json`.

### Local HTTPS Auto-Detection
- When adding or starting a tunnel, probe the local port to determine if it responds to HTTPS.
- If the local service uses HTTPS (e.g., self-signed cert), configure the tunnel's origin as `https://localhost:<port>` with TLS verification disabled.
- If HTTP, use `http://localhost:<port>`.
- Store detected protocol in config for subsequent runs.

---

## 7. Starting Tunnels — `tuinnel up`

### Startup Sequence
1. Validate cloudflared binary exists (download if missing).
2. Validate API token (fail with guidance if invalid).
3. For each requested tunnel:
   a. Create the named tunnel via CF API (if not already created).
   b. Create the DNS CNAME record pointing `subdomain.zone` → tunnel UUID.cfargotunnel.com.
   c. Configure the tunnel's ingress rules via the API.
   d. Spawn cloudflared connector process.
4. **Fail-fast behavior**: If any tunnel fails during setup (API error, DNS conflict, etc.), abort all tunnels. Roll back any partially created resources. Display a clear error.
5. Once all tunnels are running, open the **TUI dashboard**.

### Quick Tunnel Mode (`--quick`)
- `tuinnel up 3000 --quick`
- Spawns `cloudflared tunnel --url http://localhost:3000` (uses trycloudflare.com).
- No API token required, no DNS management.
- Shows the random URL assigned by Cloudflare.
- Still opens TUI with logs/metrics for the quick tunnel.

---

## 8. Stopping Tunnels — `tuinnel down`

### Default Behavior (no flags)
- Send SIGTERM to the cloudflared process.
- Remove the tunnel configuration from CF API.
- **Keep DNS records** in place for fast restart.

### With `--clean` Flag
- Stop the cloudflared process.
- Delete the DNS CNAME record from CF.
- Delete the named tunnel from CF.
- Full cleanup — as if the tunnel was never created.

---

## 9. TUI Dashboard — `tuinnel up`

### Framework
- Built with **Ink** (React for CLI).

### Layout: Sidebar + Main Panel

```
┌──────────────────┬──────────────────────────────────────────────┐
│  TUNNELS         │  angular.mysite.com ← :4200                 │
│                  │                                               │
│  ● angular :4200 │  Status: ● Connected    Uptime: 00:12:34    │
│  ● vite    :3000 │  Local:  https://localhost:4200 (auto-TLS)  │
│  ○ api     :8080 │  URL:    https://angular.mysite.com          │
│                  │                                               │
│  ● = healthy     │  ── Metrics ──────────────────────────────── │
│  ○ = port down   │  Requests: 142    Errors: 2    Req/s: 3.2   │
│  ◌ = connecting  │  Bandwidth: 1.2 MB ↓  340 KB ↑              │
│                  │  Latency: p50=12ms  p95=89ms                 │
│                  │                                               │
│                  │  ── Access Log ────────────────────────────── │
│                  │  14:23:01 GET  /api/users     200  12ms      │
│                  │  14:23:01 GET  /assets/main.css 200  3ms     │
│                  │  14:23:02 POST /api/login     401  45ms      │
│                  │  14:22:58 GET  /favicon.ico   304  1ms       │
│                  │  Headers: Accept: application/json           │
│                  │           User-Agent: Mozilla/5.0...          │
│                  │           CF-Connecting-IP: 203.0.113.42     │
│                  │           CF-IPCountry: US                    │
└──────────────────┴──────────────────────────────────────────────┘
  ↑↓ Navigate   Space Toggle   c Copy URL   q Quit
```

### Sidebar
- Lists all tunnels with:
  - Name/alias
  - Local port
  - Health indicator:
    - `●` Green: tunnel connected AND local port is listening.
    - `○` Yellow/Red: tunnel connected BUT local port is not listening (502s will occur).
    - `◌` Gray: tunnel is connecting/starting.
- Selected tunnel is highlighted.

### Main Panel
Shows details for the selected tunnel:
- **Status bar**: Connection state, uptime, local URL, public URL.
- **Metrics section**: Live-updating stats:
  - Total request count, error count, requests/second.
  - Bandwidth (bytes transferred in/out).
  - Latency percentiles (p50, p95).
- **Access log section**: Scrollable, real-time request log:
  - Timestamp, HTTP method, path, status code, response time.
  - Request/response headers.
  - Client IP (CF-Connecting-IP).
  - Geo info (CF-IPCountry).
  - Bytes transferred.

### Health Monitoring
- Periodically (every 5 seconds) probe each local port to check if a service is listening.
- Update the health indicator in real-time.
- If a port goes down, change indicator to red/yellow but keep the tunnel running.
- If a port comes back up, change indicator back to green.

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate between tunnels in sidebar |
| `Space` | Toggle selected tunnel on/off |
| `c` | Copy public URL of selected tunnel to clipboard |
| `q` | Quit (stops all tunnels, prompts for cleanup) |
| `Ctrl+C` | Force quit |

### Logs
- **Real-time only**. Logs are not persisted to disk.
- Logs are sourced from cloudflared's output and/or CF API log endpoints.
- The log view in the TUI is a scrollable buffer (last N entries, e.g., 1000).

---

## 10. Diagnostic Command — `tuinnel doctor`

Runs a comprehensive health check and reports results:

1. **API Token**: Validate token is set, not expired, and has required permissions:
   - `Zone:Read` — list zones
   - `DNS:Edit` — create/delete CNAME records
   - `Tunnel:Edit` — create/delete/configure tunnels (Cloudflare Tunnel permission)
   - Report each permission as ✓ or ✗ with a link to the CF dashboard to fix.
2. **cloudflared binary**: Check if managed binary exists, is executable, and version is current.
3. **Network**: Test connectivity to CF API endpoints.
4. **Config**: Validate config file syntax, check for orphaned entries.

Output format:
```
tuinnel doctor

  API Token       ✓ Valid, expires 2025-12-01
  Zone:Read       ✓ Granted
  DNS:Edit        ✓ Granted
  Tunnel:Edit     ✗ Missing — add this permission at https://dash.cloudflare.com/...
  cloudflared     ✓ v2024.6.1 (latest)
  Network         ✓ Connected to api.cloudflare.com
  Config          ✓ Valid, 3 tunnels configured
```

---

## 11. Purge Command — `tuinnel purge`

For recovering from crashes or ungraceful shutdowns:

1. Fetch all named tunnels from CF API that were created by tuinnel (identified by a naming convention or metadata tag, e.g., tunnel name prefix `tuinnel-`).
2. Check which ones have no active connections (stale).
3. List stale tunnels and associated DNS records.
4. Prompt user to confirm deletion of each (or `--all` to purge everything).
5. Delete confirmed tunnels and their DNS records.

---

## 12. Zone Management — `tuinnel zones`

- Fetches and displays all zones on the CF account.
- Shows zone name, status (active/pending), and number of existing tuinnel subdomains.
- Standard table output (non-TUI).

---

## 13. Technology Stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript |
| Runtime | Bun |
| Package manager | Bun |
| TUI framework | Ink (React for CLI) |
| CLI framework | Commander.js or yargs (TBD based on Ink compatibility) |
| HTTP client | Native fetch (Bun built-in) |
| CF API interaction | Direct REST API calls (no SDK) |
| Tunnel runtime | cloudflared binary (managed) |
| Distribution | npm global install (`npm i -g tuinnel`) |

---

## 14. Project Structure

```
tuinnel/
├── src/
│   ├── index.ts                 # Entry point, CLI command routing
│   ├── commands/
│   │   ├── init.ts              # Setup wizard
│   │   ├── add.ts               # Add tunnel mapping
│   │   ├── remove.ts            # Remove tunnel mapping
│   │   ├── up.ts                # Start tunnels + TUI
│   │   ├── down.ts              # Stop tunnels
│   │   ├── list.ts              # List configured tunnels
│   │   ├── doctor.ts            # Diagnostic checks
│   │   ├── purge.ts             # Clean orphaned resources
│   │   └── zones.ts             # List CF zones
│   ├── tui/
│   │   ├── App.tsx              # Root Ink component
│   │   ├── Sidebar.tsx          # Tunnel list sidebar
│   │   ├── MainPanel.tsx        # Selected tunnel detail view
│   │   ├── Metrics.tsx          # Live metrics display
│   │   ├── LogView.tsx          # Access log stream
│   │   ├── StatusBar.tsx        # Bottom status/shortcut bar
│   │   └── hooks/
│   │       ├── useTunnelHealth.ts
│   │       ├── useMetrics.ts
│   │       └── useAccessLogs.ts
│   ├── cloudflare/
│   │   ├── api.ts               # CF API client (zones, DNS, tunnels)
│   │   ├── types.ts             # CF API response types
│   │   └── tunnel-manager.ts    # Tunnel lifecycle (create, start, stop, delete)
│   ├── cloudflared/
│   │   ├── binary.ts            # Download, version check, update logic
│   │   ├── process.ts           # Spawn and manage cloudflared processes
│   │   └── log-parser.ts        # Parse cloudflared stdout for logs/metrics
│   ├── config/
│   │   ├── store.ts             # Read/write ~/.tuinnel/config.json
│   │   ├── schema.ts            # Config validation (Zod)
│   │   └── port-map.ts          # Known port → framework name mappings
│   └── utils/
│       ├── port-probe.ts        # Check if local port is listening + HTTPS detection
│       ├── clipboard.ts         # Copy to clipboard (pbcopy/xclip)
│       └── logger.ts            # Console output formatting for non-TUI commands
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

---

## 15. Error Handling

### Fail-Fast on Multi-Tunnel Start
When starting multiple tunnels with `tuinnel up`:
- Execute tunnel setup **sequentially** (not parallel) to catch failures early.
- If any tunnel fails, roll back all previously created resources (DNS records, tunnel configs) from the current session.
- Display the specific error with remediation guidance.

### Common Error Scenarios

| Scenario | Behavior |
|----------|----------|
| Invalid API token | Clear error + link to CF dashboard to generate a new one |
| Insufficient permissions | List missing permissions + link to edit token |
| DNS record conflict | Show existing record details, suggest `--clean` or manual resolution |
| Port not listening | Start tunnel anyway, show yellow health indicator in TUI |
| cloudflared crash | Detect exit, show error in TUI, attempt automatic restart (1 retry) |
| Network loss | Show disconnected status, auto-reconnect when network returns (cloudflared handles this) |
| Zone not found | Show available zones, suggest correct one |

---

## 16. Out of Scope (v1)

The following are explicitly **not** included in the initial version:

- Windows support
- Cloudflare Access / Zero Trust policies
- TCP/UDP/SSH protocol tunneling (HTTP/HTTPS only)
- Log persistence to disk
- Configuration sharing / export / import
- Named tunnel groups / presets / tags
- Multi-account / profile switching
- Domain purchasing via CF Registrar
- Webhooks or notifications
- Custom cloudflared configuration flags passthrough

---

## 17. Future Considerations (v2+)

- Cloudflare Access integration for protected tunnels
- TCP tunnel support for databases/SSH
- Log persistence with rotation
- Project-local `.tuinnel` config files
- Configuration presets and groups
- Windows support
- Standalone binary distribution (bun compile)
