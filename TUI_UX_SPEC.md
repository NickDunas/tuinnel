# TUI UX Improvement Spec

> Generated from in-depth interview — Feb 15, 2026

---

## 1. Vision

Transform tuinnel from a CLI-with-dashboard into a **TUI-first** tunnel management tool. Running `tuinnel` (no arguments) opens a full interactive dashboard where users can add, edit, delete, start, and stop tunnels — all without leaving the TUI. CLI subcommands remain available for scripting and CI.

---

## 2. Entry Points

### 2.1 Primary: `tuinnel` (no args)
Opens the TUI dashboard. Shows all persisted tunnels from `~/.tuinnel/config.json`. Tunnels that were running when the user last quit auto-start; stopped tunnels remain stopped.

### 2.2 Shorthand: `tuinnel <port>`
If the sole argument is a number, treat it as a port. Opens TUI and immediately creates + starts a tunnel on that port using default zone and auto-generated subdomain.

### 2.3 Existing: `tuinnel up [ports...]`
Remains as-is for backwards compatibility. Opens TUI with specified tunnels.

### 2.4 CLI subcommands
`tuinnel add`, `tuinnel remove`, `tuinnel list`, `tuinnel down`, `tuinnel init`, etc. remain for scripting/CI use. They share the same service layer as the TUI.

---

## 3. Architecture: Shared Service Layer

### 3.1 TunnelService
Refactor tunnel CRUD operations into a `TunnelService` class (or module). Both TUI components and CLI command handlers call the same service methods:

```
TunnelService
  ├─ create(config)      → creates CF tunnel + DNS + spawns cloudflared
  ├─ update(name, changes) → edits config, recreates if subdomain/zone changed
  ├─ delete(name)        → stops process + removes CF tunnel + DNS + config
  ├─ start(name)         → spawns cloudflared for existing tunnel
  ├─ stop(name)          → SIGTERM → SIGKILL cloudflared process
  ├─ restart(name)       → stop + start
  ├─ getAll()            → returns all tunnel configs + runtime state
  └─ onStateChange(cb)   → event emitter for state transitions
```

### 3.2 State Management
- `TunnelService` emits events on state changes (creating → connecting → connected → error, etc.)
- TUI subscribes to these events and dispatches `UPDATE_TUNNEL` actions to the React reducer
- This fixes the current bug where tunnels are stuck in 'connecting' forever

### 3.3 Persistence
- Tunnel configurations persist in `~/.tuinnel/config.json`
- Last-known state (`running` / `stopped`) persisted per tunnel
- On TUI open: tunnels with `lastState: "running"` auto-start; others show as stopped

---

## 4. TUI Layout

### 4.1 Overall Structure

```
┌─────────────────┬──────────────────────────────────────┐
│  TUNNELS        │  [1:Details] [2:Logs] [3:Metrics]    │
│  ◉ app :3000    │                                      │
│  ◌ api :8080    │  (Tab content based on selection)     │
│  ◔ web :5000    │                                      │
│                 │                                      │
│  ↑↓ more        │                                      │
│                 │                                      │
└─────────────────┴──────────────────────────────────────┘
 a Add  d Delete  e Edit  s Start/Stop  r Restart  ? Help
```

### 4.2 Sidebar (Left Panel, 24 cols)
- Scrollable tunnel list with arrow key navigation
- Scroll indicators (↑↓) shown when content overflows terminal height
- Status symbols (same as current): ◉ UP, ◌ DOWN, ◔ CONNECTING, ⚠ PORT_DOWN, ✗ ERROR, - STOPPED
- **Status dot animation**: dot pulses/blinks when tunnel has active connections (detected via metrics polling)
- Selected tunnel highlighted with inverse colors
- Border: cyan when focused, gray when not

### 4.3 Main Panel (Right, remaining width)
**Visual tab bar** at top of panel:
- `[1:Details]  [2:Logs]  [3:Metrics]`
- Active tab: bold + underlined or inverse
- Switch tabs with `1`, `2`, `3` keys

