import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

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

  // IMPORTANT: flags go BEFORE 'run', --token goes AFTER 'run'
  const args = [
    'tunnel',
    '--config', '/dev/null',
    '--no-autoupdate',
    '--metrics', metricsAddr,
    '--loglevel', loglevel,
    '--protocol', protocol,
    'run',
    '--token', connectorToken,
  ];

  const child = spawn(binaryPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
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
      const exited = await Promise.race([
        new Promise<boolean>((resolve) => {
          child.once('exit', () => resolve(true));
        }),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 5000);
        }),
      ]);

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
