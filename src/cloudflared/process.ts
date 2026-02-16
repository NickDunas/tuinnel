import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { writeFileSync, chmodSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface SpawnOptions {
  metricsAddr?: string;
  loglevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  protocol?: 'auto' | 'http2' | 'quic';
}

export interface CloudflaredProcess {
  readonly child: ChildProcess;
  readonly pid: number | undefined;
  kill(): Promise<void>;
  onStderr(callback: (line: string) => void): void;
}

export function spawnCloudflared(
  binaryPath: string,
  connectorToken: string,
  options: SpawnOptions = {},
): CloudflaredProcess {
  const {
    metricsAddr = '127.0.0.1:0',
    loglevel = 'info',
    protocol = 'quic',
  } = options;

  // Write token to temp file with secure permissions (0600) to avoid exposing it in `ps aux`
  const tokenFileName = `tuinnel-token-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.txt`;
  const tokenFilePath = join(tmpdir(), tokenFileName);

  try {
    writeFileSync(tokenFilePath, connectorToken, { mode: 0o600 });
    chmodSync(tokenFilePath, 0o600);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create secure token file: ${message}`);
  }

  // IMPORTANT: flags go BEFORE 'run', --token-file goes AFTER 'run'
  const args = [
    'tunnel',
    '--config', '/dev/null',
    '--no-autoupdate',
    '--metrics', metricsAddr,
    '--loglevel', loglevel,
    '--protocol', protocol,
    'run',
    '--token-file', tokenFilePath,
  ];

  const child = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Schedule token file cleanup after cloudflared reads it (500ms)
  const cleanupTimer = setTimeout(() => {
    try { unlinkSync(tokenFilePath); } catch {}
  }, 500);

  // Clean up immediately if child exits early
  child.once('exit', () => {
    clearTimeout(cleanupTimer);
    try { unlinkSync(tokenFilePath); } catch {}
  });

  const stderrCallbacks: Array<(line: string) => void> = [];

  // Set up stderr line reader
  if (child.stderr) {
    const rl = createInterface({ input: child.stderr });
    rl.on('line', (line) => {
      for (const cb of stderrCallbacks) {
        cb(line);
      }
    });
    // Prevent stderr errors from crashing the process
    child.stderr.on('error', () => {});
  }

  return {
    child,
    get pid() {
      return child.pid;
    },
    async kill() {
      if (child.exitCode !== null) return; // Already exited

      child.kill('SIGTERM');

      // Wait up to 5s for graceful exit, then SIGKILL
      let timer: ReturnType<typeof setTimeout>;
      const exited = await Promise.race([
        new Promise<boolean>((resolve) => {
          child.once('exit', () => resolve(true));
        }),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        }),
      ]);

      clearTimeout(timer!);

      if (!exited && child.exitCode === null) {
        child.kill('SIGKILL');
      }
    },
    onStderr(callback: (line: string) => void) {
      stderrCallbacks.push(callback);
    },
  };
}

export function setupSignalHandlers(
  getProcesses: () => CloudflaredProcess[],
): void {
  const shutdown = async () => {
    await gracefulShutdown(getProcesses());
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGPIPE', () => {}); // Ignore
  process.on('SIGHUP', () => {});  // Ignore
}

export async function gracefulShutdown(
  processes: CloudflaredProcess[],
  timeout = 5000,
): Promise<void> {
  // Send SIGTERM to all
  const killPromises = processes.map(p => p.kill());

  // Wait for all to exit (each has its own 5s timeout + SIGKILL fallback)
  await Promise.allSettled(killPromises);
}