**Tab 1: Details**
- Tunnel name, subdomain.zone ← :port
- Status indicator + state label + uptime (HH:MM:SS)
- Local URL, Public URL
- Tunnel ID (dimmed)
- Last error (red, if any)

**Tab 2: Logs**
- Full-height connection event log (uses all available vertical space)
- Color-coded by level (green INF, yellow WRN, red ERR)
- Scrollable with arrow keys when focused
- Filter support (existing `/` keybinding)

**Tab 3: Metrics**
- Prometheus metrics display (existing component)
- Total requests, errors, concurrent requests
- Response code distribution
- Latency percentiles
- HA connections + scrape age

### 4.4 Help Bar (Bottom)
- **Context-sensitive**: shows relevant shortcuts for current state
- Sidebar focused: `↑↓ Navigate  a Add  d Delete  e Edit  s Start/Stop  r Restart  Tab Focus  q Quit`
- Logs focused: `↑↓ Scroll  / Filter  Esc Clear  Tab Focus  q Quit`
- Modal open: `↑↓ Navigate  Tab Next  Enter Confirm  Esc Cancel`
- Updates dynamically as user navigates

---

## 5. Empty State

When no tunnels are configured:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│           No tunnels configured yet.             │
│                                                  │
│         Press  a  to add your first tunnel.      │
│                                                  │
└──────────────────────────────────────────────────┘
 a Add  q Quit
