import React from 'react';
import { render } from 'ink';
import { App, type AppMode } from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { TunnelService } from '../services/tunnel-service.js';
import { readConfig, configExists } from '../config/store.js';
import { getAllZones } from '../cloudflare/api.js';
import type { StartedTunnel } from '../cloudflare/tunnel-manager.js';

export interface LaunchTuiOptions {
  token: string;
  adoptTunnels?: Array<{ name: string; started: StartedTunnel }>;
  initialMode?: AppMode;
  autoStart?: boolean;
}

export async function launchTui(options: LaunchTuiOptions): Promise<void> {
  const tunnelService = new TunnelService(options.token);

  // Fetch zones (silent failure)
  let zones: Array<{ id: string; name: string }> = [];
  if (options.token) {
    try {
      const allZones = await getAllZones(options.token);
      zones = allZones.map((z) => ({ id: z.id, name: z.name }));
    } catch {
      // Continue without zones
    }
  }

  // Determine defaultZone from config or zones[0]
  const config = configExists() ? readConfig() : null;
  const defaultZone = config?.defaultZone ?? zones[0]?.name ?? '';

  // Auto-determine initialMode if not provided
  let initialMode: AppMode;
  if (options.initialMode) {
    initialMode = options.initialMode;
  } else if (!options.token) {
    initialMode = 'onboarding';
  } else if (config && Object.keys(config.tunnels).length > 0) {
    initialMode = 'dashboard';
  } else {
    initialMode = 'empty';
  }

  // Load config or adopt tunnels
  if (initialMode === 'dashboard' || options.adoptTunnels?.length) {
    tunnelService.loadFromConfig();
  }

  if (options.adoptTunnels) {
    for (const { name, started } of options.adoptTunnels) {
      tunnelService.adopt(name, started.process, {
        tunnelId: started.tunnelId,
        connectorToken: started.connectorToken,
        publicUrl: started.publicUrl,
      });
    }
  }

  const handleShutdown = async () => {
    await tunnelService.shutdown();
  };

  const app = render(
    React.createElement(
      ErrorBoundary,
      null,
      React.createElement(App, {
        tunnelService,
        zones,
        defaultZone,
        onShutdown: handleShutdown,
        initialMode,
      }),
    ),
  );

  // Auto-start tunnels with lastState='running' after render
  if (options.autoStart && initialMode === 'dashboard') {
    tunnelService.autoStart().catch(() => {});
  }

  await app.waitUntilExit();
}
