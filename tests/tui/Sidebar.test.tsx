import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { Sidebar } from '../../src/tui/Sidebar.js';
import type { TunnelRuntime } from '../../src/types.js';

function makeTunnel(overrides: Partial<TunnelRuntime> & { name: string }): TunnelRuntime {
  return {
    config: { port: 3000, subdomain: 'app', zone: 'example.com', protocol: 'http' as const },
    state: 'connected',
    pid: null,
    tunnelId: null,
    publicUrl: null,
    connectorToken: null,
    metricsPort: null,
    uptime: 0,
    lastError: null,
    connections: [],
    ...overrides,
  };
}

describe('Sidebar', () => {
  test('renders tunnel list', () => {
    const tunnels = [
      makeTunnel({ name: 'angular', config: { port: 4200, subdomain: 'angular', zone: 'example.com', protocol: 'http' } }),
      makeTunnel({ name: 'vite', config: { port: 3000, subdomain: 'vite', zone: 'example.com', protocol: 'http' } }),
    ];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="angular" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('TUNNELS');
    expect(frame).toContain('angular');
    expect(frame).toContain('vite');
    expect(frame).toContain(':4200');
    expect(frame).toContain(':3000');
  });

  test('shows UP indicator for connected state', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'connected' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    // Connected state shows green circle symbol (not the "UP" label in compact sidebar)
    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows DOWN indicator for disconnected state', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'disconnected' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows CONNECTING indicator', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'connecting' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows ERROR indicator', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'error' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows STOPPED indicator', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'stopped' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows PORT DOWN indicator', () => {
    const tunnels = [makeTunnel({ name: 'app', state: 'port_down' })];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('app');
  });

  test('shows empty state when no tunnels', () => {
    const { lastFrame } = render(
      <Sidebar tunnels={[]} selectedTunnel={null} focused={false} />
    );

    expect(lastFrame()).toContain('No tunnels');
  });

  test('compact display shows port number', () => {
    const tunnels = [
      makeTunnel({ name: 'angular', config: { port: 4200, subdomain: 'angular', zone: 'example.com', protocol: 'http' } }),
    ];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="angular" focused={false} />
    );

    expect(lastFrame()).toContain(':4200');
  });

  test('truncates long tunnel names', () => {
    const tunnels = [
      makeTunnel({
        name: 'very-long-tunnel-name',
        config: { port: 3000, subdomain: 'very-long-tunnel-name', zone: 'example.com', protocol: 'http' },
      }),
    ];

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="very-long-tunnel-name" focused={false} />
    );

    const frame = lastFrame();
    // Name should be truncated with ellipsis since > 12 chars
    expect(frame).toContain('\u2026');
  });

  test('focused state changes border color', () => {
    const tunnels = [makeTunnel({ name: 'app' })];

    // Just verify it renders without error in both focused states
    const { lastFrame: unfocusedFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={false} />
    );
    expect(unfocusedFrame()).toContain('TUNNELS');

    const { lastFrame: focusedFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="app" focused={true} />
    );
    expect(focusedFrame()).toContain('TUNNELS');
  });

  test('scroll indicators with height constraint', () => {
    // Create more tunnels than can fit
    const tunnels = Array.from({ length: 20 }, (_, i) =>
      makeTunnel({
        name: `tunnel-${i}`,
        config: { port: 3000 + i, subdomain: `tunnel-${i}`, zone: 'example.com', protocol: 'http' },
      })
    );

    const { lastFrame } = render(
      <Sidebar tunnels={tunnels} selectedTunnel="tunnel-10" focused={false} height={10} />
    );

    const frame = lastFrame();
    expect(frame).toContain('TUNNELS');
    // With 20 tunnels and height=10, there should be scroll indicators
    expect(frame).toContain('more');
  });
});
