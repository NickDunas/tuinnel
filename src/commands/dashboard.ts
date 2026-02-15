import React from 'react';
import { render } from 'ink';
import { App } from '../tui/App.js';
import { TunnelService } from '../services/tunnel-service.js';
import { readConfig, configExists, getToken } from '../config/store.js';
import { getAllZones } from '../cloudflare/api.js';
import type { AppMode } from '../tui/App.js';

export async function openDashboard(quickPort?: number): Promise<void> {
  // Resolve API token
  let token: string | null = null;
  try {
    token = getToken();
  } catch {
    // No token — will show onboarding
  }

  let initialMode: AppMode = 'onboarding';
  let zones: Array<{ id: string; name: string }> = [];
  let defaultZone = '';

  if (token) {
    try {
      const allZones = await getAllZones(token);
      zones = allZones.map((z) => ({ id: z.id, name: z.name }));
    } catch {
      // Zone fetch failed — still proceed with empty zones
    }

    const config = configExists() ? readConfig() : null;
    defaultZone = config?.defaultZone ?? zones[0]?.name ?? '';

    if (config && Object.keys(config.tunnels).length > 0) {
      initialMode = 'dashboard';
    } else {
      initialMode = 'empty';
    }
  }

  const tunnelService = new TunnelService(token ?? '');

  if (initialMode === 'dashboard') {
    tunnelService.loadFromConfig();
  }

  const handleShutdown = async () => {
    await tunnelService.shutdown();
  };

  const app = render(
    React.createElement(App, {
      tunnelService,
      zones,
      defaultZone,
      onShutdown: handleShutdown,
      initialMode,
    }),
  );

  // Auto-start tunnels with lastState='running' after render
  if (initialMode === 'dashboard') {
    tunnelService.autoStart().catch(() => {});
  }

  await app.waitUntilExit();
}
