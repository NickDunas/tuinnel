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

export function extractVersion(line: string): string | null {
  const match = line.match(PATTERNS.version);
  return match ? match[1] : null;
}

export function extractConnectorId(line: string): string | null {
  const match = line.match(PATTERNS.connectorId);
  return match ? match[1] : null;
}
