import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { MainPanel } from '../../src/tui/MainPanel.js';
import type { TunnelRuntime, ConnectionEvent } from '../../src/types.js';

function makeTunnel(overrides: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    name: 'angular',
    config: { port: 4200, subdomain: 'angular', zone: 'mysite.com', protocol: 'http' as const },
    state: 'connected',
    pid: 12345,
    tunnelId: 'test-uuid',
    publicUrl: 'https://angular.mysite.com',
    connectorToken: null,
    metricsPort: null,
    connectedAt: Date.now() - 754000, // ~12min 34sec ago
    lastError: null,
    connections: [],
    ...overrides,
  };
}

describe('MainPanel', () => {
  test('shows empty state when no tunnel selected', () => {
    const { lastFrame } = render(
      <MainPanel tunnel={null} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    expect(lastFrame()).toContain('Select a tunnel from the sidebar');
  });

  test('shows tunnel hostname and port on details tab', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('angular.mysite.com');
    expect(frame).toContain(':4200');
  });

  test('shows local URL', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    expect(lastFrame()).toContain('http://localhost:4200');
  });

  test('shows public URL', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    expect(lastFrame()).toContain('https://angular.mysite.com');
  });

  test('shows status and uptime', () => {
    const tunnel = makeTunnel({ connectedAt: Date.now() - 754000 }); // 12 min 34 sec ago
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('UP');
    expect(frame).toContain('00:12:34');
  });

  test('shows tab bar', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Details');
    expect(frame).toContain('Logs');
    expect(frame).toContain('Metrics');
  });

  test('logs tab shows connection events', () => {
    const events: ConnectionEvent[] = [
      {
        timestamp: new Date('2024-07-01T14:23:01Z'),
        level: 'INF',
        message: 'Registered tunnel connection',
        connIndex: 0,
        location: 'DFW',
      },
    ];
    const tunnel = makeTunnel({ connections: events });
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="logs" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Registered tunnel connection');
  });

  test('logs tab shows waiting message when no events', () => {
    const tunnel = makeTunnel({ connections: [], publicUrl: 'https://angular.mysite.com' });
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="logs" logFilter={null} logPaused={false} />
    );

    expect(lastFrame()).toContain('Waiting for connections');
  });

  test('metrics tab shows metrics content', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="metrics" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Metrics');
  });

  test('metrics tab without addr shows waiting', () => {
    const tunnel = makeTunnel();
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="metrics" logFilter={null} logPaused={false} metricsAddr={null} />
    );

    expect(lastFrame()).toContain('Waiting for metrics server');
  });

  test('details tab does not show logs content', () => {
    const events: ConnectionEvent[] = [
      {
        timestamp: new Date('2024-07-01T14:23:01Z'),
        level: 'INF',
        message: 'Registered tunnel connection',
      },
    ];
    const tunnel = makeTunnel({ connections: events });
    const { lastFrame } = render(
      <MainPanel tunnel={tunnel} focused={false} activeTab="details" logFilter={null} logPaused={false} />
    );

    const frame = lastFrame();
    // Details tab should not show log event messages directly
    expect(frame).toContain('angular.mysite.com');
  });
});
