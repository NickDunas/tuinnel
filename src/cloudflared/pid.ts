import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const PIDS_FILE = join(homedir(), '.tuinnel', '.pids.json');

interface PidEntry {
  pid: number;
  startedAt: number;
}

type PidStore = Record<string, PidEntry>;

export function readPids(): PidStore {
  try {
    const raw = readFileSync(PIDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      // Migrate old format: number values -> { pid, startedAt }
      const result: PidStore = {};
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value === 'number') {
          result[name] = { pid: value, startedAt: 0 };
        } else if (typeof value === 'object' && value !== null && 'pid' in value) {
          result[name] = value as PidEntry;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

export function writePids(pids: PidStore): void {
  const dir = dirname(PIDS_FILE);
  mkdirSync(dir, { recursive: true });
  const tmp = PIDS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(pids, null, 2), 'utf-8');
  renameSync(tmp, PIDS_FILE);
}

export function writePid(name: string, pid: number): void {
  const pids = readPids();
  pids[name] = { pid, startedAt: Date.now() };
  writePids(pids);
}

export function removePid(name: string): void {
  const pids = readPids();
  delete pids[name];
  writePids(pids);
}

export function isRunning(name: string): { running: boolean; pid?: number } {
  const pids = readPids();
  const entry = pids[name];
  if (!entry) {
    return { running: false };
  }

  if (isProcessAlive(entry.pid)) {
    return { running: true, pid: entry.pid };
  }

  // Stale entry — process is dead, clean up
  removePid(name);
  return { running: false };
}

export function getRunningTunnels(): Array<{ name: string; pid: number }> {
  const pids = readPids();
  const running: Array<{ name: string; pid: number }> = [];
  const stale: string[] = [];

  for (const [name, entry] of Object.entries(pids)) {
    if (isProcessAlive(entry.pid)) {
      running.push({ name, pid: entry.pid });
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
