import {
  createTunnel,
  getTunnelByName,
  getTunnelToken,
  updateTunnelConfig,
  deleteTunnel,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  listDnsRecords,
  discoverAccountId,
  getAllZones,
} from './api.js';
import type { Tunnel, DNSRecord } from './types.js';
import { buildSingleIngress } from '../cloudflared/config.js';
import { spawnCloudflared, type CloudflaredProcess } from '../cloudflared/process.js';
import { ensureBinary } from '../cloudflared/binary.js';
import { writePid, removePid } from '../cloudflared/pid.js';
import { logger } from '../utils/logger.js';
import { resolveLoopback } from '../utils/port-probe.js';

/** Naming convention: CF tunnel names are prefixed to avoid collisions */
const TUNNEL_PREFIX = 'tuinnel-';

function cfTunnelName(name: string): string {
  return `${TUNNEL_PREFIX}${name}`;
}

// -- Step 1: Create or get tunnel --

export interface TunnelInfo {
  tunnelId: string;
  connectorToken: string;
}

export async function createOrGetTunnel(
  accountId: string,
  name: string,
  token: string,
): Promise<TunnelInfo> {
  const cfName = cfTunnelName(name);
  let tunnel: Tunnel;

  try {
    tunnel = await createTunnel(accountId, cfName, token);
  } catch (err: unknown) {
    // 409 means tunnel already exists — fetch it by name
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already') || message.includes('409')) {
      const existing = await getTunnelByName(accountId, cfName, token);
      if (!existing) {
        throw new Error(`Tunnel "${cfName}" reported as existing but could not be found.`);
      }
      tunnel = existing;
    } else {
      throw err;
    }
  }

  const connectorToken = await getTunnelToken(accountId, tunnel.id, token);

  return { tunnelId: tunnel.id, connectorToken };
}

// -- Step 2: Update ingress config --

export async function updateIngress(
  accountId: string,
  tunnelId: string,
  hostname: string,
  port: number,
  protocol: 'http' | 'https',
  token: string,
  loopbackAddr: string = '127.0.0.1',
): Promise<void> {
  const config = buildSingleIngress(hostname, port, protocol, loopbackAddr);
  await updateTunnelConfig(accountId, tunnelId, config, token);
}

// -- Step 3: Create or verify DNS --

export interface DnsResult {
  recordId: string;
  created: boolean;
  conflict?: string; // Existing CNAME content if pointing to different tunnel
}

export async function createOrVerifyDns(
  zoneId: string,
  hostname: string,
  tunnelId: string,
  token: string,
): Promise<DnsResult> {
  const tunnelCname = `${tunnelId}.cfargotunnel.com`;

  // Check for existing CNAME record
  const existingRecords: DNSRecord[] = [];
  for await (const record of listDnsRecords(zoneId, token, {
    type: 'CNAME',
    name: hostname,
  })) {
    existingRecords.push(record);
  }

  const existing = existingRecords.find(
    (r) => r.type === 'CNAME' && r.name === hostname,
  );

  if (existing) {
    if (existing.content === tunnelCname) {
      // Already points to our tunnel — no-op
      return { recordId: existing.id, created: false };
    }
    // Points to a different tunnel — update to current tunnel
    const updated = await updateDnsRecord(
      zoneId,
      existing.id,
      { type: 'CNAME', name: hostname, content: tunnelCname, proxied: true, ttl: 1 },
      token,
    );
    return { recordId: updated.id, created: false, conflict: existing.content };
  }

  // Create new CNAME record
  const record = await createDnsRecord(
    zoneId,
    {
      type: 'CNAME',
      name: hostname,
      content: tunnelCname,
      proxied: true,
      ttl: 1, // Auto TTL when proxied
    },
    token,
  );

  return { recordId: record.id, created: true };
}

// -- Step 4: Full startup sequence --

/** Resources created during startup, for cleanup on failure */
interface CreatedResources {
  tunnelId?: string;
  dnsRecordId?: string;
  dnsZoneId?: string;
  process?: CloudflaredProcess;
  accountId: string;
  token: string;
}

export interface StartedTunnel {
  tunnelId: string;
  connectorToken: string;
  dnsRecordId: string;
  process: CloudflaredProcess;
  publicUrl: string;
}

