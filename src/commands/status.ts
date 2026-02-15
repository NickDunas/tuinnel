import Table from 'cli-table3';
import { readConfig } from '../config/store.js';
import { getRunningTunnels } from '../cloudflared/pid.js';
import { probePort } from '../utils/port-probe.js';
import { logger } from '../utils/logger.js';

interface TunnelStatus {
  name: string;
  publicUrl: string;
  localPort: number;
  status: 'connected' | 'port_down' | 'stopped';
  pid: number;
}

export async function statusCommand(options: { json?: boolean }): Promise<void> {
  const running = getRunningTunnels();

  if (running.length === 0) {
    if (options.json) {
      process.stdout.write('[]\n');
      return;
    }
    logger.info('No tunnels currently running. Start one with `tuinnel up`.');
    return;
  }

  const config = readConfig();
  const statuses: TunnelStatus[] = [];

  for (const { name, pid } of running) {
    const tunnelConfig = config?.tunnels[name];
    const port = tunnelConfig?.port ?? 0;
    const publicUrl = tunnelConfig
      ? `https://${tunnelConfig.subdomain}.${tunnelConfig.zone}`
      : 'unknown';

    let status: TunnelStatus['status'] = 'connected';
    if (port > 0) {
      const portAlive = await probePort(port);
      if (!portAlive) {
        status = 'port_down';
      }
    }

    statuses.push({ name, publicUrl, localPort: port, status, pid });
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(statuses, null, 2) + '\n');
    return;
  }

  const table = new Table({
    head: ['Name', 'Public URL', 'Port', 'Status', 'PID'],
    style: { head: ['cyan'] },
  });

  for (const s of statuses) {
    const statusLabel = s.status === 'connected' ? 'connected'
      : s.status === 'port_down' ? 'port down'
      : 'stopped';

    table.push([
      s.name,
      s.publicUrl,
      String(s.localPort),
      statusLabel,
      String(s.pid),
    ]);
  }

  console.log(table.toString());
}
