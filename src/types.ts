import type { TunnelConfig } from './config/schema.js';

/** Tunnel states as rendered in the TUI */
export type TunnelState =
  | 'creating'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'port_down'
  | 'restarting'
  | 'error'
  | 'stopped';

/** Runtime tunnel info (combines config + live state) */
export interface TunnelRuntime {
  name: string;
  config: TunnelConfig;
  state: TunnelState;
  pid: number | null;
  tunnelId: string | null;     // CF tunnel UUID
  publicUrl: string | null;    // https://subdomain.zone.com
  connectorToken: string | null;
  metricsPort: number | null;  // Discovered from stderr
  connectedAt: number;         // timestamp when connected (Date.now())
  lastError: string | null;
  connections: ConnectionEvent[];
}

/** Parsed from cloudflared stderr */
export interface ConnectionEvent {
  timestamp: Date;
  level: 'DBG' | 'INF' | 'WRN' | 'ERR' | 'FTL';
  message: string;
  connIndex?: number;
  connectionId?: string;   // UUID of individual connection
  location?: string;       // datacenter code (lax08, sjc07, ORD, etc.)
  edgeIp?: string;         // Cloudflare edge IP
  protocol?: string;       // 'quic' or 'http2'
}

/** Prometheus metrics (Phase 4) -- validated against cloudflared source */
export interface TunnelMetrics {
  totalRequests: number;           // cloudflared_tunnel_total_requests (counter)
  requestErrors: number;           // cloudflared_tunnel_request_errors (counter)
  concurrentRequests: number;      // cloudflared_tunnel_concurrent_requests_per_tunnel (gauge)
  haConnections: number;           // cloudflared_tunnel_ha_connections (gauge)
  activeStreams: number;           // cloudflared_tunnel_active_streams (gauge)
  responseCodeCounts: Record<string, number>;  // cloudflared_tunnel_response_by_code{status_code="200"}: 142
  connectLatencyMs: {              // cloudflared_proxy_connect_latency (histogram)
    p50: number;
    p95: number;
    p99: number;
  };
  quicRtt: {                       // quic_client_smoothed_rtt / quic_client_min_rtt (gauge, ms)
    smoothed: number;
    min: number;
  };
  lastScrapedAt: Date;
  // NOTE: No bandwidth/bytes-transferred metrics exist in cloudflared
}

export type { Config, TunnelConfig } from './config/schema.js';
