import { getRunningTunnels, removePid } from '../cloudflared/pid.js';
import { readConfig, getToken } from '../config/store.js';
import { discoverAccountId, listDnsRecords, deleteDnsRecord, deleteTunnel, getTunnelByName, getAllZones } from '../cloudflare/api.js';
import type { DNSRecord } from '../cloudflare/types.js';
import { logger } from '../utils/logger.js';
import { createInterface } from 'readline';

interface DownOptions {
  clean?: boolean;
  all?: boolean;
}

export async function downCommand(names: string[], options: DownOptions): Promise<void> {
  const running = getRunningTunnels();

  if (running.length === 0) {
    logger.info('No tunnels are currently running.');
    return;
  }

  let tunnelsToStop: Array<{ name: string; pid: number }>;

  if (names.length > 0) {
    // Stop specific named tunnels
    tunnelsToStop = [];
    for (const name of names) {
      const match = running.find(t => t.name === name);
      if (!match) {
        logger.error(`Tunnel '${name}' is not running.`);
        continue;
      }
      tunnelsToStop.push(match);
    }
  } else if (options.all) {
    // Stop all tunnels, no confirmation
    tunnelsToStop = running;
  } else if (!process.stdin.isTTY) {
    // Non-interactive, no names, no --all flag
    logger.error(
      'No tunnel names specified.\n\n' +
      'In non-interactive mode, specify tunnel names or use --all:\n' +
      '  tuinnel down myapp\n' +
      '  tuinnel down --all'
    );
    process.exitCode = 2;
    return;
  } else {
    // Interactive: prompt user
    const tunnelNames = running.map(t => t.name).join(', ');
    const confirmed = await confirm(
      `Stop all ${running.length} running tunnel(s)? (${tunnelNames}) (y/N) `
    );
    if (!confirmed) {
      logger.info('Cancelled.');
      return;
    }
    tunnelsToStop = running;
  }

  if (tunnelsToStop.length === 0) {
    return;
  }

  for (const tunnel of tunnelsToStop) {
    await stopOne(tunnel, options.clean ?? false);
  }
}

async function stopOne(
  tunnel: { name: string; pid: number },
  clean: boolean,
): Promise<void> {
  // Kill the process
  try {
    process.kill(tunnel.pid, 'SIGTERM');

    // Wait for process to exit (up to 5s)
    const exited = await waitForProcessExit(tunnel.pid, 5000);
    if (!exited) {
      try {
        process.kill(tunnel.pid, 'SIGKILL');
      } catch {
        // Process may have already exited
      }
    }
  } catch {
    // Process may have already exited
  }

  removePid(tunnel.name);
  logger.success(`Stopped tunnel '${tunnel.name}'`);

  if (clean) {
    await cleanupCloudflare(tunnel.name);
  }
}

async function cleanupCloudflare(name: string): Promise<void> {
  let token: string;
  try {
    token = getToken();
  } catch {
    logger.warn('No API token available, skipping cloud cleanup.');
    return;
  }

  try {
    const accountId = await discoverAccountId(token);
    const cfName = `tuinnel-${name}`;

    // Find the tunnel
    const existingTunnel = await getTunnelByName(accountId, cfName, token);
    if (!existingTunnel) {
      logger.warn(`Tunnel '${cfName}' not found on Cloudflare, skipping cleanup.`);
      return;
    }

    // Find and delete DNS records pointing to this tunnel
    const config = readConfig();
    const tunnelConfig = config?.tunnels[name];
    if (tunnelConfig) {
      const hostname = `${tunnelConfig.subdomain}.${tunnelConfig.zone}`;
      try {
        // We need the zone ID; find it from the tunnel config
        const zones = await getAllZones(token);
        const zone = zones.find(z => z.name === tunnelConfig.zone);
        if (zone) {
          const records: DNSRecord[] = [];
          for await (const record of listDnsRecords(zone.id, token, {
            type: 'CNAME',
            name: hostname,
          })) {
            records.push(record);
          }
          for (const record of records) {
            await deleteDnsRecord(zone.id, record.id, token);
          }
          if (records.length > 0) {
            logger.success(`Deleted DNS record for ${hostname}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Could not delete DNS record: ${msg}`);
      }
    }

    // Delete the tunnel
    try {
      await deleteTunnel(accountId, existingTunnel.id, token);
      logger.success(`Deleted tunnel '${name}' from Cloudflare`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not delete tunnel: ${msg}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Cleanup failed: ${msg}`);
    logger.info('Run `tuinnel purge` to clean orphaned resources.');
  }
}

function waitForProcessExit(pid: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      try {
        process.kill(pid, 0);
        // Still alive
        if (Date.now() - start > timeout) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      } catch {
        // Process has exited
        resolve(true);
      }
    };
    check();
  });
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
