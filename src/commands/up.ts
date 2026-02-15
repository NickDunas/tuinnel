import React from 'react';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readConfig, writeConfig, configExists, getDefaultConfig, getToken as getTokenOrThrow } from '../config/store.js';
import { suggestSubdomain } from '../config/port-map.js';
import { ensureBinary } from '../cloudflared/binary.js';
import { startTunnel, type StartedTunnel } from '../cloudflare/tunnel-manager.js';
import { setupSignalHandlers, gracefulShutdown } from '../cloudflared/process.js';
import { extractQuickTunnelUrl } from '../cloudflared/log-parser.js';
import { assertNotRunning, removePid } from '../cloudflared/pid.js';
import { logger } from '../utils/logger.js';
import { resolveLoopback } from '../utils/port-probe.js';
import { TunnelService } from '../services/tunnel-service.js';
import { getAllZones } from '../cloudflare/api.js';
import type { TunnelConfig } from '../config/schema.js';
import type { TunnelRuntime } from '../types.js';

interface UpOptions {
  quick?: boolean;
  tui?: boolean;       // true by default, false with --no-tui
  verbose?: boolean;
  subdomain?: string;
  zone?: string;
}

function validatePort(portStr: string): number {
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    logger.error(`Invalid port: "${portStr}". Must be 1-65535.`);
    process.exit(1);
  }
  return port;
}

/** Returns token or null (for quick-tunnel fallback) */
function getToken(): string | null {
  try {
    return getTokenOrThrow();
  } catch {
    return null;
  }
}

// -- Quick tunnel mode --

async function runQuickTunnels(ports: number[], binaryPath: string): Promise<void> {
  const quickProcesses: Array<{ port: number; child: ReturnType<typeof spawn> }> = [];

  // Graceful shutdown handler
  const shutdown = async () => {
    for (const { child } of quickProcesses) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }
    // Wait briefly for graceful exit
    await new Promise((resolve) => setTimeout(resolve, 2000));
    for (const { child } of quickProcesses) {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  for (const port of ports) {
    const host = await resolveLoopback(port);
    const child = spawn(binaryPath, ['tunnel', '--config', '/dev/null', '--url', `http://${host}:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    quickProcesses.push({ port, child });

    // Parse stderr for the quick tunnel URL
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on('line', (line) => {
        const url = extractQuickTunnelUrl(line);
        if (url) {
          logger.success(`${url} <- :${port}`);
        }
        // In verbose mode or --no-tui, stream all stderr
        if (ports.length === 1) {
          process.stderr.write(`[port:${port}] ${line}\n`);
        }
      });
      child.stderr.on('error', () => {});
    }

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        logger.error(`Quick tunnel on port ${port} exited with code ${code}`);
      }
    });
  }

  logger.info('Quick tunnel(s) starting... Press Ctrl+C to stop.');

  // Keep process alive until all children exit or signal received
  await new Promise<void>((resolve) => {
    let exited = 0;
    for (const { child } of quickProcesses) {
      child.on('exit', () => {
        exited++;
        if (exited >= quickProcesses.length) {
          resolve();
        }
      });
    }
  });
}

// -- Named tunnel mode --

async function promptSubdomain(port: number): Promise<string> {
  const suggestion = suggestSubdomain(port, process.cwd());
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Subdomain for port ${port}: ${suggestion} — accept? (Y/n) `, (a) => resolve(a.trim()));
    });
    if (answer.toLowerCase() === 'n') {
      const custom = await new Promise<string>((resolve) => {
        rl.question('Enter subdomain: ', (a) => resolve(a.trim()));
      });
      if (!custom) {
        logger.error('No subdomain provided.');
        process.exit(1);
      }
      return custom.toLowerCase();
    }
    return suggestion;
  } finally {
    rl.close();
  }
}

async function inlineAddFlow(
  port: number,
  options: UpOptions,
  config: ReturnType<typeof readConfig>,
): Promise<{ name: string; tunnelConfig: TunnelConfig }> {
  const isInteractive = process.stdin.isTTY ?? false;

  let subdomain: string;
  if (options.subdomain) {
    subdomain = options.subdomain.toLowerCase();
  } else if (isInteractive) {
    subdomain = await promptSubdomain(port);
  } else {
    logger.error(`Port ${port} not in config. Use --subdomain and --zone in non-interactive mode.`);
    process.exit(1);
  }

  let zone: string;
  if (options.zone) {
    zone = options.zone;
  } else if (config?.defaultZone) {
    zone = config.defaultZone;
  } else if (isInteractive) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      zone = await new Promise<string>((resolve) => {
        rl.question('Enter zone (domain): ', (a) => resolve(a.trim()));
      });
      if (!zone) {
        logger.error('No zone provided. Run `tuinnel init` to set a default zone.');
        process.exit(1);
      }
    } finally {
      rl.close();
    }
  } else {
    logger.error('--zone is required (no default zone configured). Run `tuinnel init` first.');
    process.exit(1);
  }

  const tunnelConfig: TunnelConfig = { port, subdomain, zone, protocol: 'http' };

  // Save to config for future runs
  const cfg = config ?? getDefaultConfig();
  cfg.tunnels[subdomain] = tunnelConfig;
  writeConfig(cfg);

  return { name: subdomain, tunnelConfig };
}

