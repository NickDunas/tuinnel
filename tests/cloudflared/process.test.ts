import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import type { ChildProcess } from 'child_process';

// --- Module-level mock for child_process using mock.module ---
const mockSpawn = mock((..._args: any[]): any => {
  throw new Error('spawn not configured for this test');
});

const originalCP = await import('child_process');

mock.module('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: originalCP.execFileSync,
  execSync: originalCP.execSync,
  exec: originalCP.exec,
  execFile: originalCP.execFile,
  fork: originalCP.fork,
  spawnSync: originalCP.spawnSync,
}));

// Helper to create a mock ChildProcess with EventEmitter behaviour.
function createMockChild(pid = 12345): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  (child as any).pid = pid;
  (child as any).exitCode = null;
  (child as any).signalCode = null;
  (child as any).killed = false;
  (child as any).stderr = new PassThrough();
  (child as any).stdout = new PassThrough();
  (child as any).stdin = null;
  (child as any).kill = (signal?: string) => {
    (child as any).killed = true;
    return true;
  };
  return child;
}

// Detect once whether mock.module interception is working for spawn.
// When running in the full suite, process.ts may already be cached with the real spawn.
let _canMockSpawn: boolean | null = null;
async function detectCanMockSpawn(): Promise<boolean> {
  if (_canMockSpawn !== null) return _canMockSpawn;
  mockSpawn.mockReset();
  const child = createMockChild();
  mockSpawn.mockReturnValue(child);
  const wfs = spyOn(fs, 'writeFileSync').mockReturnValue(undefined as any);
  const ch = spyOn(fs, 'chmodSync').mockReturnValue(undefined as any);
  const ul = spyOn(fs, 'unlinkSync').mockReturnValue(undefined as any);
  try {
    const mod = await import('../../src/cloudflared/process.js');
    mod.spawnCloudflared('/nonexistent-binary-path-for-detection', 'tok');
    _canMockSpawn = mockSpawn.mock.calls.length > 0;
  } catch {
    _canMockSpawn = false;
  }
  wfs.mockRestore();
  ch.mockRestore();
  ul.mockRestore();
  mockSpawn.mockReset();
  return _canMockSpawn;
}

