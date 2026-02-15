import React from 'react';
import { Box, Text } from 'ink';
import type { TunnelRuntime, TunnelState, TunnelMetrics } from '../types.js';
import { TabBar } from './TabBar.js';
import { LogView } from './LogView.js';
import { Metrics } from './Metrics.js';

export interface MainPanelProps {
  tunnel: TunnelRuntime | null;
  focused: boolean;
  activeTab: 'details' | 'logs' | 'metrics';
  logFilter: string | null;
  logPaused: boolean;
  onLogScroll?: (direction: 'up' | 'down' | 'end') => void;
  metrics?: TunnelMetrics | null;
  metricsAddr?: string | null;
}

export function MainPanel({ tunnel, focused, activeTab, logFilter, logPaused, onLogScroll, metrics, metricsAddr }: MainPanelProps) {
  if (!tunnel) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor={focused ? 'cyan' : 'gray'}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>Select a tunnel from the sidebar</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
    >
      <TabBar activeTab={activeTab} />

      {activeTab === 'details' && (
        <Box flexDirection="column" paddingX={1}>
          <Text> </Text>
          <Text bold>
            {tunnel.config.subdomain}.{tunnel.config.zone} {'<-'} :{tunnel.config.port}
          </Text>
          <Text> </Text>
          <Text>
            Status: {stateIndicator(tunnel.state)}
            {'    '}Uptime: {formatUptime(tunnel.uptime)}
          </Text>
          <Text>Local:  http://localhost:{tunnel.config.port}</Text>
          {tunnel.publicUrl && (
            <Text>Public: {tunnel.publicUrl}</Text>
          )}
          {tunnel.tunnelId && (
            <Text dimColor>ID:     {tunnel.tunnelId}</Text>
          )}
          {tunnel.lastError && (
            <Text color="red">Error:  {tunnel.lastError}</Text>
          )}
        </Box>
      )}

      {activeTab === 'logs' && (
        <Box flexDirection="column" flexGrow={1}>
          <LogView
            events={tunnel.connections}
            filter={logFilter}
            paused={logPaused}
            publicUrl={tunnel.publicUrl}
            onScroll={onLogScroll}
          />
        </Box>
      )}

      {activeTab === 'metrics' && (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          <Text> </Text>
          <Metrics metrics={metrics ?? null} metricsAddr={metricsAddr ?? null} />
        </Box>
      )}
    </Box>
  );
}

function stateIndicator(s: TunnelState): string {
  switch (s) {
    case 'connected': return '\u25CF UP';
    case 'disconnected': return '\u25CB DOWN';
    case 'connecting': return '\u25CC CONNECTING';
    case 'creating': return '\u25CC CREATING';
    case 'restarting': return '\u25CC RESTARTING';
    case 'port_down': return '\u26A0 PORT DOWN';
    case 'error': return '\u2717 ERROR';
    case 'stopped': return '- STOPPED';
    default: return '? UNKNOWN';
  }
}

function formatUptime(startTimestamp: number): string {
  if (startTimestamp <= 0) return '00:00:00';
  const ms = Date.now() - startTimestamp;
  if (ms < 0) return '00:00:00';
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
