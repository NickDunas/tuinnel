import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readConfig, configExists, getToken as getTokenOrThrow } from '../config/store.js';
import { addTunnelToConfig } from '../config/tunnel-config.js';
import { ensureBinary } from '../cloudflared/binary.js';
import { startTunnel, type StartedTunnel } from '../cloudflare/tunnel-manager.js';
import { setupSignalHandlers } from '../cloudflared/process.js';
import { extractQuickTunnelUrl } from '../cloudflared/log-parser.js';
import { assertNotRunning, removePid } from '../cloudflared/pid.js';
import { logger } from '../utils/logger.js';
import { resolveLoopback } from '../utils/port-probe.js';
import { validatePort } from '../utils/validation.js';
import { launchTui } from '../tui/launch.js';
import type { TunnelConfig } from '../config/schema.js';

interface UpOptions {
  quick?: boolean;
  tui?: boolean;       // true by default, false with --no-tui
  verbose?: boolean;
  subdomain?: string;
  zone?: string;
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
        process.stderr.write(`[port:${port}] ${line}\n`);
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
      // Add tunnel to config via shared flow
      const result = await addTunnelToConfig({
        port,
        subdomain: options.subdomain,
        zone: options.zone,
        failOnDuplicate: false,
      });
      tunnelsToStart.push({ name: result.name, tunnelConfig: result.config });
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
    process.exitCode = 1;
    return;
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
  await launchTui({
    token,
    adoptTunnels: startedTunnels,
    initialMode: 'dashboard',
  });
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
    process.exitCode = 1;
    return;
  }

  const parsedPorts = ports.map(p => validatePort(p)!);
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
