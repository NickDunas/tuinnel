import { useState, useEffect, useRef } from 'react';
import type { TunnelMetrics } from '../../types.js';

interface RawMetric {
  labels: string;
  value: number;
}

type RawMetrics = Record<string, RawMetric[]>;

export interface MetricsState {
  metrics: TunnelMetrics | null;
  lastScraped: Date | null;
  error: string | null;
}

function parsePrometheusText(text: string): RawMetrics {
  const metrics: RawMetrics = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    // Format: metric_name{label="value"} 42.0
    // or:     metric_name 42.0
    const match = line.match(/^(\S+?)(\{[^}]*\})?\s+(\S+)$/);
    if (match) {
      const [, name, labels, value] = match;
      if (!metrics[name]) metrics[name] = [];
      metrics[name].push({ labels: labels || '', value: parseFloat(value) });
    }
  }
  return metrics;
}

function getMetricValue(raw: RawMetrics, name: string): number {
  const entries = raw[name];
  if (!entries || entries.length === 0) return 0;
  return entries[0].value;
}

function getResponseCodeCounts(raw: RawMetrics): Record<string, number> {
  const entries = raw['cloudflared_tunnel_response_by_code'] || [];
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const codeMatch = entry.labels.match(/status_code="(\d+)"/);
    if (codeMatch) {
      counts[codeMatch[1]] = entry.value;
    }
  }
  return counts;
}

function getHistogramPercentiles(raw: RawMetrics, name: string): { p50: number; p95: number; p99: number } {
  const bucketEntries = raw[`${name}_bucket`] || [];
  const countEntry = raw[`${name}_count`];
  const totalCount = countEntry?.[0]?.value ?? 0;

  if (totalCount === 0 || bucketEntries.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }

  // Sort buckets by le value
  const buckets = bucketEntries
    .map(e => {
      const leMatch = e.labels.match(/le="([^"]+)"/);
      return {
        le: leMatch ? parseFloat(leMatch[1]) : Infinity,
        count: e.value,
      };
    })
    .filter(b => isFinite(b.le))
    .sort((a, b) => a.le - b.le);

  const p50Target = totalCount * 0.5;
  const p95Target = totalCount * 0.95;
  const p99Target = totalCount * 0.99;

  let p50 = 0;
  let p95 = 0;
  let p99 = 0;

  for (const bucket of buckets) {
    if (p50 === 0 && bucket.count >= p50Target) p50 = bucket.le;
    if (p95 === 0 && bucket.count >= p95Target) p95 = bucket.le;
    if (p99 === 0 && bucket.count >= p99Target) p99 = bucket.le;
  }

  return { p50, p95, p99 };
}

function mapToTunnelMetrics(raw: RawMetrics): TunnelMetrics {
  return {
    totalRequests: getMetricValue(raw, 'cloudflared_tunnel_total_requests'),
    requestErrors: getMetricValue(raw, 'cloudflared_tunnel_request_errors'),
    concurrentRequests: getMetricValue(raw, 'cloudflared_tunnel_concurrent_requests_per_tunnel'),
    haConnections: getMetricValue(raw, 'cloudflared_tunnel_ha_connections'),
    activeStreams: getMetricValue(raw, 'cloudflared_tunnel_active_streams'),
    responseCodeCounts: getResponseCodeCounts(raw),
    connectLatencyMs: getHistogramPercentiles(raw, 'cloudflared_proxy_connect_latency'),
    quicRtt: {
      smoothed: getMetricValue(raw, 'quic_client_smoothed_rtt'),
      min: getMetricValue(raw, 'quic_client_min_rtt'),
    },
    lastScrapedAt: new Date(),
  };
}

async function scrapeMetrics(addr: string): Promise<TunnelMetrics> {
  const res = await fetch(`http://${addr}/metrics`);
  if (!res.ok) {
    throw new Error(`Metrics scrape failed: ${res.status}`);
  }
  const text = await res.text();
  const raw = parsePrometheusText(text);
  return mapToTunnelMetrics(raw);
}

export function useMetrics(
  addr: string | null,
  interval: number = 3000,
): MetricsState {
  const [metrics, setMetrics] = useState<TunnelMetrics | null>(null);
  const [lastScraped, setLastScraped] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Reset on addr change to avoid showing stale data
    setMetrics(null);
    setError(null);
    setLastScraped(null);

    if (!addr) return;

    const poll = async () => {
      try {
        const result = await scrapeMetrics(addr);
        if (mountedRef.current) {
          setMetrics(result);
          setLastScraped(new Date());
          setError(null);
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      }
    };

    // Run immediately
    poll();
    const id = setInterval(poll, interval);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [addr, interval]);

  return { metrics, lastScraped, error };
}
