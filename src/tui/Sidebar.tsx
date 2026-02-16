import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { TunnelRuntime } from '../types.js';
import { getStateDisplay } from './state-display.js';
import { color } from './use-color.js';

export interface SidebarProps {
  tunnels: TunnelRuntime[];
  selectedTunnel: string | null;
  focused: boolean;
  height?: number;
  onSelect?: (name: string) => void;
}

export function Sidebar({ tunnels, selectedTunnel, focused, height }: SidebarProps) {

  // Calculate visible window for scrolling
  const selectedIndex = tunnels.findIndex(t => t.name === selectedTunnel);
  const headerLines = 1; // "TUNNELS" header
  const borderLines = 2; // top + bottom border
  const maxVisible = height ? Math.max(1, height - headerLines - borderLines) : tunnels.length;

  const { startIndex, endIndex, hasMore, hasLess } = useMemo(() => {
    if (tunnels.length <= maxVisible) {
      return {
        startIndex: 0,
        endIndex: tunnels.length,
        hasMore: false,
        hasLess: false,
      };
    }

    // Reserve 1 line each for scroll indicators when needed
    const effectiveVisible = maxVisible;
    let start = 0;
    const idx = Math.max(0, selectedIndex);

    // Center the selected item in the visible window
    start = Math.max(0, idx - Math.floor(effectiveVisible / 2));
    const end = Math.min(tunnels.length, start + effectiveVisible);
    // Adjust start if we hit the bottom
    start = Math.max(0, end - effectiveVisible);

    return {
      startIndex: start,
      endIndex: end,
      hasMore: end < tunnels.length,
      hasLess: start > 0,
    };
  }, [tunnels.length, selectedIndex, maxVisible]);

  const visibleTunnels = tunnels.slice(startIndex, endIndex);

  return (
    <Box
      flexDirection="column"
      width={24}
      borderStyle="single"
      borderColor={color(focused ? 'cyan' : 'gray')}
    >
      <Text bold color={color(focused ? 'cyan' : undefined)}>
        {' '}TUNNELS
      </Text>
      {hasLess && (
        <Text dimColor>{' '}{'\u2191'} more</Text>
      )}
      {visibleTunnels.map(tunnel => {
        const isSelected = tunnel.name === selectedTunnel;
        const { symbol, color: stateColor } = getStateDisplay(tunnel.state);
        const portStr = `:${tunnel.config.port}`;
        // Compact: one line per tunnel — symbol + name + port
        const nameDisplay = tunnel.name.length > 12
          ? tunnel.name.substring(0, 11) + '\u2026'
          : tunnel.name;

        return (
          <Text
            key={tunnel.name}
            backgroundColor={isSelected ? 'gray' : undefined}
            bold={isSelected}
          >
            {' '}
            <Text color={color(stateColor)}>{symbol}</Text>
            {' '}{nameDisplay}
            <Text dimColor> {portStr}</Text>
          </Text>
        );
      })}
      {hasMore && (
        <Text dimColor>{' '}{'\u2193'} more</Text>
      )}
      {tunnels.length === 0 && (
        <Text dimColor> No tunnels</Text>
      )}
    </Box>
  );
}