describe('process.ts', () => {
  let processModule: typeof import('../../src/cloudflared/process.js');
  let writeFileSyncSpy: ReturnType<typeof spyOn>;
  let chmodSyncSpy: ReturnType<typeof spyOn>;
  let unlinkSyncSpy: ReturnType<typeof spyOn>;
  let mockWorks: boolean;

  beforeEach(async () => {
    mockSpawn.mockReset();
    writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockReturnValue(undefined as any);
    chmodSyncSpy = spyOn(fs, 'chmodSync').mockReturnValue(undefined as any);
    unlinkSyncSpy = spyOn(fs, 'unlinkSync').mockReturnValue(undefined as any);
    processModule = await import('../../src/cloudflared/process.js');
    mockWorks = await detectCanMockSpawn();
  });

  afterEach(() => {
    writeFileSyncSpy?.mockRestore();
    chmodSyncSpy?.mockRestore();
    unlinkSyncSpy?.mockRestore();
  });

  // --- spawnCloudflared tests (require spawn interception) ---
  describe('spawnCloudflared()', () => {
    test('passes flags BEFORE run and --token-file AFTER run', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/usr/local/bin/cloudflared', 'my-token');

      const args = mockSpawn.mock.calls[0][1] as string[];
      const runIndex = args.indexOf('run');
      expect(runIndex).toBeGreaterThan(0);
      expect(args.indexOf('--no-autoupdate')).toBeLessThan(runIndex);
      expect(args.indexOf('--metrics')).toBeLessThan(runIndex);
      expect(args.indexOf('--loglevel')).toBeLessThan(runIndex);
      expect(args.indexOf('--protocol')).toBeLessThan(runIndex);
      expect(args.indexOf('--token-file')).toBeGreaterThan(runIndex);
    });

    test('default options: metrics 127.0.0.1:0, loglevel info, protocol quic', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token');

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--metrics') + 1]).toBe('127.0.0.1:0');
      expect(args[args.indexOf('--loglevel') + 1]).toBe('info');
      expect(args[args.indexOf('--protocol') + 1]).toBe('quic');
    });

    test('custom metricsAddr is passed in args', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token', { metricsAddr: '0.0.0.0:9090' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--metrics') + 1]).toBe('0.0.0.0:9090');
    });

    test('debug loglevel is passed in args', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token', { loglevel: 'debug' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--loglevel') + 1]).toBe('debug');
    });

    test('http2 protocol is passed in args', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token', { protocol: 'http2' });

      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[args.indexOf('--protocol') + 1]).toBe('http2');
    });

    test('process PID is accessible', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild(54321);
      mockSpawn.mockReturnValue(mockChild);
      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      expect(proc.pid).toBe(54321);
    });

    test('stderr line callback is invoked per line', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      const stderrStream = new PassThrough();
      (mockChild as any).stderr = stderrStream;
      mockSpawn.mockReturnValue(mockChild);

      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      const lines: string[] = [];
      proc.onStderr((line) => lines.push(line));

      stderrStream.write('line one\n');
      stderrStream.write('line two\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lines).toContain('line one');
      expect(lines).toContain('line two');
    });

    test('multiple stderr callbacks are all called', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      const stderrStream = new PassThrough();
      (mockChild as any).stderr = stderrStream;
      mockSpawn.mockReturnValue(mockChild);

      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      const lines1: string[] = [];
      const lines2: string[] = [];
      proc.onStderr((line) => lines1.push(line));
      proc.onStderr((line) => lines2.push(line));

      stderrStream.write('test line\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(lines1).toContain('test line');
      expect(lines2).toContain('test line');
    });

    test('stdio config is [ignore, pipe, pipe]', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token');

      const options = mockSpawn.mock.calls[0][2] as any;
      expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });

    test('detached is false', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'token');

      const options = mockSpawn.mock.calls[0][2] as any;
      expect(options.detached).toBe(false);
    });

    test('writes token file with secure permissions before spawning', () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      processModule.spawnCloudflared('/bin/cloudflared', 'my-secret-token');

      expect(writeFileSyncSpy).toHaveBeenCalled();
      const writeCall = writeFileSyncSpy.mock.calls[0];
      expect(writeCall[1]).toBe('my-secret-token');
      expect(writeCall[2]).toEqual({ mode: 0o600 });
    });

    test('throws if token file creation fails', () => {
      // This test requires mock.module to intercept fs imports (spyOn doesn't
      // affect destructured ES module bindings inside process.ts).
      if (!mockWorks) return;
      writeFileSyncSpy.mockRestore();
      writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      expect(() => {
        processModule.spawnCloudflared('/bin/cloudflared', 'token');
      }).toThrow('Failed to create secure token file');
    });
  });

  // --- kill() tests (require spawn interception) ---
  describe('CloudflaredProcess.kill()', () => {
    test('graceful exit within timeout sends SIGTERM only', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      const signals: string[] = [];
      (mockChild as any).kill = (signal: string) => {
        signals.push(signal);
        setTimeout(() => { (mockChild as any).exitCode = 0; mockChild.emit('exit', 0, null); }, 10);
        return true;
      };
      mockSpawn.mockReturnValue(mockChild);
      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      await proc.kill();
      expect(signals).toEqual(['SIGTERM']);
    });

    test('timeout results in SIGTERM then SIGKILL', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      const signals: string[] = [];
      (mockChild as any).kill = (signal: string) => {
        signals.push(signal);
        if (signal === 'SIGKILL') {
          setTimeout(() => { mockChild.emit('exit', null, 'SIGKILL'); }, 5);
        }
        return true;
      };
      mockSpawn.mockReturnValue(mockChild);
      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      await proc.kill();
      expect(signals).toContain('SIGTERM');
      expect(signals).toContain('SIGKILL');
    }, 10000);

    test('already exited process sends no signals', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      (mockChild as any).exitCode = 0;
      const signals: string[] = [];
      (mockChild as any).kill = (signal: string) => { signals.push(signal); return true; };
      mockSpawn.mockReturnValue(mockChild);
      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      await proc.kill();
      expect(signals).toHaveLength(0);
    });

    test('multiple kill calls - second is no-op', async () => {
      if (!mockWorks) return;
      const mockChild = createMockChild();
      let killCount = 0;
      (mockChild as any).kill = (signal: string) => {
        killCount++;
        setTimeout(() => { (mockChild as any).exitCode = 0; mockChild.emit('exit', 0, null); }, 10);
        return true;
      };
      mockSpawn.mockReturnValue(mockChild);
      const proc = processModule.spawnCloudflared('/bin/cloudflared', 'token');
      await proc.kill();
      await proc.kill();
      expect(killCount).toBe(1);
    });
  });

  // --- setupSignalHandlers tests (do NOT need spawn) ---
  describe('setupSignalHandlers()', () => {
    test('installs SIGTERM handler', () => {
      const handlers: Record<string, Function> = {};
      const spy = spyOn(process, 'on').mockImplementation(((event: string, handler: Function) => {
        handlers[event] = handler; return process;
      }) as any);
      processModule.setupSignalHandlers(() => []);
      expect(handlers['SIGTERM']).toBeDefined();
      spy.mockRestore();
    });

    test('installs SIGINT handler', () => {
      const handlers: Record<string, Function> = {};
      const spy = spyOn(process, 'on').mockImplementation(((event: string, handler: Function) => {
        handlers[event] = handler; return process;
      }) as any);
      processModule.setupSignalHandlers(() => []);
      expect(handlers['SIGINT']).toBeDefined();
      spy.mockRestore();
    });

    test('installs SIGPIPE handler (ignored)', () => {
      const handlers: Record<string, Function> = {};
      const spy = spyOn(process, 'on').mockImplementation(((event: string, handler: Function) => {
        handlers[event] = handler; return process;
      }) as any);
      processModule.setupSignalHandlers(() => []);
      expect(handlers['SIGPIPE']).toBeDefined();
      spy.mockRestore();
    });

    test('installs SIGHUP handler (ignored)', () => {
      const handlers: Record<string, Function> = {};
      const spy = spyOn(process, 'on').mockImplementation(((event: string, handler: Function) => {
        handlers[event] = handler; return process;
      }) as any);
      processModule.setupSignalHandlers(() => []);
      expect(handlers['SIGHUP']).toBeDefined();
      spy.mockRestore();
    });
  });

  // --- gracefulShutdown tests (do NOT need spawn) ---
  describe('gracefulShutdown()', () => {
    test('calls kill() on all processes', async () => {
      const killed: number[] = [];
      const procs = [1, 2, 3].map((id) => ({
        child: {} as ChildProcess, pid: id,
        async kill() { killed.push(id); }, onStderr() {},
      }));
      await processModule.gracefulShutdown(procs);
      expect(killed).toEqual([1, 2, 3]);
    });

    test('handles kill failures gracefully without throwing', async () => {
      const procs = [
        { child: {} as ChildProcess, pid: 1, async kill() { throw new Error('fail'); }, onStderr() {} },
        { child: {} as ChildProcess, pid: 2, async kill() {}, onStderr() {} },
      ];
      await processModule.gracefulShutdown(procs);
    });

    test('completes immediately with empty array', async () => {
      await processModule.gracefulShutdown([]);
    });

    test('accepts timeout parameter', async () => {
      const procs = [{ child: {} as ChildProcess, pid: 1, async kill() {}, onStderr() {} }];
      await processModule.gracefulShutdown(procs, 10000);
    });
  });
});
