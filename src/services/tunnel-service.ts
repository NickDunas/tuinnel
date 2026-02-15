import { EventEmitter } from 'events';
import type { TunnelConfig } from '../config/schema.js';
import type { TunnelRuntime, TunnelState } from '../types.js';
import type { CloudflaredProcess } from '../cloudflared/process.js';
import { spawnCloudflared } from '../cloudflared/process.js';
import { ensureBinary } from '../cloudflared/binary.js';
import { writePid, removePid } from '../cloudflared/pid.js';
import {
  createOrGetTunnel,
  updateIngress,
  createOrVerifyDns,
  stopTunnel,
} from '../cloudflare/tunnel-manager.js';
import {
  discoverAccountId,
  getAllZones,
  deleteTunnel as cfDeleteTunnel,
} from '../cloudflare/api.js';
import { readConfig, writeConfig } from '../config/store.js';
import { parseLogLine, extractRegistration, extractMetricsAddr } from '../cloudflared/log-parser.js';
import type { ConnectionEvent } from '../types.js';
import { logger } from '../utils/logger.js';
import { resolveLoopback } from '../utils/port-probe.js';

const MAX_EVENTS = 1000;

export interface TunnelServiceEvents {
  stateChange: { name: string; state: TunnelState; tunnel: TunnelRuntime };
  tunnelAdded: { name: string; tunnel: TunnelRuntime };
  tunnelRemoved: { name: string };
}

export interface CreateOptions {
  port: number;
  subdomain: string;
  zone: string;
  protocol?: 'http' | 'https';
}

function makeRuntime(name: string, config: TunnelConfig): TunnelRuntime {
  return {
    name,
    config,
    state: 'stopped',
    pid: null,
    tunnelId: config.tunnelId ?? null,
    publicUrl: `https://${config.subdomain}.${config.zone}`,
    connectorToken: null,
    metricsPort: null,
    uptime: 0,
    lastError: null,
    connections: [],
  };
}

export class TunnelService extends EventEmitter {
  private tunnels = new Map<string, TunnelRuntime>();
  private processes = new Map<string, CloudflaredProcess>();
  private token: string;

  constructor(token: string) {
    super();
    this.token = token;
  }

  // -- Query --

  getAll(): Map<string, TunnelRuntime> {
    return new Map(this.tunnels);
  }

  get(name: string): TunnelRuntime | undefined {
    return this.tunnels.get(name);
  }

  // -- Lifecycle --

  async create(opts: CreateOptions): Promise<string> {
    const { port, subdomain, zone, protocol = 'http' } = opts;
    const name = subdomain; // Use subdomain as tunnel name

    if (this.tunnels.has(name)) {
      throw new Error(`Tunnel "${name}" already exists`);
    }

    const config: TunnelConfig = { port, subdomain, zone, protocol, lastState: 'stopped' };
    const runtime = makeRuntime(name, config);
    this.setState(name, runtime, 'creating');

    try {
      const accountId = await discoverAccountId(this.token);
      const hostname = `${subdomain}.${zone}`;

      // Find zone ID
      const zones = await getAllZones(this.token);
      const zoneObj = zones.find((z) => z.name === zone);
      if (!zoneObj) {
        throw new Error(
          `Zone "${zone}" not found in your Cloudflare account.\n` +
          `Available zones: ${zones.map((z) => z.name).join(', ') || '(none)'}`,
        );
      }

      // Create CF tunnel
      const { tunnelId, connectorToken } = await createOrGetTunnel(accountId, name, this.token);
      runtime.tunnelId = tunnelId;
      runtime.connectorToken = connectorToken;

      // Update ingress
      const loopback = await resolveLoopback(port);
      await updateIngress(accountId, tunnelId, hostname, port, protocol, this.token, loopback);

      // Create DNS
      await createOrVerifyDns(zoneObj.id, hostname, tunnelId, this.token);

      // Save to config
      config.tunnelId = tunnelId;
      this.persistTunnel(name, config);

      this.tunnels.set(name, runtime);
      this.setState(name, runtime, 'stopped');
      this.emit('tunnelAdded', { name, tunnel: runtime });

      return name;
    } catch (err) {
      this.tunnels.delete(name);
      throw err;
    }
  }

  async update(name: string, changes: Partial<Pick<CreateOptions, 'port' | 'subdomain' | 'zone' | 'protocol'>>): Promise<void> {
    const runtime = this.tunnels.get(name);
    if (!runtime) {
      throw new Error(`Tunnel "${name}" not found`);
    }

    const needsRecreate = (changes.subdomain && changes.subdomain !== runtime.config.subdomain) ||
      (changes.zone && changes.zone !== runtime.config.zone);

    // Update config fields
    const updatedConfig: TunnelConfig = {
      ...runtime.config,
      ...changes,
    };

    if (needsRecreate) {
      // Stop, delete CF resources, recreate
      const wasRunning = runtime.state === 'connected' || runtime.state === 'connecting';
      if (this.processes.has(name)) {
        await this.stop(name);
      }
      await this.deleteCloudflareResources(name, runtime);
      this.tunnels.delete(name);

      const newName = changes.subdomain ?? runtime.config.subdomain;
      await this.create({
        port: updatedConfig.port,
        subdomain: updatedConfig.subdomain,
        zone: updatedConfig.zone,
        protocol: updatedConfig.protocol,
      });

      if (wasRunning) {
        await this.start(newName);
      }
    } else {
      // Simple config update (port or protocol change)
      runtime.config = updatedConfig;
      this.persistTunnel(name, updatedConfig);

      // If running, restart to pick up changes
      if (this.processes.has(name)) {
        await this.restart(name);
      }
    }
  }