```

Clean, minimal, single call-to-action.

---

## 6. Inline Onboarding (First-Time Setup)

If no API token or zone is configured when the TUI opens, show a setup wizard modal:

### Step 1: API Token
```
┌─── Setup ─────────────────────────────────┐
│                                           │
│  Welcome to tuinnel!                      │
│                                           │
│  Paste your Cloudflare API Token:         │
│  ┌───────────────────────────────────┐    │
│  │ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  │    │
│  └───────────────────────────────────┘    │
│  ⚠ Token visible — ensure no one is      │
│    watching your screen                   │
│                                           │
│  Create a token at:                       │
│  dash.cloudflare.com/profile/api-tokens   │
│                                           │
│            [Enter to continue]            │
└───────────────────────────────────────────┘
```

### Step 2: Zone Selection
```
┌─── Setup ─────────────────────────────────┐
│                                           │
│  Select your default zone:                │
│                                           │
│  > example.com                            │
│    mysite.org                             │
│    another-domain.net                     │
│                                           │
│  ↑↓ Navigate   Enter Select              │
└───────────────────────────────────────────┘
```

- Zones fetched from CF API (shows spinner while loading)
- Static list, arrow keys to navigate, Enter to select
- Token validated before proceeding to zone step (show error if invalid)

---

## 7. CRUD Operations

### 7.1 Add Tunnel (Guided Wizard Modal)

Triggered by pressing `a` from anywhere in the dashboard.

**Step 1: Port**
```
┌─── Add Tunnel ────────────────────────────┐
│                                           │
│  Step 1/3: Local Port                     │
│                                           │
│  Port: ┌──────┐                           │
│        │ 3000 │                           │
│        └──────┘                           │
│                                           │
│          [Enter to continue]  [Esc cancel]│
└───────────────────────────────────────────┘
```

- Numeric input only
- Validation: 1-65535, warn if port appears in use

**Step 2: Subdomain**
```
┌─── Add Tunnel ────────────────────────────┐
│                                           │
│  Step 2/3: Subdomain                      │
│                                           │
│  Subdomain: ┌──────────────────┐          │
│             │ my-app           │          │
│             └──────────────────┘          │
│  .example.com                             │
│                                           │
│  Suggestion: app-3000                     │
│                                           │
│          [Enter to continue]  [Esc cancel]│
└───────────────────────────────────────────┘
```

- Text input with auto-suggestion based on port
- Zone shown as suffix (from default zone)
- Validation: alphanumeric + hyphens, no leading/trailing hyphens

**Step 3: Zone (if multiple zones available)**
```
┌─── Add Tunnel ────────────────────────────┐
│                                           │
│  Step 3/3: Zone                           │
│                                           │
│  > example.com (default)                  │
│    mysite.org                             │
│    another-domain.net                     │
│                                           │
│  ↑↓ Navigate   Enter Select   Esc cancel │
└───────────────────────────────────────────┘
```

- Static list fetched from CF API
- Default zone pre-selected
- **Skipped entirely** if account has only one zone

**After confirmation**: Tunnel is immediately created (CF API call + DNS + cloudflared spawn). Tunnel appears in sidebar with ◔ (connecting) state, transitions to ◉ (connected) when ready.

### 7.2 Edit Tunnel (Modal)

Triggered by pressing `e` with a tunnel selected.

```
┌─── Edit: my-app ──────────────────────────┐
│                                           │
│  Port:      ┌──────┐                      │
│             │ 3000 │                       │
│             └──────┘                      │
│  Subdomain: ┌──────────────────┐          │
│             │ my-app           │          │
│             └──────────────────┘          │
│  Zone:      example.com  [Enter to change]│
│                                           │
│       [Enter Save]  [Esc Cancel]          │
└───────────────────────────────────────────┘
```

- All fields pre-filled with current values
- Uses @inkjs/ui TextInput for port and subdomain, Select for zone
- **Any field can be changed**
- If subdomain or zone changes: tunnel is silently torn down and recreated (non-blocking, see 7.5)
- If only port changes: config updated, cloudflared restarted with new origin

### 7.3 Delete Tunnel (Confirm Modal)

Triggered by pressing `d` with a tunnel selected.

```
┌─── Delete Tunnel ─────────────────────────┐
│                                           │
│  Delete "my-app"?                         │
│                                           │
│  This will permanently remove:            │
│    • Cloudflare tunnel resource            │
│    • DNS record (my-app.example.com)       │
│    • Local configuration                   │
│                                           │
│  This action cannot be undone.            │
│                                           │
│         [ Y Confirm ]  [ n Cancel ]       │
└───────────────────────────────────────────┘
```

- **Full cleanup**: removes CF tunnel + DNS CNAME + local config
- `Y` or `Enter` confirms, `n` or `Esc` cancels
- After deletion: tunnel removed from sidebar, next tunnel auto-selected

### 7.4 Start/Stop Toggle

Triggered by pressing `s` with a tunnel selected.

- If tunnel is stopped → starts it (creates CF resources if needed, spawns cloudflared)
- If tunnel is running → stops it (SIGTERM, waits 5s, SIGKILL if needed)
- State transitions shown in real-time via sidebar status dot
- No confirmation needed for start/stop (easily reversible)

### 7.5 Async Operations (Non-Blocking)

All tunnel operations (add, edit, delete, start, stop, restart) are **non-blocking**:

- The affected tunnel shows its transitional state in the sidebar (◔ creating, ◔ connecting, etc.)
- User can freely navigate to other tunnels, open modals, or perform other operations
- Multiple tunnels can be in transitional states simultaneously
- Errors are shown inline on the affected tunnel (red status + error text in Details tab)

---

## 8. Keyboard Shortcuts (Vim-Style)

### Global (always available)
| Key | Action |
|-----|--------|
| `q` | Quit (confirm: "Stop all tunnels and exit? Y/n") |
| `a` | Add new tunnel (opens wizard modal) |
| `?` | Full help overlay (categorized, dismissible with Esc) |
| `Tab` | Switch focus: sidebar ↔ main panel |
| `1` `2` `3` | Switch main panel tab (Details / Logs / Metrics) |

### Sidebar Focused
| Key | Action |
|-----|--------|
| `↑` `↓` `k` `j` | Navigate tunnel list |
| `e` | Edit selected tunnel |
| `d` | Delete selected tunnel (with confirmation) |
| `s` | Start/stop selected tunnel |
| `r` | Restart selected tunnel |
| `c` | Copy public URL to clipboard |
| `o` | Open public URL in browser |

### Logs Tab Focused
| Key | Action |
|-----|--------|
| `↑` `↓` | Scroll log view |
| `/` | Filter logs |
| `Esc` | Clear filter |

### Modal Active
| Key | Action |
|-----|--------|
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `Enter` | Confirm / Submit |
| `Esc` | Cancel / Close modal |
| `↑` `↓` | Navigate select lists |

---

## 9. Error Handling

### Display Strategy: Inline Status
- Errors shown as **red status text** on the affected tunnel in the sidebar
- Detailed error message visible in the **Details tab** of the main panel
- No interrupting modals or toasts for operational errors
- Error state persists until the tunnel is restarted or the error is resolved

### Error Categories
| Category | Display | Example |
|----------|---------|---------|
| API error | Red status + message in Details | "API token expired" |
| DNS error | Red status + message | "CNAME conflict: record already exists" |
| Port conflict | Yellow ⚠ + message | "Port 3000 already in use" |
| Process crash | Red ✗ + stderr output | "cloudflared exited with code 1" |
| Network error | Red status + retry info | "Connection failed, retrying in 5s" |

---

## 10. Persistence Model

### Config File: `~/.tuinnel/config.json`

Extended schema to support persistence:

```typescript
{
  accountId: string,
  apiToken: string,           // encrypted or plaintext
  defaultZone: string,
  tunnels: {
    [name: string]: {
      port: number,
      subdomain: string,
      zone: string,
      protocol: "http" | "https",
      lastState: "running" | "stopped",  // NEW: persisted state
      tunnelId?: string,                 // NEW: CF tunnel UUID for reuse
    }
  }
}
```

### Behavior on TUI Open
1. Load config from `~/.tuinnel/config.json`
2. For each tunnel:
   - If `lastState === "running"` → auto-start (spawn cloudflared)
   - If `lastState === "stopped"` → show as stopped in sidebar
3. If no config exists → show empty state
4. If no API token → show onboarding wizard

### Behavior on TUI Quit
1. For each tunnel, persist `lastState` based on current state
2. Stop all running cloudflared processes (SIGTERM → 5s → SIGKILL)
3. Save config atomically (tmp + rename)

---

## 11. Component Design

### New Components Needed

| Component | Location | Purpose |
|-----------|----------|---------|
| `Modal.tsx` | `src/tui/Modal.tsx` | Reusable centered modal overlay with dimmed background |
| `AddWizard.tsx` | `src/tui/AddWizard.tsx` | Multi-step add tunnel wizard |
| `EditForm.tsx` | `src/tui/EditForm.tsx` | Edit tunnel form |
| `DeleteConfirm.tsx` | `src/tui/DeleteConfirm.tsx` | Delete confirmation dialog |
| `OnboardingWizard.tsx` | `src/tui/OnboardingWizard.tsx` | First-time setup (token + zone) |
| `TabBar.tsx` | `src/tui/TabBar.tsx` | Visual tab switcher for main panel |
| `EmptyState.tsx` | `src/tui/EmptyState.tsx` | No-tunnels-configured view |
| `ScrollableList.tsx` | `src/tui/ScrollableList.tsx` | Reusable scrollable list with indicators |

### Modified Components

| Component | Changes |
|-----------|---------|
| `App.tsx` | New modes (onboarding, empty), modal state, tab state, TunnelService integration |
| `Sidebar.tsx` | Scrollable list, status dot animation, vim keys (j/k) |
| `MainPanel.tsx` | Tab bar integration, full-height content per tab |
| `HelpBar.tsx` | Context-sensitive shortcuts for new modes (modal, tabs) |
| `LogView.tsx` | Full-height mode, scroll support |

### New Service

| Module | Location | Purpose |
|--------|----------|---------|
| `TunnelService` | `src/services/tunnel-service.ts` | Shared CRUD + lifecycle management |

---

## 12. Implementation Priority (End-to-End MVP)

### Phase 1: Foundation
1. **Create TunnelService** — Extract tunnel CRUD from existing command handlers into shared service layer with event emitter for state changes
2. **Fix state management** — Wire TunnelService events into App.tsx reducer so tunnels actually transition states (connecting → connected, etc.)
3. **Fix uptime tracking** — Increment uptime counter when tunnel is connected
4. **Wire hooks** — Connect `useCloudflaredLogs` and `useMetrics` to dispatch `UPDATE_TUNNEL`

### Phase 2: TUI Entry Point
5. **`tuinnel` command** — No-args opens TUI dashboard
6. **`tuinnel <port>` shorthand** — Detect numeric arg, quick-start tunnel
7. **Persistence** — Extend config schema with `lastState` and `tunnelId`, auto-start on open
8. **Empty state** — Show "Press a to add" when no tunnels configured

### Phase 3: Core CRUD
9. **Modal component** — Reusable centered overlay with dimmed background
10. **Add wizard** — 3-step guided modal (port → subdomain → zone) using @inkjs/ui components
11. **Delete with confirmation** — Modal confirmation, full CF cleanup
12. **Start/stop toggle** — `s` key, non-blocking state transitions
13. **Edit form** — Pre-filled modal, auto-recreate on subdomain/zone change
14. **Restart** — `r` key, stop + start

### Phase 4: UI Polish
15. **Tab bar** — Visual `[1:Details] [2:Logs] [3:Metrics]` in main panel
16. **Scrollable sidebar** — Overflow handling with scroll indicators
17. **Status dot animation** — Pulsing dot for tunnels with active connections
18. **Context-sensitive help bar** — Dynamic shortcuts per mode
19. **Inline onboarding wizard** — Token input + zone selection for first-time users
20. **Vim keys (j/k)** — Additional navigation keys in sidebar

---

## 13. Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Entry point | TUI-first (`tuinnel` opens dashboard) | Primary use case is interactive management |
| Add flow | Guided wizard modal | Balances discoverability with speed |
| Lifecycle | Auto-start on add | Reduces friction, immediate feedback |
| Edit scope | Edit anything, auto-recreate | Simplicity over safety guards |
| Delete cleanup | Full cleanup always | Clean slate, no orphaned resources |
| Form placement | Modal overlay | Dashboard stays visible for context |
| First run | Inline onboarding in TUI | No separate CLI step needed |
| Empty state | Quick-action prompt | Minimal, gets out of the way |
| Bulk ops | Per-tunnel only | Keeps UI simple |
| Keybindings | Vim-style single-letter | Fast, discoverable via help bar |
| Help | Context-sensitive bottom bar | Always visible, always relevant |
| Errors | Inline status on tunnel | No workflow interruption |
| Inputs | @inkjs/ui components | Already a dependency, proven with Ink v6 |
| Zone picker | Static list | Simple, predictable |
| Persistence | Full (config + last state) | TUI-first needs to remember tunnels |
| Auto-start | Remember last state | Respects user's previous session intent |
| Delete confirm | Modal with Y/n | Prevents accidental destruction |
| Logs/metrics view | Tab-based (1/2/3) | Full height per view, clean separation |
| Tab UI | Visual tab bar | Clear visual state indicator |
| Token input | Visible with warning | Easier to verify correct paste |
| Theming | Fixed (current scheme) | Consistent, no config overhead |
| Async ops | Non-blocking | User can multitask during operations |
| Quick start | `tuinnel <port>` shorthand | Fast for common use case |
| Architecture | Shared service layer | Clean separation, reusable across TUI + CLI |
| Sidebar overflow | Scrollable list | Standard, handles any tunnel count |
| Activity indicator | Status dot animation | Subtle liveness indicator |
| Implementation | End-to-end MVP first | Thin vertical slice that works completely |

---

## 14. Out of Scope (Future)

- Color theming / customization
- Bulk operations (start all / stop all)
- Log export / persistence
- Tunnel groups / tags
- Remote tunnel management (managing tunnels on other machines)
- Configuration import/export
- Mouse support
