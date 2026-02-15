import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PIDS_FILE = join(homedir(), '.tuinnel', '.pids.json');

export function readPids(): Record<string, number> {
  try {
    const raw = readFileSync(PIDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

export function writePids(pids: Record<string, number>): void {
  const dir = dirname(PIDS_FILE);
  mkdirSync(dir, { recursive: true });
  const tmp = PIDS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(pids, null, 2), 'utf-8');
  renameSync(tmp, PIDS_FILE);
}

export function writePid(name: string, pid: number): void {
  const pids = readPids();
  pids[name] = pid;
  writePids(pids);
}

export function removePid(name: string): void {
  const pids = readPids();
  delete pids[name];
  writePids(pids);
}

export function isRunning(name: string): { running: boolean; pid?: number } {
  const pids = readPids();
  const pid = pids[name];
  if (pid === undefined) {
    return { running: false };
  }

  if (isProcessAlive(pid)) {
    return { running: true, pid };
  }

  // Stale entry — process is dead, clean up
  removePid(name);
  return { running: false };
}

export function getRunningTunnels(): Array<{ name: string; pid: number }> {
  const pids = readPids();
  const running: Array<{ name: string; pid: number }> = [];
  const stale: string[] = [];

  for (const [name, pid] of Object.entries(pids)) {
    if (isProcessAlive(pid)) {
      running.push({ name, pid });
    } else {
      stale.push(name);
    }
  }

  // Clean up stale entries
  if (stale.length > 0) {
    const cleaned = readPids();
    for (const name of stale) {
      delete cleaned[name];
    }
    writePids(cleaned);
  }

  return running;
}

export function assertNotRunning(name: string): void {
  const status = isRunning(name);
  if (status.running) {
    throw new Error(
      `error: Tunnel '${name}' is already running (PID ${status.pid})\n\nUse \`tuinnel down ${name}\` first.`
    );
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
