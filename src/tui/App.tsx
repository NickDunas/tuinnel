import React, { useReducer, useEffect } from 'react';
import { Box, Text, useInput, useStdin, useStdout, useApp } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { spawn as spawnChild } from 'child_process';
import { platform } from 'os';
import type { TunnelRuntime } from '../types.js';
import type { TunnelService } from '../services/tunnel-service.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { readConfig, writeConfig, getDefaultConfig, configExists } from '../config/store.js';
import { Sidebar } from './Sidebar.js';
import { MainPanel } from './MainPanel.js';
import { HelpBar } from './HelpBar.js';
import { EmptyState } from './EmptyState.js';
import { AddWizard } from './AddWizard.js';
import { DeleteConfirm } from './DeleteConfirm.js';
import { EditForm } from './EditForm.js';
import { OnboardingWizard } from './OnboardingWizard.js';
import { useMetrics } from './hooks/useMetrics.js';
import { tuinnelTheme } from './theme.js';

// -- State --

export type AppMode = 'onboarding' | 'empty' | 'dashboard' | 'quitting';
type ModalType = null | 'add' | 'edit' | 'delete';
type TabName = 'details' | 'logs' | 'metrics';

interface AppState {
  mode: AppMode;
  tunnels: Map<string, TunnelRuntime>;
  selectedTunnel: string | null;
  focusedPanel: 'sidebar' | 'main';
  activeModal: ModalType;
  activeTab: TabName;
  showHelp: boolean;
  notification: string | null;
}

// -- Actions --

type Action =
  | { type: 'SET_MODE'; mode: AppMode }
  | { type: 'UPDATE_TUNNEL'; name: string; update: Partial<TunnelRuntime> }
  | { type: 'ADD_TUNNEL'; name: string; tunnel: TunnelRuntime }
  | { type: 'REMOVE_TUNNEL'; name: string }
  | { type: 'SELECT_TUNNEL'; name: string }
  | { type: 'FOCUS_PANEL'; panel: 'sidebar' | 'main' }
  | { type: 'SET_MODAL'; modal: ModalType }
  | { type: 'SET_TAB'; tab: TabName }
  | { type: 'TOGGLE_HELP' }
  | { type: 'SET_NOTIFICATION'; message: string }
  | { type: 'CLEAR_NOTIFICATION' }
  | { type: 'TICK' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'UPDATE_TUNNEL': {
      const tunnels = new Map(state.tunnels);
      const existing = tunnels.get(action.name);
      if (existing) {
        tunnels.set(action.name, { ...existing, ...action.update });
      }
      return { ...state, tunnels };
    }

    case 'ADD_TUNNEL': {
      const tunnels = new Map(state.tunnels);
      tunnels.set(action.name, action.tunnel);
      const mode: AppMode = 'dashboard';
      return {
        ...state,
        tunnels,
        selectedTunnel: action.name,
        mode,
      };
    }

    case 'REMOVE_TUNNEL': {
      const tunnels = new Map(state.tunnels);
      tunnels.delete(action.name);
      // Select next available tunnel
      const keys = Array.from(tunnels.keys());
      const newSelected = keys.length > 0 ? keys[0] : null;
      const mode: AppMode = tunnels.size === 0 ? 'empty' : state.mode;
      return {
        ...state,
        tunnels,
        selectedTunnel: newSelected,
        mode,
      };
    }

    case 'SELECT_TUNNEL':
      return { ...state, selectedTunnel: action.name };

    case 'FOCUS_PANEL':
      return { ...state, focusedPanel: action.panel };

    case 'SET_MODAL':
      return { ...state, activeModal: action.modal };

    case 'SET_TAB':
      return { ...state, activeTab: action.tab };

    case 'TOGGLE_HELP':
      return { ...state, showHelp: !state.showHelp };

    case 'SET_NOTIFICATION':
      return { ...state, notification: action.message };

    case 'CLEAR_NOTIFICATION':
      return { ...state, notification: null };

    case 'TICK':
      return { ...state };

    default:
      return state;
  }
}

// -- Props --

export interface AppProps {
  tunnelService: TunnelService;
  zones: Array<{ id: string; name: string }>;
  defaultZone: string;
  onShutdown: () => Promise<void>;
  initialMode?: AppMode;
}

// -- Component --

