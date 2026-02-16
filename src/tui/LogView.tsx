import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type { ConnectionEvent } from '../types.js';
import { color } from './use-color.js';

export interface LogViewProps {
  events: ConnectionEvent[];
  filter: string | null;
  paused: boolean;
  publicUrl: string | null;
  onScroll?: (direction: 'up' | 'down' | 'end') => void;
}

const MAX_VISIBLE = 15;

function levelColor(level: ConnectionEvent['level']): string | undefined {
  switch (level) {
    case 'INF': return color('green');
    case 'WRN': return color('yellow');
    case 'ERR':
    case 'FTL': return color('red');
    default: return undefined;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function formatEventFields(event: ConnectionEvent): string {
  const parts: string[] = [];
  if (event.location) parts.push(`location=${event.location}`);
  if (event.connIndex !== undefined) parts.push(`connIndex=${event.connIndex}`);
  if (event.connectionId) parts.push(`id=${event.connectionId.substring(0, 8)}`);
  if (event.protocol) parts.push(`protocol=${event.protocol}`);
  if (event.edgeIp) parts.push(`edge=${event.edgeIp}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function LogView({ events, filter, paused, publicUrl }: LogViewProps) {
  const filtered = filter
    ? events.filter(e =>
        e.message.toLowerCase().includes(filter.toLowerCase()) ||
        (e.location && e.location.toLowerCase().includes(filter.toLowerCase())))
    : events;

  // When paused, freeze the scroll position at the point we paused
  const [pauseIndex, setPauseIndex] = useState(0);
  const prevPausedRef = useRef(paused);

  useEffect(() => {
    if (paused && !prevPausedRef.current) {
      // Just became paused: capture current end position
      setPauseIndex(Math.max(0, filtered.length - MAX_VISIBLE));
    }
    prevPausedRef.current = paused;
  }, [paused, filtered.length]);

  const visibleEvents = paused
    ? filtered.slice(pauseIndex, pauseIndex + MAX_VISIBLE)
    : filtered.slice(-MAX_VISIBLE);

  // Empty state
  if (events.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold dimColor>{'  '}-- Connection Events --</Text>
        <Text dimColor>
          {'  '}Waiting for connections...{publicUrl ? ` Try visiting ${publicUrl}` : ''}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold dimColor>{'  '}-- Connection Events --</Text>
      {filter !== null && (
        <Text dimColor>{'  '}Filter: {filter || '(type to search)'}</Text>
      )}
      {visibleEvents.map((event, i) => (
        <Text
          key={i}
          dimColor={event.level === 'DBG'}
          color={levelColor(event.level)}
        >
          {'  '}{formatTime(event.timestamp)} {event.level}  {event.message}
          {formatEventFields(event)}
        </Text>
      ))}
      {paused && (
        <Text color={color('yellow')}>{'  '}PAUSED -- press End to resume</Text>
      )}
      {filter !== null && filtered.length === 0 && events.length > 0 && (
        <Text dimColor>{'  '}No events matching "{filter}"</Text>
      )}
    </Box>
  );
}
