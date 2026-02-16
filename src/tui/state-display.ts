import type { TunnelState } from '../types.js';

export interface StateDisplay {
  symbol: string;
  label: string;
  color: string | undefined;
}

export function getStateDisplay(state: TunnelState): StateDisplay {
  switch (state) {
    case 'creating':
      return { symbol: '\u25CC', label: 'CREATING', color: 'yellow' };
    case 'connecting':
      return { symbol: '\u25CC', label: 'CONNECTING', color: 'yellow' };
    case 'connected':
      return { symbol: '\u25CF', label: 'UP', color: 'green' };
    case 'disconnected':
      return { symbol: '\u25CB', label: 'DOWN', color: 'red' };
    case 'port_down':
      return { symbol: '\u26A0', label: 'PORT DOWN', color: 'yellow' };
    case 'restarting':
      return { symbol: '\u25CC', label: 'RESTARTING', color: 'yellow' };
    case 'error':
      return { symbol: '\u2717', label: 'ERROR', color: 'red' };
    case 'stopped':
      return { symbol: '-', label: 'STOPPED', color: undefined };
    default:
      return { symbol: '?', label: 'UNKNOWN', color: undefined };
  }
}

export function getStateIndicator(state: TunnelState): string {
  const { symbol, label } = getStateDisplay(state);
  return `${symbol} ${label}`;
}