  async delete(name: string): Promise<void> {
    const runtime = this.tunnels.get(name);
    if (!runtime) {
      throw new Error(`Tunnel "${name}" not found`);
    }

    // Stop process if running
    if (this.processes.has(name)) {
      await this.stop(name);
    }

    // Delete CF resources
    await this.deleteCloudflareResources(name, runtime);

    // Remove from config
    this.removeTunnelFromConfig(name);

    this.tunnels.delete(name);
    this.emit('tunnelRemoved', { name });
  }

  async start(name: string): Promise<void> {
    const runtime = this.tunnels.get(name);
    if (!runtime) {
      throw new Error(`Tunnel "${name}" not found`);
    }

    if (this.processes.has(name)) {
      throw new Error(`Tunnel "${name}" is already running`);
    }

    this.setState(name, runtime, 'connecting');

    try {
      const accountId = await discoverAccountId(this.token);
      const hostname = `${runtime.config.subdomain}.${runtime.config.zone}`;

      // Ensure we have a tunnelId
      let tunnelId = runtime.tunnelId;
      let connectorToken = runtime.connectorToken;

      if (!tunnelId || !connectorToken) {
        const result = await createOrGetTunnel(accountId, name, this.token);
        tunnelId = result.tunnelId;
        connectorToken = result.connectorToken;
        runtime.tunnelId = tunnelId;
        runtime.connectorToken = connectorToken;
      }

      // Update ingress (always, to correct drift)
      const loopback = await resolveLoopback(runtime.config.port);
      await updateIngress(
        accountId, tunnelId, hostname,
        runtime.config.port, runtime.config.protocol, this.token, loopback,
      );

      // Create or verify DNS CNAME record
      const zones = await getAllZones(this.token);
      const zoneObj = zones.find((z) => z.name === runtime.config.zone);
      if (zoneObj) {
        await createOrVerifyDns(zoneObj.id, hostname, tunnelId, this.token);
      } else {
        logger.warn(`Zone "${runtime.config.zone}" not found — DNS record may be missing`);
      }

      // Spawn cloudflared
      const binaryPath = await ensureBinary();
      const proc = spawnCloudflared(binaryPath, connectorToken);
      this.processes.set(name, proc);

      if (proc.pid) {
        writePid(name, proc.pid);
        runtime.pid = proc.pid;
      }

      // Listen for process exit
      proc.child.once('exit', (code) => {
        this.processes.delete(name);
        removePid(name);
        runtime.pid = null;
        if (runtime.state !== 'stopped') {
          this.setState(name, runtime, code === 0 ? 'disconnected' : 'error');
          if (code !== 0) {
            runtime.lastError = `cloudflared exited with code ${code}`;
          }
        }
      });

      // Parse stderr for metrics port, connection state, and log events
      proc.onStderr((line) => {
        // Detect metrics server address
        const addr = extractMetricsAddr(line);
        if (addr) {
          const port = parseInt(addr.split(':')[1], 10);
          if (!isNaN(port)) runtime.metricsPort = port;
        }

        // Parse structured log line
        const parsed = parseLogLine(line);
        if (parsed) {
          const reg = extractRegistration(line);
          const event: ConnectionEvent = {
            timestamp: parsed.timestamp,
            level: parsed.level,
            message: parsed.message,
            ...(reg && {
              connIndex: reg.connIndex,
              connectionId: reg.connectionId,
              location: reg.location,
              edgeIp: reg.edgeIp,
              protocol: reg.protocol,
            }),
          };
          runtime.connections = runtime.connections.length >= MAX_EVENTS
            ? [...runtime.connections.slice(-MAX_EVENTS + 1), event]
            : [...runtime.connections, event];
          this.emit('stateChange', { name, state: runtime.state, tunnel: runtime });

          // Detect successful connection
          if (reg) {
            this.setState(name, runtime, 'connected');
            runtime.uptime = Date.now();
          }
        }
      });

      // Update persisted state
      this.persistTunnelState(name, 'running');
    } catch (err) {
      this.setState(name, runtime, 'error');
      runtime.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async stop(name: string): Promise<void> {
    const runtime = this.tunnels.get(name);
    if (!runtime) {
      throw new Error(`Tunnel "${name}" not found`);
    }

    const proc = this.processes.get(name);
    if (!proc) {
      this.setState(name, runtime, 'stopped');
      return;
    }

    await proc.kill();
    this.processes.delete(name);
    removePid(name);
    runtime.pid = null;
    runtime.metricsPort = null;
    runtime.uptime = 0;
    this.setState(name, runtime, 'stopped');
    this.persistTunnelState(name, 'stopped');
  }

  async restart(name: string): Promise<void> {
    const runtime = this.tunnels.get(name);
    if (!runtime) {
      throw new Error(`Tunnel "${name}" not found`);
    }

    this.setState(name, runtime, 'restarting');
    await this.stop(name);
    await this.start(name);
  }

  // -- Batch operations --

  loadFromConfig(): void {
    const config = readConfig();
    if (!config) return;

    for (const [name, tunnelConfig] of Object.entries(config.tunnels)) {
      if (!this.tunnels.has(name)) {
        const runtime = makeRuntime(name, tunnelConfig);
        this.tunnels.set(name, runtime);
      }
    }
  }

  /** Adopt an already-running tunnel process so TunnelService manages it */
  adopt(name: string, proc: CloudflaredProcess, info: { tunnelId: string; connectorToken: string; publicUrl: string }): void {
    const runtime = this.tunnels.get(name);
    if (!runtime) return;

    runtime.tunnelId = info.tunnelId;
    runtime.connectorToken = info.connectorToken;
    runtime.publicUrl = info.publicUrl;
    runtime.pid = proc.pid ?? null;
    this.processes.set(name, proc);

    // Wire up process exit
    proc.child.once('exit', (code) => {
      this.processes.delete(name);
      removePid(name);
      runtime.pid = null;
      if (runtime.state !== 'stopped') {
        this.setState(name, runtime, code === 0 ? 'disconnected' : 'error');
        if (code !== 0) {
          runtime.lastError = `cloudflared exited with code ${code}`;
        }
      }
    });

    // Wire up stderr log parsing
    proc.onStderr((line) => {
      const addr = extractMetricsAddr(line);
      if (addr) {
        const port = parseInt(addr.split(':')[1], 10);
        if (!isNaN(port)) runtime.metricsPort = port;
      }

      const parsed = parseLogLine(line);
      if (parsed) {
        const reg = extractRegistration(line);
        const event: ConnectionEvent = {
          timestamp: parsed.timestamp,
          level: parsed.level,
          message: parsed.message,
          ...(reg && {
            connIndex: reg.connIndex,
            connectionId: reg.connectionId,
            location: reg.location,
            edgeIp: reg.edgeIp,
            protocol: reg.protocol,
          }),
        };
        runtime.connections = runtime.connections.length >= MAX_EVENTS
          ? [...runtime.connections.slice(-MAX_EVENTS + 1), event]
          : [...runtime.connections, event];
        this.emit('stateChange', { name, state: runtime.state, tunnel: runtime });

        if (reg) {
          this.setState(name, runtime, 'connected');
          runtime.uptime = Date.now();
        }
      }
    });

    this.setState(name, runtime, 'connecting');
  }

  async autoStart(): Promise<void> {
    for (const [name, runtime] of this.tunnels) {
      if (runtime.config.lastState === 'running') {
        try {
          await this.start(name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to auto-start tunnel "${name}": ${msg}`);
        }
      }
    }
  }

  saveState(): void {
    const config = readConfig();
    if (!config) return;

    for (const [name, runtime] of this.tunnels) {
      if (config.tunnels[name]) {
        const isRunning = this.processes.has(name);
        config.tunnels[name] = {
          ...config.tunnels[name],
          lastState: isRunning ? 'running' : 'stopped',
        };
      }
    }

    writeConfig(config);
  }

  async shutdown(): Promise<void> {
    this.saveState();

    const stopPromises: Promise<void>[] = [];
    for (const name of this.processes.keys()) {
      stopPromises.push(this.stop(name));
    }
    await Promise.allSettled(stopPromises);
  }

  // -- Private helpers --

  private setState(name: string, runtime: TunnelRuntime, state: TunnelState): void {
    runtime.state = state;
    this.emit('stateChange', { name, state, tunnel: runtime });
  }

  private persistTunnel(name: string, tunnelConfig: TunnelConfig): void {
    const config = readConfig() ?? { version: 1 as const, tunnels: {} };
    config.tunnels[name] = tunnelConfig;
    writeConfig(config);
  }

  private persistTunnelState(name: string, lastState: 'running' | 'stopped'): void {
    const config = readConfig();
    if (!config || !config.tunnels[name]) return;
    config.tunnels[name] = { ...config.tunnels[name], lastState };
    writeConfig(config);
  }

  private removeTunnelFromConfig(name: string): void {
    const config = readConfig();
    if (!config) return;
    delete config.tunnels[name];
    writeConfig(config);
  }

  private async deleteCloudflareResources(name: string, runtime: TunnelRuntime): Promise<void> {
    if (!runtime.tunnelId) return;

    try {
      const accountId = await discoverAccountId(this.token);
      await cfDeleteTunnel(accountId, runtime.tunnelId, this.token);
      logger.info(`Deleted CF tunnel for "${name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Could not delete CF tunnel for "${name}": ${msg}`);
    }
  }
}
