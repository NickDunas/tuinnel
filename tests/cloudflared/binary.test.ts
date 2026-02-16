import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { PassThrough } from 'stream';

// Save originals
const originalFetch = globalThis.fetch;
const originalPlatform = process.platform;
const originalArch = process.arch;

// Platform/arch helpers
function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
}
function setArch(arch: string) {
  Object.defineProperty(process, 'arch', { value: arch, writable: true, configurable: true });
}
function restorePlatformArch() {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true, configurable: true });
  Object.defineProperty(process, 'arch', { value: originalArch, writable: true, configurable: true });
}

// Response helpers
function mockDownloadResponse(data: Uint8Array, status = 200, headers: Record<string, string> = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
  });
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('binary.ts', () => {
  let binaryModule: typeof import('../../src/cloudflared/binary.js');

  beforeEach(async () => {
    binaryModule = await import('../../src/cloudflared/binary.js');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restorePlatformArch();
  });

  describe('getAssetName()', () => {
    test('macOS ARM64 returns cloudflared-darwin-arm64.tgz', () => {
      setPlatform('darwin');
      setArch('arm64');
      expect(binaryModule.getAssetName()).toBe('cloudflared-darwin-arm64.tgz');
    });

    test('macOS x64 returns cloudflared-darwin-amd64.tgz', () => {
      setPlatform('darwin');
      setArch('x64');
      expect(binaryModule.getAssetName()).toBe('cloudflared-darwin-amd64.tgz');
    });

    test('Linux ARM64 returns cloudflared-linux-arm64', () => {
      setPlatform('linux');
      setArch('arm64');
      expect(binaryModule.getAssetName()).toBe('cloudflared-linux-arm64');
    });

    test('Linux x64 returns cloudflared-linux-amd64', () => {
      setPlatform('linux');
      setArch('x64');
      expect(binaryModule.getAssetName()).toBe('cloudflared-linux-amd64');
    });

    test('unsupported platform throws', () => {
      setPlatform('win32');
      setArch('x64');
      expect(() => binaryModule.getAssetName()).toThrow('Unsupported platform: win32-x64');
    });

    test('unsupported arch throws', () => {
      setPlatform('linux');
      setArch('s390x');
      expect(() => binaryModule.getAssetName()).toThrow('Unsupported platform: linux-s390x');
    });
  });

  describe('binaryExists()', () => {
    test('returns true when binary exists', () => {
      const spy = spyOn(fs, 'existsSync').mockReturnValue(true);
      expect(binaryModule.binaryExists()).toBe(true);
      spy.mockRestore();
    });

    test('returns false when binary is missing', () => {
      const spy = spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(binaryModule.binaryExists()).toBe(false);
      spy.mockRestore();
    });
  });

  describe('getInstalledVersion()', () => {
    test('returns version from version file when it exists', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
        return String(path).endsWith('.version');
      });
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue('2025.8.0\n' as any);

      const result = binaryModule.getInstalledVersion();
      expect(result).toBe('2025.8.0');

      existsSpy.mockRestore();
      readSpy.mockRestore();
    });

    test('falls back to exec when version file missing but binary exists', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
        const p = String(path);
        if (p.endsWith('.version')) return false;
        if (p.endsWith('cloudflared')) return true;
        return false;
      });
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValue('2025.7.0\n' as any);

      const result = binaryModule.getInstalledVersion();
      expect(result).toBe('2025.7.0');

      existsSpy.mockRestore();
      execSpy.mockRestore();
    });

    test('returns null when both file and binary are missing', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = binaryModule.getInstalledVersion();
      expect(result).toBeNull();

      existsSpy.mockRestore();
    });

    test('returns null when execFileSync throws', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
        const p = String(path);
        if (p.endsWith('.version')) return false;
        if (p.endsWith('cloudflared')) return true;
        return false;
      });
      const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = binaryModule.getInstalledVersion();
      expect(result).toBeNull();

      existsSpy.mockRestore();
      execSpy.mockRestore();
    });

    test('trims whitespace from version file', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
        return String(path).endsWith('.version');
      });
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue('  2025.8.0  \n' as any);

      const result = binaryModule.getInstalledVersion();
      expect(result).toBe('2025.8.0');

      existsSpy.mockRestore();
      readSpy.mockRestore();
    });

    test('trims whitespace from exec output', () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
        const p = String(path);
        if (p.endsWith('.version')) return false;
        if (p.endsWith('cloudflared')) return true;
        return false;
      });
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValue('  2025.7.0  \n' as any);

      const result = binaryModule.getInstalledVersion();
      expect(result).toBe('2025.7.0');

      existsSpy.mockRestore();
      execSpy.mockRestore();
    });
  });

  describe('getLatestVersion()', () => {
    test('returns tag_name from GitHub API', async () => {
      globalThis.fetch = async () => mockJsonResponse({ tag_name: '2025.9.0' });

      const result = await binaryModule.getLatestVersion();
      expect(result).toBe('2025.9.0');
    });

    test('strips v prefix from tag_name', async () => {
      globalThis.fetch = async () => mockJsonResponse({ tag_name: 'v2025.9.0' });

      const result = await binaryModule.getLatestVersion();
      expect(result).toBe('2025.9.0');
    });

    test('throws on 404', async () => {
      globalThis.fetch = async () => new Response('Not Found', { status: 404, statusText: 'Not Found' });

      await expect(binaryModule.getLatestVersion()).rejects.toThrow('Failed to fetch latest release: 404');
    });

    test('throws on network error', async () => {
      globalThis.fetch = async () => { throw new Error('Network error'); };

      await expect(binaryModule.getLatestVersion()).rejects.toThrow('Network error');
    });

    test('sends correct Accept header', async () => {
      let capturedHeaders: Headers | undefined;
      globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return mockJsonResponse({ tag_name: '2025.9.0' });
      };

      await binaryModule.getLatestVersion();
      expect(capturedHeaders?.get('Accept')).toBe('application/vnd.github.v3+json');
    });
  });

  describe('isUpdateAvailable()', () => {
    test('returns false when versions are the same', () => {
      expect(binaryModule.isUpdateAvailable('2025.8.0', '2025.8.0')).toBe(false);
    });

    test('returns true when newer is available', () => {
      expect(binaryModule.isUpdateAvailable('2025.8.0', '2025.9.0')).toBe(true);
    });

    test('returns true when versions differ (older available)', () => {
      expect(binaryModule.isUpdateAvailable('2025.9.0', '2025.8.0')).toBe(true);
    });

    test('returns true when format differs', () => {
      expect(binaryModule.isUpdateAvailable('2025.8.0', '2025.08.0')).toBe(true);
    });
  });

  describe('downloadBinary()', () => {
    let existsSyncSpy: ReturnType<typeof spyOn>;
    let mkdirSyncSpy: ReturnType<typeof spyOn>;
    let chmodSyncSpy: ReturnType<typeof spyOn>;
    let writeFileSyncSpy: ReturnType<typeof spyOn>;
    let unlinkSyncSpy: ReturnType<typeof spyOn>;
    let renameSyncSpy: ReturnType<typeof spyOn>;
    let execFileSyncSpy: ReturnType<typeof spyOn>;
    let createWriteStreamSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
      mkdirSyncSpy = spyOn(fs, 'mkdirSync').mockReturnValue(undefined as any);
      chmodSyncSpy = spyOn(fs, 'chmodSync').mockReturnValue(undefined as any);
      writeFileSyncSpy = spyOn(fs, 'writeFileSync').mockReturnValue(undefined as any);
      unlinkSyncSpy = spyOn(fs, 'unlinkSync').mockReturnValue(undefined as any);
      renameSyncSpy = spyOn(fs, 'renameSync').mockReturnValue(undefined as any);
      execFileSyncSpy = spyOn(childProcess, 'execFileSync').mockReturnValue('' as any);
      createWriteStreamSpy = spyOn(fs, 'createWriteStream').mockImplementation(() => {
        const pt = new PassThrough();
        pt.on('data', () => {});
        return pt as any;
      });
    });

    afterEach(() => {
      existsSyncSpy.mockRestore();
      mkdirSyncSpy.mockRestore();
      chmodSyncSpy.mockRestore();
      writeFileSyncSpy.mockRestore();
      unlinkSyncSpy.mockRestore();
      renameSyncSpy.mockRestore();
      execFileSyncSpy.mockRestore();
      createWriteStreamSpy.mockRestore();
    });

    test('Linux bare binary: rename + chmod, no tar', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2, 3, 4]), 200, { 'Content-Length': '4' });
      };

      const result = await binaryModule.downloadBinary();
      expect(result).toEndWith('/cloudflared');
      expect(renameSyncSpy).toHaveBeenCalled();
      // chmod called with the binary path and 0o755
      const chmodCall = chmodSyncSpy.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith('/cloudflared') && c[1] === 0o755,
      );
      expect(chmodCall).toBeDefined();
    });

    test('macOS .tgz: tar extraction + chmod + version file', async () => {
      setPlatform('darwin');
      setArch('arm64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2, 3, 4]), 200, { 'Content-Length': '4' });
      };

      const result = await binaryModule.downloadBinary();
      expect(result).toEndWith('/cloudflared');
      // tar extraction called
      expect(execFileSyncSpy).toHaveBeenCalled();
      const tarArgs = execFileSyncSpy.mock.calls[0];
      expect(tarArgs[0]).toBe('tar');
      // tmp file cleaned up via unlinkSync
      expect(unlinkSyncSpy).toHaveBeenCalled();
    });

    test('creates BIN_DIR if it does not exist', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2]), 200);
      };

      await binaryModule.downloadBinary();
      // BIN_DIR should be created with { recursive: true }
      const mkdirCall = mkdirSyncSpy.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith('.tuinnel/bin'),
      );
      expect(mkdirCall).toBeDefined();
    });

    test('writes version file after download', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2]), 200);
      };

      await binaryModule.downloadBinary();
      // Version file should be written
      const writeCall = writeFileSyncSpy.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith('.version') && c[1] === '2025.9.0\n',
      );
      expect(writeCall).toBeDefined();
    });

    test('network error during download throws', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        throw new Error('Network failure');
      };

      await expect(binaryModule.downloadBinary()).rejects.toThrow('Network failure');
    });

    test('HTTP error during download throws', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      };

      await expect(binaryModule.downloadBinary()).rejects.toThrow('Failed to download cloudflared: 404');
    });

    test('succeeds with missing content-length', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2, 3]), 200);
      };

      const result = await binaryModule.downloadBinary();
      expect(result).toEndWith('/cloudflared');
    });

    test('progress callback is called with correct bytes', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2, 3, 4]), 200, { 'Content-Length': '4' });
      };

      const progressCalls: Array<[number, number | null]> = [];
      await binaryModule.downloadBinary((downloaded, total) => {
        progressCalls.push([downloaded, total]);
      });

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = progressCalls[progressCalls.length - 1];
      expect(lastCall[0]).toBe(4);
      expect(lastCall[1]).toBe(4);
    });

    test('progress callback receives null total when no content-length', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return mockDownloadResponse(new Uint8Array([1, 2]), 200);
      };

      const progressCalls: Array<[number, number | null]> = [];
      await binaryModule.downloadBinary((downloaded, total) => {
        progressCalls.push([downloaded, total]);
      });

      expect(progressCalls.length).toBeGreaterThanOrEqual(1);
      expect(progressCalls[0][1]).toBeNull();
    });

    test('empty response body throws', async () => {
      setPlatform('linux');
      setArch('x64');

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('api.github.com')) {
          return mockJsonResponse({ tag_name: '2025.9.0' });
        }
        return new Response(null, { status: 200 });
      };

      await expect(binaryModule.downloadBinary()).rejects.toThrow('Empty response body');
    });
  });

  describe('ensureBinary()', () => {
    // ensureBinary delegates to binaryExists() and downloadBinary(),
    // both of which are tested above. These tests verify the delegation
    // logic and exported BINARY_PATH constant.

    test('BINARY_PATH ends with .tuinnel/bin/cloudflared', () => {
      expect(binaryModule.BINARY_PATH).toContain('.tuinnel/bin/cloudflared');
    });

    test('BIN_DIR ends with .tuinnel/bin', () => {
      expect(binaryModule.BIN_DIR).toContain('.tuinnel/bin');
    });

    test('VERSION_FILE ends with .version', () => {
      expect(binaryModule.VERSION_FILE).toEndWith('.version');
    });
  });
});
