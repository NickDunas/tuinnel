import React from 'react';
import { Box, Text } from 'ink';
import type { TunnelMetrics } from '../types.js';

interface MetricsProps {
  metrics: TunnelMetrics | null;
  metricsAddr: string | null;
}

function formatResponseCodes(counts: Record<string, number>): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const [code, count] of Object.entries(counts)) {
    const group = `${code[0]}xx`;
    groups[group] = (groups[group] ?? 0) + count;
  }
  return groups;
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 1) return '<1s ago';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s ago`;
}

function formatMs(ms: number): string {
  if (ms === 0) return '-';
  if (ms < 1) return '<1 ms';
  return `${Math.round(ms)} ms`;
}

function Row({ label, children, dim }: { label: string; children: React.ReactNode; dim?: boolean }) {
  return (
    <Box>
      <Box width={18}><Text dimColor>{label}</Text></Box>
      {dim ? <Text dimColor>{children}</Text> : <Box>{children}</Box>}
    </Box>
  );
}

function SectionHeader({ title, dim }: { title: string; dim?: boolean }) {
  return (
    <Box marginTop={1}>
      <Text bold color={dim ? undefined : 'cyan'} dimColor={dim}>{title}</Text>
    </Box>
  );
}

function ResponseCodeBadge({ group, count, dim }: { group: string; count: number; dim?: boolean }) {
  const color = dim ? undefined
    : group.startsWith('2') ? 'green'
    : group.startsWith('3') ? 'yellow'
    : group.startsWith('4') ? 'yellow'
    : group.startsWith('5') ? 'red'
    : undefined;
  return <Text color={color} dimColor={dim}>{group}: {count}</Text>;
}

export function Metrics({ metrics, metricsAddr }: MetricsProps) {
  if (!metricsAddr) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Waiting for metrics server...</Text>
      </Box>
    );
  }

  if (!metrics) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Scraping metrics...</Text>
      </Box>
    );
  }

  const isStale = Date.now() - metrics.lastScrapedAt.getTime() > 10000;
  const age = formatAge(metrics.lastScrapedAt);
  const responseCodes = formatResponseCodes(metrics.responseCodeCounts);
  const sortedCodes = Object.entries(responseCodes).sort(([a], [b]) => a.localeCompare(b));
  const hasErrors = metrics.requestErrors > 0;
  const hasQuicRtt = metrics.quicRtt.smoothed > 0 || metrics.quicRtt.min > 0;

  return (
    <Box flexDirection="column">
      <SectionHeader title="TRAFFIC" dim={isStale} />
      <Row label="Total Requests" dim={isStale}>
        <Text>{metrics.totalRequests}</Text>
      </Row>
      <Row label="Errors" dim={isStale}>
        <Text color={hasErrors && !isStale ? 'red' : isStale ? undefined : 'green'}>
          {metrics.requestErrors}
        </Text>
        {hasErrors && !isStale && <Text color="red"> !</Text>}
      </Row>
      <Row label="Active Now" dim={isStale}>
        <Text>{metrics.concurrentRequests}</Text>
      </Row>
      {sortedCodes.length > 0 && (
        <Row label="Response Codes">
          <Box gap={2}>
            {sortedCodes.map(([group, count]) => (
              <ResponseCodeBadge key={group} group={group} count={count} dim={isStale} />
            ))}
          </Box>
        </Row>
      )}

      <SectionHeader title="LATENCY" dim={isStale} />
      <Row label="Connect p50" dim={isStale}>
        <Text>{formatMs(metrics.connectLatencyMs.p50)}</Text>
      </Row>
      <Row label="Connect p95" dim={isStale}>
        <Text>{formatMs(metrics.connectLatencyMs.p95)}</Text>
      </Row>
      <Row label="Connect p99" dim={isStale}>
        <Text>{formatMs(metrics.connectLatencyMs.p99)}</Text>
      </Row>

      <SectionHeader title="CONNECTION" dim={isStale} />
      <Row label="Edge Connections" dim={isStale}>
        <Text>{metrics.haConnections}</Text>
      </Row>
      <Row label="Active Streams" dim={isStale}>
        <Text>{metrics.activeStreams}</Text>
      </Row>
      {hasQuicRtt && (
        <Row label="QUIC RTT" dim={isStale}>
          <Text>{metrics.quicRtt.smoothed} ms</Text>
          <Text dimColor>  (min {metrics.quicRtt.min} ms)</Text>
        </Row>
      )}

      <Box marginTop={1}>
        <Text dimColor={!isStale} color={isStale ? 'yellow' : undefined}>
          {isStale ? '! ' : ''}Updated {age}
        </Text>
      </Box>
    </Box>
  );
}
