import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/App.js';
import type { TunnelRuntime } from '../../src/types.js';
import { EventEmitter } from 'events';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function makeTunnel(name: string, overrides: Partial<TunnelRuntime> = {}): TunnelRuntime {
  return {
    name,
    config: { port: 3000, subdomain: name, zone: 'example.com', protocol: 'http' as const },
    state: 'connected',
    pid: null,
    tunnelId: null,
    publicUrl: `https://${name}.example.com`,
    connectorToken: null,
    metricsPort: null,
    uptime: 0,
    lastError: null,
    connections: [],
    ...overrides,
  };
}

function makeTunnelMap(...names: string[]): Map<string, TunnelRuntime> {
  const map = new Map<string, TunnelRuntime>();
  for (const name of names) {
    map.set(name, makeTunnel(name, {
      config: { port: 3000 + names.indexOf(name) * 100, subdomain: name, zone: 'example.com', protocol: 'http' },
    }));
  }
  return map;
}

class MockTunnelService extends EventEmitter {
  private mockTunnels: Map<string, TunnelRuntime>;

  constructor(tunnels: Map<string, TunnelRuntime>) {
    super();
    this.mockTunnels = tunnels;
  }

  getAll() { return new Map(this.mockTunnels); }
  get(name: string) { return this.mockTunnels.get(name); }
  async create() { return 'test'; }
  async update() {}
  async delete() {}
  async start() {}
  async stop() {}
  async restart() {}
  loadFromConfig() {}
  async autoStart() {}
  saveState() {}
  async shutdown() {}
}

function makeTestApp(tunnelNames: string[], initialMode?: 'onboarding' | 'empty' | 'dashboard' | 'quitting') {
  const tunnels = makeTunnelMap(...tunnelNames);
  const service = new MockTunnelService(tunnels);
  return {
    service,
    props: {
      tunnelService: service as any,
      zones: [{ id: 'z1', name: 'example.com' }],
      defaultZone: 'example.com',
      onShutdown: async () => {},
      initialMode,
    },
  };
}

describe('App', () => {
  test('renders dashboard mode with tunnels', () => {
    const { props } = makeTestApp(['angular', 'vite']);
    const { lastFrame } = render(<App {...props} />);

    const frame = lastFrame();
    expect(frame).toContain('angular');
    expect(frame).toContain('Details');
  });

  test('shows help bar', () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame } = render(<App {...props} />);

    const frame = lastFrame();
    expect(frame).toContain('Navigate');
    expect(frame).toContain('Quit');
  });

  test('q shows quit confirmation', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('q');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Stop all tunnels and exit');
    expect(frame).toContain('Y/n');
  });

  test('? toggles help overlay', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('?');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Keyboard Shortcuts');
    expect(frame).toContain('Up/Down');
    expect(frame).toContain('Tab');
    expect(frame).toContain('Ctrl+C');
  });

  test('help overlay closes on any key', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    // Open help
    stdin.write('?');
    await delay(50);
    expect(lastFrame()).toContain('Keyboard Shortcuts');

    // Close with any key
    stdin.write('x');
    await delay(50);
    expect(lastFrame()).not.toContain('Keyboard Shortcuts');
  });

  test('shows selected tunnel details', () => {
    const { props } = makeTestApp(['angular']);
    const { lastFrame } = render(<App {...props} />);

    const frame = lastFrame();
    expect(frame).toContain('angular.example.com');
  });

  test('quit confirmation cancelled with n', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('q');
    await delay(50);
    expect(lastFrame()).toContain('Stop all tunnels');

    stdin.write('n');
    await delay(50);
    // Should be back to dashboard
    expect(lastFrame()).not.toContain('Stop all tunnels');
    expect(lastFrame()).toContain('app');
  });

  test('tab switching with 1/2/3 keys', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    // Should start on details tab
    expect(lastFrame()).toContain('Details');

    // Switch to logs tab
    stdin.write('2');
    await delay(50);
    expect(lastFrame()).toContain('Connection Events');

    // Switch to metrics tab
    stdin.write('3');
    await delay(50);
    expect(lastFrame()).toContain('Metrics');

    // Switch back to details
    stdin.write('1');
    await delay(50);
    expect(lastFrame()).toContain('localhost');
  });

  test('a key opens add modal in dashboard mode', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('a');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Add Tunnel');
  });

  test('d key opens delete confirm', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('d');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Delete Tunnel');
    expect(frame).toContain('app');
  });

  test('empty mode renders EmptyState', () => {
    const { props } = makeTestApp([], 'empty');
    const { lastFrame } = render(<App {...props} />);

    const frame = lastFrame();
    expect(frame).toContain('No tunnels configured yet');
  });

  test('empty mode with no tunnels auto-detected', () => {
    const { props } = makeTestApp([]);
    const { lastFrame } = render(<App {...props} />);

    const frame = lastFrame();
    expect(frame).toContain('No tunnels configured yet');
  });

  test('a key works in empty mode', async () => {
    const { props } = makeTestApp([], 'empty');
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('a');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Add Tunnel');
  });

  test('q key works in empty mode', async () => {
    const { props } = makeTestApp([], 'empty');
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('q');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Stop all tunnels and exit');
  });

  test('e key opens edit form', async () => {
    const { props } = makeTestApp(['app']);
    const { lastFrame, stdin } = render(<App {...props} />);

    stdin.write('e');
    await delay(50);

    const frame = lastFrame();
    expect(frame).toContain('Edit');
    expect(frame).toContain('Port');
  });
});
