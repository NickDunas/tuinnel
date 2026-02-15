import Table from 'cli-table3';
import { readConfig } from '../config/store.js';
import { logger } from '../utils/logger.js';

export async function listCommand(options: { json?: boolean }): Promise<void> {
  const config = readConfig();

  if (!config || Object.keys(config.tunnels).length === 0) {
    if (options.json) {
      process.stdout.write('[]\n');
      return;
    }
    logger.info('No tunnels configured. Run `tuinnel add <port>` or `tuinnel up <port>`.');
    return;
  }

  const tunnels = Object.entries(config.tunnels).map(([name, tunnel]) => ({
    name,
    port: tunnel.port,
    hostname: `${tunnel.subdomain}.${tunnel.zone}`,
    protocol: tunnel.protocol,
  }));

  if (options.json) {
    process.stdout.write(JSON.stringify(tunnels, null, 2) + '\n');
    return;
  }

  const table = new Table({
    head: ['Name', 'Port', 'Hostname', 'Protocol'],
    style: { head: ['cyan'] },
  });

  for (const t of tunnels) {
    table.push([t.name, String(t.port), t.hostname, t.protocol]);
  }

  console.log(table.toString());
}
