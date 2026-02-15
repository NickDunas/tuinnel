# tuinnel

A TUI-first tool for managing [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Expose your local dev servers to the internet with custom subdomains on your own domains — add, edit, delete, start, and stop tunnels all from an interactive dashboard.

```
$ tuinnel

┌─────────────────┬──────────────────────────────────────┐
│  TUNNELS        │  [1:Details] [2:Logs] [3:Metrics]    │
│  ◉ app :3000    │                                      │
│  ◌ api :8080    │  Status: ◉ Connected  Uptime: 00:12  │
│                 │  Public: https://app.mysite.com      │
└─────────────────┴──────────────────────────────────────┘
 a Add  d Delete  e Edit  s Start/Stop  r Restart  ? Help
```

## Features

- **TUI dashboard** — Full interactive dashboard; add, edit, delete tunnels without leaving the terminal
- **Custom domains** — Map local ports to subdomains on domains you own (`app.mysite.com`, `api.mysite.com`)
- **Quick tunnels** — Zero-config tunnels via `trycloudflare.com` (no account needed)
- **Persistent state** — Tunnels auto-restart between sessions based on last known state
- **Inline onboarding** — Setup wizard on first run, no separate CLI step needed
- **Multi-tunnel** — Run multiple tunnels simultaneously with a sidebar to switch between them
- **Smart defaults** — Auto-detects frameworks from `package.json` and suggests subdomain names (port 4200 = "angular", 5173 = "vite", etc.)
- **Managed binary** — Automatically downloads and manages the `cloudflared` binary
- **Auto-HTTPS detection** — Probes local ports to detect self-signed HTTPS and configures tunnels accordingly
- **Atomic config** — Config stored in `~/.tuinnel/config.json` with atomic writes and 0600 permissions
- **Diagnostics** — `tuinnel doctor` validates your token, permissions, binary, and network connectivity

## Requirements

- **Node.js 20+** (runtime)
- **macOS or Linux** (darwin-arm64, darwin-x64, linux-arm64, linux-x64)
- A **Cloudflare account** with at least one domain (for named tunnels; quick tunnels work without an account)

## Installation

```bash
npm install -g tuinnel
```

## Quick Start

```bash
# Open interactive dashboard (first run shows setup wizard)
tuinnel

# Quick start a tunnel on port 3000
tuinnel 3000
```

### Zero-config (no account needed)

Expose a local server with a random public URL:

```bash
tuinnel up 3000 --quick
# => https://random-words.trycloudflare.com <- :3000
```

### Custom domains (requires Cloudflare account)

```bash
# 1. Open tuinnel — the setup wizard runs automatically on first launch
tuinnel

# 2. Or set up via CLI (one-time)
tuinnel init

# 3. Start a tunnel via CLI
tuinnel up 3000
# => https://app.mysite.com <- :3000
```

## Creating a Cloudflare API Token

tuinnel requires a scoped API token (not a Global API Key) with specific permissions. Follow these steps to create one:

### Step 1: Open the Cloudflare Dashboard

Go to [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) and click **Create Token**.

### Step 2: Start from a blank template

Scroll past the pre-built templates and click **Create Custom Token** at the bottom of the page. Give it a descriptive name like `tuinnel` or `tunnel-manager`.

### Step 3: Configure permissions

Add these three permissions. All three are required:

| Permission | Access | Why it's needed |
|---|---|---|
| **Zone** > **Zone** > **Read** | Read | List your domains so tuinnel can discover zones and account IDs |
| **Zone** > **DNS** > **Edit** | Edit | Create and delete CNAME records that point subdomains to your tunnels |
| **Account** > **Cloudflare Tunnel** > **Edit** | Edit | Create, configure, and delete named tunnels |

Your permissions table should look like this:

```
+----------+-------------------+------+
| Zone     | Zone              | Read |
| Zone     | DNS               | Edit |
| Account  | Cloudflare Tunnel | Edit |
+----------+-------------------+------+
```

### Step 4: Set zone and account resources

Under **Zone Resources**, choose which zones (domains) the token can access:

- **All zones** — If you want tuinnel to work with any domain in your account
- **Specific zone** — If you want to restrict the token to a single domain (recommended for tighter security)

Under **Account Resources**, select the account that owns your zones.

### Step 5: (Optional) Restrict client IP addresses

For additional security, you can restrict the token to only work from your IP address or IP range under **Client IP Address Filtering**. This is optional but recommended for production use.

### Step 6: Set TTL (optional)

You can set a start and end date for the token. Leave blank for a non-expiring token.

### Step 7: Create and copy

Click **Continue to summary**, review the permissions, then click **Create Token**.

**Copy the token immediately.** Cloudflare will only show it once. If you lose it, you'll need to create a new one.

### Step 8: Configure tuinnel

Run tuinnel and the setup wizard will guide you through token configuration:

```bash
tuinnel
```

Or use the CLI setup command:

```bash
tuinnel init
```

When prompted, paste your token. tuinnel will:
1. Validate the token against the Cloudflare API
2. List your available zones (domains)
3. Let you pick a default zone
4. Save the config to `~/.tuinnel/config.json`

### Alternative: Environment variable

Instead of storing the token in the config file, you can set it as an environment variable:

```bash
export CLOUDFLARE_API_TOKEN="your-token-here"
```

Or use the tuinnel-specific variable:

```bash
export TUINNEL_API_TOKEN="your-token-here"
```

Environment variables take priority over the config file.

### Verifying your token

Run diagnostics to confirm everything is set up correctly:

```bash
tuinnel doctor
```

Expected output:

```
tuinnel doctor

  PASS  Config file
         Found at ~/.tuinnel/config.json
  PASS  API token
         Token found (config file, ending ...ab1c)
  PASS  Token validates
         Valid. Access to 2 zones
  PASS  cloudflared binary
         Version 2025.8.0 (managed)
  PASS  Network connectivity
         Cloudflare API reachable (HTTP 200)

All 5 checks passed.
```

### Common token issues

| Symptom | Cause | Fix |
|---|---|---|
| `Authentication failed` | Token is invalid, revoked, or expired | Create a new token at the [API tokens page](https://dash.cloudflare.com/profile/api-tokens) |
| `Insufficient permissions` | Token is missing one or more required permissions | Edit the token and add the missing permission (Zone:Read, DNS:Edit, or Cloudflare Tunnel:Edit) |
| `No zones found` | Token doesn't have access to any zones | Edit the token's Zone Resources to include your domain |
| `This looks like a Global API Key` | You pasted the 37-character Global API Key instead of a scoped token | Go to the [API tokens page](https://dash.cloudflare.com/profile/api-tokens) and create a new **API Token** (not the Global API Key shown at the top) |

## Commands

| Command | Description |
|---|---|
| `tuinnel` | Open interactive TUI dashboard |
| `tuinnel <port>` | Quick start: create tunnel and open dashboard |
| `tuinnel init` | Interactive setup wizard for API token and default zone |
| `tuinnel up [ports...]` | Start tunnels and open the TUI dashboard |
| `tuinnel up <port> --quick` | Start an ephemeral quick tunnel (no account needed) |
| `tuinnel up <port> --no-tui` | Start tunnels with plain log output instead of TUI |
| `tuinnel down [names...]` | Stop running tunnels |
| `tuinnel down --all` | Stop all running tunnels |
| `tuinnel down <name> --clean` | Stop a tunnel and delete its DNS record and tunnel from Cloudflare |
| `tuinnel add <port>` | Add a tunnel mapping to config (does not start it) |
| `tuinnel remove <name>` | Remove a tunnel mapping from config |
| `tuinnel list` | List all configured tunnels |
| `tuinnel status` | Show running tunnels with health status |
| `tuinnel zones` | List available Cloudflare zones (domains) |
| `tuinnel doctor` | Run diagnostics (token, permissions, binary, network) |
| `tuinnel purge` | Find and remove orphaned tunnels and DNS records |

### Global flags

| Flag | Description |
|---|---|
| `--verbose` | Enable verbose output |
| `--json` | Output in JSON format (for `list`, `status`, `zones`) |
| `--help` | Show help for any command |
| `--version` | Show version |

## TUI Keyboard Shortcuts

### Global

| Key | Action |
|---|---|
| `q` | Quit (confirm: "Stop all tunnels and exit? Y/n") |
| `a` | Add new tunnel (opens wizard modal) |
| `?` | Full help overlay (dismissible with any key) |
| `Tab` | Switch focus: sidebar / main panel |
| `1` `2` `3` | Switch main panel tab (Details / Logs / Metrics) |

### Sidebar Focused

| Key | Action |
|---|---|
| `Up` / `Down` / `k` / `j` | Navigate tunnel list |
| `e` | Edit selected tunnel |
| `d` | Delete selected tunnel (with confirmation) |
| `s` | Start/stop selected tunnel |
| `r` | Restart selected tunnel |
| `c` | Copy public URL to clipboard |
| `o` | Open public URL in browser |

### Logs Tab Focused

| Key | Action |
|---|---|
| `Up` / `Down` | Scroll log view |
| `/` | Filter logs |
| `Esc` | Clear filter |

### Modal Active

| Key | Action |
|---|---|
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `Enter` | Confirm / Submit |
| `Esc` | Cancel / Close modal |
| `Up` / `Down` | Navigate select lists |

## How It Works

tuinnel uses a hybrid approach:

1. **Cloudflare REST API** handles all CRUD operations — creating tunnels, managing DNS CNAME records, and configuring ingress rules
2. **cloudflared binary** runs as a connector process that maintains the actual tunnel connection to Cloudflare's edge network
3. **Prometheus metrics** are scraped from cloudflared's local metrics server for real-time dashboard stats (request counts, latency percentiles, connection health)

When you run `tuinnel 3000`:

1. Opens the TUI dashboard
2. Creates a named tunnel on Cloudflare (or reuses an existing one)
3. Configures the tunnel's ingress rules to route traffic to `localhost:3000`
4. Creates a DNS CNAME record pointing your subdomain to the tunnel
5. Spawns a `cloudflared` connector process
6. Shows live metrics and logs in the dashboard

Tunnels are named with a `tuinnel-` prefix on Cloudflare to avoid collisions with other tools.

## Config File

Stored at `~/.tuinnel/config.json`:

```jsonc
{
  "version": 1,
  "apiToken": "your-api-token",
  "defaultZone": "mysite.com",
  "tunnels": {
    "app": {
      "port": 3000,
      "subdomain": "app",
      "zone": "mysite.com",
      "protocol": "http",
      "lastState": "running",
      "tunnelId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    },
    "api": {
      "port": 8080,
      "subdomain": "api",
      "zone": "mysite.com",
      "protocol": "http",
      "lastState": "stopped"
    }
  }
}
```

The `lastState` field tracks whether each tunnel was running or stopped when you last exited. Tunnels with `lastState: "running"` auto-start when you open the dashboard. The `tunnelId` field caches the Cloudflare tunnel UUID for faster restarts.

The `cloudflared` binary is managed at `~/.tuinnel/bin/cloudflared`.

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Build in watch mode
bun run dev

# Type-check
bunx tsc --noEmit

# Run tests
bun test

# Run a single test file
bun test tests/cloudflare/api.test.ts

# Smoke test the built CLI
node dist/index.js --help
```

## License

MIT