export function App({ tunnelService, zones, defaultZone, onShutdown, initialMode }: AppProps) {
  const { exit } = useApp();
  const { isRawModeSupported, setRawMode } = useStdin();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  const initialTunnels = tunnelService.getAll();
  const tunnelNames = Array.from(initialTunnels.keys());

  const computedMode: AppMode = initialMode
    ?? (initialTunnels.size === 0 ? 'empty' : 'dashboard');

  const initialState: AppState = {
    mode: computedMode,
    tunnels: initialTunnels,
    selectedTunnel: tunnelNames[0] ?? null,
    focusedPanel: 'sidebar',
    activeModal: null,
    activeTab: 'details',
    showHelp: false,
    notification: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  // Bun workaround: keep process alive via raw mode
  useEffect(() => {
    if (isRawModeSupported) setRawMode(true);
    return () => { setRawMode(false); };
  }, []);

  // TunnelService event listeners
  useEffect(() => {
    const onStateChange = ({ name, tunnel }: { name: string; state: string; tunnel: TunnelRuntime }) => {
      dispatch({ type: 'UPDATE_TUNNEL', name, update: tunnel });
    };
    const onAdded = ({ name, tunnel }: { name: string; tunnel: TunnelRuntime }) => {
      dispatch({ type: 'ADD_TUNNEL', name, tunnel });
    };
    const onRemoved = ({ name }: { name: string }) => {
      dispatch({ type: 'REMOVE_TUNNEL', name });
    };
    tunnelService.on('stateChange', onStateChange);
    tunnelService.on('tunnelAdded', onAdded);
    tunnelService.on('tunnelRemoved', onRemoved);
    return () => {
      tunnelService.off('stateChange', onStateChange);
      tunnelService.off('tunnelAdded', onAdded);
      tunnelService.off('tunnelRemoved', onRemoved);
    };
  }, [tunnelService]);

  // Uptime auto-refresh: force re-render every second in dashboard mode
  useEffect(() => {
    if (state.mode !== 'dashboard') return;
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(id);
  }, [state.mode]);

  // Clear notification after 2 seconds
  useEffect(() => {
    if (state.notification) {
      const timer = setTimeout(() => {
        dispatch({ type: 'CLEAR_NOTIFICATION' });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.notification]);

  const tunnelKeys = Array.from(state.tunnels.keys());
  const selectedIndex = state.selectedTunnel
    ? tunnelKeys.indexOf(state.selectedTunnel)
    : -1;

  const selectedRuntime = state.selectedTunnel
    ? state.tunnels.get(state.selectedTunnel) ?? null
    : null;

  // Prometheus metrics scraping
  const metricsAddr = selectedRuntime?.metricsPort
    ? `127.0.0.1:${selectedRuntime.metricsPort}`
    : null;
  const { metrics } = useMetrics(metricsAddr);

  // -- Modal callbacks --

  const handleAddSubmit = async (config: { port: number; subdomain: string; zone: string }) => {
    dispatch({ type: 'SET_MODAL', modal: null });
    try {
      const name = await tunnelService.create(config);
      await tunnelService.start(name);
      dispatch({ type: 'SET_NOTIFICATION', message: `Tunnel "${name}" created and started` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_NOTIFICATION', message: `Error: ${msg}` });
    }
  };

  const handleEditSubmit = async (changes: { port: number; subdomain: string; zone: string }) => {
    if (!state.selectedTunnel) return;
    dispatch({ type: 'SET_MODAL', modal: null });
    try {
      await tunnelService.update(state.selectedTunnel, changes);
      dispatch({ type: 'SET_NOTIFICATION', message: `Tunnel "${state.selectedTunnel}" updated` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_NOTIFICATION', message: `Error: ${msg}` });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!state.selectedTunnel) return;
    const name = state.selectedTunnel;
    dispatch({ type: 'SET_MODAL', modal: null });
    try {
      await tunnelService.delete(name);
      dispatch({ type: 'SET_NOTIFICATION', message: `Tunnel "${name}" deleted` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'SET_NOTIFICATION', message: `Error: ${msg}` });
    }
  };

  const handleModalCancel = () => {
    dispatch({ type: 'SET_MODAL', modal: null });
  };

  const handleOnboardingComplete = async (onboardingConfig: { apiToken: string; defaultZone: string; accountId: string }) => {
    const config = configExists() ? readConfig() ?? getDefaultConfig() : getDefaultConfig();
    config.apiToken = onboardingConfig.apiToken;
    if (onboardingConfig.defaultZone) {
      config.defaultZone = onboardingConfig.defaultZone;
    }
    writeConfig(config);
    dispatch({ type: 'SET_MODE', mode: 'empty' });
  };

  const handleOnboardingCancel = () => {
    onShutdown()
      .then(() => exit())
      .catch((err) => {
        process.stderr.write(
          `Warning: Error during shutdown: ${err instanceof Error ? err.message : String(err)}\n`
        );
        exit();
      });
  };

  // -- Keyboard handling --
  useInput((input, key) => {
    // Quit confirmation mode
    if (state.mode === 'quitting') {
      if (input === 'n' || input === 'N') {
        dispatch({ type: 'SET_MODE', mode: state.tunnels.size > 0 ? 'dashboard' : 'empty' });
      } else {
        // Default YES
        onShutdown()
          .then(() => exit())
          .catch((err) => {
            process.stderr.write(
              `Warning: Error during shutdown: ${err instanceof Error ? err.message : String(err)}\n`
            );
            exit();
          });
      }
      return;
    }

    // Onboarding: let the wizard handle keys
    if (state.mode === 'onboarding') return;

    // When a modal is open, let modal handle keys
    if (state.activeModal !== null) return;

    // Help overlay
    if (state.showHelp) {
      dispatch({ type: 'TOGGLE_HELP' });
      return;
    }

    // q: quit
    if (input === 'q') {
      dispatch({ type: 'SET_MODE', mode: 'quitting' });
      return;
    }

    // a: add tunnel
    if (input === 'a') {
      dispatch({ type: 'SET_MODAL', modal: 'add' });
      return;
    }

    // Empty mode only supports q and a
    if (state.mode === 'empty') return;

    // 1/2/3: switch tab
    if (input === '1') {
      dispatch({ type: 'SET_TAB', tab: 'details' });
      return;
    }
    if (input === '2') {
      dispatch({ type: 'SET_TAB', tab: 'logs' });
      return;
    }
    if (input === '3') {
      dispatch({ type: 'SET_TAB', tab: 'metrics' });
      return;
    }

    // Tab: switch focus
    if (key.tab) {
      dispatch({
        type: 'FOCUS_PANEL',
        panel: state.focusedPanel === 'sidebar' ? 'main' : 'sidebar',
      });
      return;
    }

    // ?: help
    if (input === '?') {
      dispatch({ type: 'TOGGLE_HELP' });
      return;
    }

    // Navigation: up/down/j/k
    if ((key.upArrow || input === 'k') && tunnelKeys.length > 0) {
      const newIndex = Math.max(0, selectedIndex - 1);
      dispatch({ type: 'SELECT_TUNNEL', name: tunnelKeys[newIndex] });
      return;
    }
    if ((key.downArrow || input === 'j') && tunnelKeys.length > 0) {
      const newIndex = Math.min(tunnelKeys.length - 1, selectedIndex + 1);
      dispatch({ type: 'SELECT_TUNNEL', name: tunnelKeys[newIndex] });
      return;
    }

    // Sidebar-focused actions
    if (state.focusedPanel === 'sidebar' && selectedRuntime) {
      // e: edit
      if (input === 'e') {
        dispatch({ type: 'SET_MODAL', modal: 'edit' });
        return;
      }

      // d: delete
      if (input === 'd') {
        dispatch({ type: 'SET_MODAL', modal: 'delete' });
        return;
      }

      // s: start/stop toggle
      if (input === 's') {
        const isRunning = selectedRuntime.state === 'connected' || selectedRuntime.state === 'connecting';
        const name = state.selectedTunnel!;
        if (isRunning) {
          tunnelService.stop(name).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            dispatch({ type: 'SET_NOTIFICATION', message: `Error stopping: ${msg}` });
          });
        } else {
          tunnelService.start(name).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            dispatch({ type: 'SET_NOTIFICATION', message: `Error starting: ${msg}` });
          });
        }
        return;
      }

      // r: restart
      if (input === 'r') {
        const name = state.selectedTunnel!;
        tunnelService.restart(name).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          dispatch({ type: 'SET_NOTIFICATION', message: `Error restarting: ${msg}` });
        });
        return;
      }
    }

    // c: copy URL
    if (input === 'c' && selectedRuntime?.publicUrl) {
      const copied = copyToClipboard(selectedRuntime.publicUrl);
      if (copied) {
        dispatch({ type: 'SET_NOTIFICATION', message: `Copied: ${selectedRuntime.publicUrl}` });
      } else {
        dispatch({ type: 'SET_NOTIFICATION', message: 'Clipboard not available' });
      }
      return;
    }

    // o: open in browser (async to avoid blocking TUI)
    if (input === 'o' && selectedRuntime?.publicUrl) {
      try {
        const cmd = platform() === 'darwin' ? 'open' : 'xdg-open';
        spawnChild(cmd, [selectedRuntime.publicUrl], { stdio: 'ignore', detached: true }).unref();
      } catch {}
      return;
    }
  });

  const isSingleTunnel = state.tunnels.size === 1;
  const isNarrow = columns < 80;
  const tunnelList = Array.from(state.tunnels.values());

  // -- Render --

  // Onboarding
  if (state.mode === 'onboarding') {
    return (
      <ThemeProvider theme={tuinnelTheme}>
        <OnboardingWizard
          onComplete={handleOnboardingComplete}
          onCancel={handleOnboardingCancel}
        />
      </ThemeProvider>
    );
  }

  // Quit confirmation
  if (state.mode === 'quitting') {
    return (
      <ThemeProvider theme={tuinnelTheme}>
        <Box flexDirection="column">
          <Text>Stop all tunnels and exit? Tunnels remain on CF for fast restart. (Y/n)</Text>
        </Box>
      </ThemeProvider>
    );
  }

  // Help overlay
  if (state.showHelp) {
    return (
      <ThemeProvider theme={tuinnelTheme}>
        <Box flexDirection="column" padding={1}>
          <Text bold>Keyboard Shortcuts</Text>
          <Text> </Text>
          <Text>  Up/Down/j/k Navigate tunnels</Text>
          <Text>  Tab         Switch focus: sidebar / main</Text>
          <Text>  1/2/3       Switch tab: details / logs / metrics</Text>
          <Text>  a           Add tunnel</Text>
          <Text>  e           Edit selected tunnel</Text>
          <Text>  d           Delete selected tunnel</Text>
          <Text>  s           Start/Stop toggle</Text>
          <Text>  r           Restart selected tunnel</Text>
          <Text>  c           Copy public URL</Text>
          <Text>  o           Open URL in browser</Text>
          <Text>  /           Filter logs</Text>
          <Text>  ?           Toggle this help</Text>
          <Text>  q           Quit</Text>
          <Text>  Ctrl+C      Force quit</Text>
          <Text> </Text>
          <Text dimColor>Press any key to close</Text>
        </Box>
      </ThemeProvider>
    );
  }

  // Empty state (no tunnels)
  if (state.mode === 'empty') {
    return (
      <ThemeProvider theme={tuinnelTheme}>
        <Box flexDirection="column" width={columns} height={rows}>
          {state.activeModal === 'add' ? (
            <AddWizard
              defaultZone={defaultZone}
              zones={zones}
              onSubmit={handleAddSubmit}
              onCancel={handleModalCancel}
            />
          ) : (
            <EmptyState width={columns} height={rows - 1} />
          )}
          <HelpBar
            focusedPanel={state.focusedPanel}
            notification={state.notification}
            activeModal={state.activeModal}
            activeTab={state.activeTab}
            hasSelection={false}
            mode="empty"
          />
        </Box>
      </ThemeProvider>
    );
  }

  // Dashboard with optional modal overlays
  return (
    <ThemeProvider theme={tuinnelTheme}>
      <Box flexDirection="column" width={columns} height={rows}>
        {state.activeModal === 'add' && (
          <AddWizard
            defaultZone={defaultZone}
            zones={zones}
            onSubmit={handleAddSubmit}
            onCancel={handleModalCancel}
          />
        )}
        {state.activeModal === 'edit' && selectedRuntime && (
          <EditForm
            tunnel={{
              name: selectedRuntime.name,
              port: selectedRuntime.config.port,
              subdomain: selectedRuntime.config.subdomain,
              zone: selectedRuntime.config.zone,
            }}
            zones={zones}
            onSubmit={handleEditSubmit}
            onCancel={handleModalCancel}
          />
        )}
        {state.activeModal === 'delete' && selectedRuntime && (
          <DeleteConfirm
            tunnelName={selectedRuntime.name}
            subdomain={selectedRuntime.config.subdomain}
            zone={selectedRuntime.config.zone}
            onConfirm={handleDeleteConfirm}
            onCancel={handleModalCancel}
          />
        )}
        {state.activeModal === null && (
          <>
            <Box flexDirection="row" flexGrow={1}>
              {!isSingleTunnel && !isNarrow && (
                <Sidebar
                  tunnels={tunnelList}
                  selectedTunnel={state.selectedTunnel}
                  focused={state.focusedPanel === 'sidebar'}
                  height={rows - 1}
                />
              )}
              <MainPanel
                tunnel={selectedRuntime}
                focused={state.focusedPanel === 'main' || isSingleTunnel}
                activeTab={state.activeTab}
                logFilter={null}
                logPaused={false}
                metrics={metrics}
                metricsAddr={metricsAddr}
              />
            </Box>
            <HelpBar
              focusedPanel={state.focusedPanel}
              notification={state.notification}
              activeModal={state.activeModal}
              activeTab={state.activeTab}
              hasSelection={!!selectedRuntime}
              mode="dashboard"
            />
          </>
        )}
      </Box>
    </ThemeProvider>
  );
}
