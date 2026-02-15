import { createInterface } from 'readline';
import { readConfig, getToken } from '../config/store.js';
import { discoverAccountId, getAllTunnels, deleteTunnel } from '../cloudflare/api.js';
import { readPids, writePids } from '../cloudflared/pid.js';
import { logger } from '../utils/logger.js';

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function purgeCommand(): Promise<void> {
  const token = getToken();

  logger.info('Discovering account...');
  const accountId = await discoverAccountId(token);

  logger.info('Scanning for tuinnel-managed tunnels...');
  const allTunnels = await getAllTunnels(accountId, token);

  // Filter for tuinnel-managed tunnels (name starts with "tuinnel-")
  const managedTunnels = allTunnels.filter(t => t.name.startsWith('tuinnel-'));

  // Cross-reference with local config
  const config = readConfig();
  const configuredNames = config ? Object.keys(config.tunnels) : [];
  const configuredCfNames = new Set(configuredNames.map(n => `tuinnel-${n}`));

  const orphaned = managedTunnels.filter(t => !configuredCfNames.has(t.name));

  // Also clean up stale PID entries
  const pids = readPids();
  const stalePids: string[] = [];
  for (const name of Object.keys(pids)) {
    try {
      process.kill(pids[name], 0);
    } catch {
      stalePids.push(name);
    }
  }

  if (orphaned.length === 0 && stalePids.length === 0) {
    logger.info('No orphaned tunnels found.');
    return;
  }

  if (orphaned.length > 0) {
    console.error(`\nFound ${orphaned.length} orphaned tunnel${orphaned.length !== 1 ? 's' : ''} on Cloudflare:`);
    for (const t of orphaned) {
      console.error(`  - ${t.name} (id: ${t.id.substring(0, 8)}..., status: ${t.status})`);
    }
  }

  if (stalePids.length > 0) {
    console.error(`\nFound ${stalePids.length} stale PID entr${stalePids.length !== 1 ? 'ies' : 'y'}:`);
    for (const name of stalePids) {
      console.error(`  - ${name} (PID ${pids[name]}, process dead)`);
    }
  }

  if (!process.stdin.isTTY) {
    logger.error('Cannot prompt for confirmation in non-interactive mode.\nRe-run in an interactive terminal.');
    process.exitCode = 2;
    return;
  }

  const answer = await prompt('\nClean up these resources? (y/N) ');
  if (answer.toLowerCase() !== 'y') {
    logger.info('Cancelled.');
    return;
  }

  // Delete orphaned tunnels
  let deleted = 0;
  for (const t of orphaned) {
    try {
      await deleteTunnel(accountId, t.id, token);
      logger.success(`Deleted tunnel ${t.name}`);
      deleted++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`Failed to delete ${t.name}: ${msg}`);
    }
  }

  // Clean stale PIDs
  if (stalePids.length > 0) {
    const cleaned = readPids();
    for (const name of stalePids) {
      delete cleaned[name];
    }
    writePids(cleaned);
    logger.success(`Cleaned ${stalePids.length} stale PID entr${stalePids.length !== 1 ? 'ies' : 'y'}.`);
  }

  if (deleted > 0) {
    logger.success(`Purged ${deleted} orphaned tunnel${deleted !== 1 ? 's' : ''}.`);
  }
}
