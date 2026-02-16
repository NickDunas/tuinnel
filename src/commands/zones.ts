import Table from 'cli-table3';
import { getToken } from '../config/store.js';
import { getAllZones } from '../cloudflare/api.js';
import { logger } from '../utils/logger.js';

export async function zonesCommand(options: { json?: boolean }): Promise<void> {
  try {
    const token = getToken();
    const zones = await getAllZones(token);

    if (zones.length === 0) {
      logger.info('No zones found.');
      return;
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(zones, null, 2) + '\n');
      return;
    }

    const table = new Table({
      head: ['Name', 'Status', 'ID'],
      style: { head: ['cyan'] },
    });

    for (const zone of zones) {
      table.push([
        zone.name,
        zone.status,
        zone.id.substring(0, 12) + '...',
      ]);
    }

    console.log(table.toString());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
  }
}
