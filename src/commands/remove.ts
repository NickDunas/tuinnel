import { readConfig, writeConfig } from '../config/store.js';
import { isRunning } from '../cloudflared/pid.js';
import { logger } from '../utils/logger.js';

export async function removeCommand(name: string, _options: Record<string, unknown>): Promise<void> {
  const config = readConfig();

  if (!config) {
    logger.error('No configuration found. Nothing to remove.');
    process.exitCode = 1;
    return;
  }

  if (!config.tunnels[name]) {
    logger.error(`Tunnel "${name}" not found in config.`);
    const names = Object.keys(config.tunnels);
    if (names.length > 0) {
      console.error(`\nConfigured tunnels: ${names.join(', ')}`);
    } else {
      console.error('\nNo tunnels configured.');
    }
    process.exitCode = 1;
    return;
  }

  // Warn if tunnel is currently running
  const status = isRunning(name);
  if (status.running) {
    logger.warn(`Tunnel "${name}" is currently running (PID ${status.pid}). Stop it first with \`tuinnel down ${name}\`.`);
    process.exitCode = 1;
    return;
  }

  const tunnel = config.tunnels[name];
  delete config.tunnels[name];
  writeConfig(config);

  logger.success(`Removed tunnel "${name}" from config (was ${tunnel.subdomain}.${tunnel.zone} <- :${tunnel.port})`);
  console.error('\nNote: This only removes the local configuration.');
  console.error('To also delete the tunnel from Cloudflare, use `tuinnel down --clean`.');
}