async function runNamedTunnels(
  ports: number[],
  token: string,
  options: UpOptions,
): Promise<void> {
  const config = configExists() ? readConfig() : null;
  const startedTunnels: Array<{ name: string; started: StartedTunnel }> = [];

  // Resolve each port to a tunnel config (from config or inline add)
  const tunnelsToStart: Array<{ name: string; tunnelConfig: TunnelConfig }> = [];

  for (const port of ports) {
    // Look up port in existing config
    let found = false;
    if (config?.tunnels) {
      for (const [name, tc] of Object.entries(config.tunnels)) {
        if (tc.port === port) {
          tunnelsToStart.push({ name, tunnelConfig: tc });
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Inline add flow
      const result = await inlineAddFlow(port, options, config);
      tunnelsToStart.push(result);
    }
  }

  // Set up signal handlers for graceful shutdown
  setupSignalHandlers(() => startedTunnels.map((t) => t.started.process));

  // Start each tunnel sequentially
  const total = tunnelsToStart.length;
  for (let i = 0; i < total; i++) {
    const { name, tunnelConfig } = tunnelsToStart[i];

    try {
      // Check not already running
      assertNotRunning(name);

      // Start the tunnel (4-step sequence, PID tracked internally)
      const started = await startTunnel(name, tunnelConfig, token);

      startedTunnels.push({ name, started });
      logger.success(`${started.publicUrl} <- :${tunnelConfig.port}  (${i + 1}/${total})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to start tunnel "${name}": ${msg}`);
      // Continue with remaining tunnels
    }
  }

  if (startedTunnels.length === 0) {
    logger.error('No tunnels started successfully.');
    process.exit(1);
  }

  // Determine if we should use TUI
  const useTui = options.tui !== false
    && (process.stdout.isTTY ?? false)
    && (process.stdin.isTTY ?? false);

  if (useTui) {
    await runTuiMode(startedTunnels, token!);
  } else {
    if (options.tui !== false && !(process.stdout.isTTY && process.stdin.isTTY)) {
      logger.info('Non-interactive terminal detected. Using --no-tui mode.');
    }
    await runNoTuiMode(startedTunnels);
  }
}

// -- TUI mode --

async function runTuiMode(
  startedTunnels: Array<{ name: string; started: StartedTunnel }>,
  token: string,
): Promise<void> {
  const { render } = await import('ink');
  const { App } = await import('../tui/App.js');

  // Create TunnelService and adopt the already-running tunnels
  const tunnelService = new TunnelService(token);
  tunnelService.loadFromConfig();

  for (const { name, started } of startedTunnels) {
    tunnelService.adopt(name, started.process, {
      tunnelId: started.tunnelId,
      connectorToken: started.connectorToken,
      publicUrl: started.publicUrl,
    });
  }

  // Fetch zones for TUI
  let zones: Array<{ id: string; name: string }> = [];
  try {
    const allZones = await getAllZones(token);
    zones = allZones.map((z) => ({ id: z.id, name: z.name }));
  } catch {
    // Continue without zones
  }

  const config = configExists() ? readConfig() : null;
  const defaultZone = config?.defaultZone ?? zones[0]?.name ?? '';

  const handleShutdown = async () => {
    await tunnelService.shutdown();
  };

  const app = render(
    React.createElement(App, {
      tunnelService,
      zones,
      defaultZone,
      onShutdown: handleShutdown,
      initialMode: 'dashboard' as const,
    }),
  );

  await app.waitUntilExit();
}

// -- No-TUI mode --

async function runNoTuiMode(
  startedTunnels: Array<{ name: string; started: StartedTunnel }>,
): Promise<void> {
  logger.info(`${startedTunnels.length} tunnel(s) running. Press Ctrl+C to stop.`);

  for (const { name, started } of startedTunnels) {
    started.process.onStderr((line) => {
      const prefix = startedTunnels.length > 1 ? `[${name}] ` : '';
      process.stdout.write(`${prefix}${line}\n`);
    });

    started.process.child.on('exit', (code) => {
      removePid(name);
      if (code !== 0 && code !== null) {
        logger.warn(`Tunnel "${name}" exited with code ${code}`);
      }
    });
  }

  // Keep process alive until all children exit
  await new Promise<void>((resolve) => {
    let exited = 0;
    for (const { started } of startedTunnels) {
      started.process.child.on('exit', () => {
        exited++;
        if (exited >= startedTunnels.length) {
          resolve();
        }
      });
    }
  });
}

// -- Main entry point --

export async function upCommand(ports: string[], options: UpOptions): Promise<void> {
  if (ports.length === 0) {
    logger.error('No ports specified.\n\nUsage: tuinnel up <port> [port...]');
    process.exit(1);
  }

  const parsedPorts = ports.map(validatePort);
  const token = getToken();
  const useQuick = options.quick || !token;

  // Ensure cloudflared binary is available
  const binaryPath = await ensureBinary();

  if (useQuick) {
    if (!options.quick && !token) {
      logger.info(
        'No API token configured. Running as quick tunnel (random subdomain).\n' +
        'For custom domains, run `tuinnel init` first.',
      );
    }
    await runQuickTunnels(parsedPorts, binaryPath);
  } else {
    await runNamedTunnels(parsedPorts, token!, options);
  }
}
