import { readConfig, writeConfig } from '../config/store.js';
import { logger } from '../utils/logger.js';

export async function removeCommand(name: string, _options: Record<string, unknown>): Promise<void> {
  const config = readConfig();

  if (!config) {
    logger.error('No configuration found. Nothing to remove.');
    process.exit(1);
  }

  if (!config.tunnels[name]) {
    logger.error(`Tunnel "${name}" not found in config.`);
    const names = Object.keys(config.tunnels);
    if (names.length > 0) {
      console.error(`\nConfigured tunnels: ${names.join(', ')}`);
    } else {
      console.error('\nNo tunnels configured.');
    }
    process.exit(1);
  }

  const tunnel = config.tunnels[name];
  delete config.tunnels[name];
  writeConfig(config);

  logger.success(`Removed tunnel "${name}" from config (was ${tunnel.subdomain}.${tunnel.zone} <- :${tunnel.port})`);
  console.error('\nNote: This only removes the local configuration.');
  console.error('To also delete the tunnel from Cloudflare, use `tuinnel down --clean`.');
}