export async function startTunnel(
  name: string,
  config: { port: number; subdomain: string; zone: string; protocol: 'http' | 'https' },
  token: string,
): Promise<StartedTunnel> {
  const accountId = await discoverAccountId(token);
  const hostname = `${config.subdomain}.${config.zone}`;

  // Find zone ID for DNS operations
  const zones = await getAllZones(token);
  const zone = zones.find((z) => z.name === config.zone);
  if (!zone) {
    throw new Error(
      `Zone "${config.zone}" not found in your Cloudflare account.\n` +
      `Available zones: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
    );
  }

  const resources: CreatedResources = { accountId, token };

  try {
    // Step 1: Create or get tunnel
    logger.info(`Creating tunnel "${name}"...`);
    const { tunnelId, connectorToken } = await createOrGetTunnel(accountId, name, token);
    resources.tunnelId = tunnelId;

    // Step 2: Update ingress config (always, to correct drift)
    const loopback = await resolveLoopback(config.port);
    logger.info(`Configuring ingress: ${hostname} -> ${config.protocol}://${loopback}:${config.port}`);
    await updateIngress(accountId, tunnelId, hostname, config.port, config.protocol, token, loopback);

    // Step 3: Create or verify DNS
    logger.info(`Setting up DNS: ${hostname}`);
    const dnsResult = await createOrVerifyDns(zone.id, hostname, tunnelId, token);
    resources.dnsRecordId = dnsResult.recordId;
    resources.dnsZoneId = zone.id;

    if (dnsResult.conflict) {
      logger.info(`DNS record ${hostname} updated (was pointing to ${dnsResult.conflict})`);
    }

    if (dnsResult.created) {
      logger.success(`DNS record created: ${hostname}`);
    }

    // Step 4: Spawn cloudflared connector
    logger.info('Starting cloudflared connector...');
    const binaryPath = await ensureBinary();
    const proc = spawnCloudflared(binaryPath, connectorToken);
    resources.process = proc;

    // Track PID for concurrent instance protection
    if (proc.pid) {
      writePid(name, proc.pid);
    }

    return {
      tunnelId,
      connectorToken,
      dnsRecordId: dnsResult.recordId,
      process: proc,
      publicUrl: `https://${hostname}`,
    };
  } catch (err) {
    // Best-effort cleanup on failure
    await cleanupOnFailure(resources);
    throw err;
  }
}

// -- Teardown --

export async function stopTunnel(
  name: string,
  process: CloudflaredProcess,
  clean: boolean,
  cleanupInfo?: {
    accountId: string;
    tunnelId: string;
    dnsZoneId: string;
    dnsRecordId: string;
    token: string;
  },
): Promise<void> {
  // Kill the cloudflared process
  await process.kill();

  // Remove PID tracking
  removePid(name);

  if (clean && cleanupInfo) {
    const { accountId, tunnelId, dnsZoneId, dnsRecordId, token } = cleanupInfo;

    // Delete DNS record
    try {
      await deleteDnsRecord(dnsZoneId, dnsRecordId, token);
      logger.success('DNS record deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not delete DNS record: ${msg}`);
    }

    // Delete tunnel
    try {
      await deleteTunnel(accountId, tunnelId, token);
      logger.success('Tunnel deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not delete tunnel: ${msg}`);
    }
  }
}

// -- Cleanup on failure --

async function cleanupOnFailure(resources: CreatedResources): Promise<void> {
  const failures: string[] = [];

  // Kill process first
  if (resources.process) {
    try {
      await resources.process.kill();
    } catch {
      failures.push('cloudflared process');
    }
  }

  // Delete DNS record (reverse order)
  if (resources.dnsRecordId && resources.dnsZoneId) {
    try {
      await deleteDnsRecord(resources.dnsZoneId, resources.dnsRecordId, resources.token);
      logger.info('Cleaned up DNS record');
    } catch {
      failures.push(`DNS record ${resources.dnsRecordId}`);
    }
  }

  // Delete tunnel
  if (resources.tunnelId) {
    try {
      await deleteTunnel(resources.accountId, resources.tunnelId, resources.token);
      logger.info('Cleaned up tunnel');
    } catch {
      failures.push(`tunnel ${resources.tunnelId}`);
    }
  }

  if (failures.length > 0) {
    logger.warn(
      `Some resources could not be cleaned up: ${failures.join(', ')}\n` +
      `Run \`tuinnel purge\` to remove orphaned resources.`,
    );
  }
}
