import { useState, useEffect, useRef, useCallback } from 'react';
import type { Readable } from 'stream';
import type { ConnectionEvent } from '../../types.js';
import {
  parseLogLine,
  extractRegistration,
  extractMetricsAddr,
  extractQuickTunnelUrl,
  extractConnectorId,
} from '../../cloudflared/log-parser.js';

const MAX_EVENTS = 1000;

export interface CloudflaredLogsState {
  events: ConnectionEvent[];
  metricsAddr: string | null;
  connectorId: string | null;
  registrations: number;
}

export function useCloudflaredLogs(
  stderr: Readable | null,
): CloudflaredLogsState {
  const [events, setEvents] = useState<ConnectionEvent[]>([]);
  const [metricsAddr, setMetricsAddr] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState(0);
  const mountedRef = useRef(true);

  const handleLine = useCallback((line: string) => {
    if (!mountedRef.current) return;

    const parsed = parseLogLine(line);
    if (!parsed) return;

    // Check for special events
    const addr = extractMetricsAddr(line);
    if (addr) setMetricsAddr(addr);

    const cid = extractConnectorId(line);
    if (cid) setConnectorId(cid);

    const reg = extractRegistration(line);

    // Build connection event
    const event: ConnectionEvent = {
      timestamp: parsed.timestamp,
      level: parsed.level,
      message: parsed.message,
      ...(reg && {
        connIndex: reg.connIndex,
        connectionId: reg.connectionId,
        location: reg.location,
        edgeIp: reg.edgeIp,
        protocol: reg.protocol,
      }),
    };

    // Add to ring buffer
    setEvents(prev => {
      const next = [...prev, event];
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
    });

    if (reg) {
      setRegistrations(prev => prev + 1);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!stderr) return;

    // Line-based parsing from stderr stream
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      // Keep the incomplete last line in the buffer
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleLine(line);
      }
    };

    stderr.on('data', onData);

    return () => {
      mountedRef.current = false;
      stderr.removeListener('data', onData);
    };
  }, [stderr, handleLine]);

  return { events, metricsAddr, connectorId, registrations };
}
