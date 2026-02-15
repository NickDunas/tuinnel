import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync, unlinkSync, renameSync, createWriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync, execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export const BIN_DIR = join(homedir(), '.tuinnel', 'bin');
export const BINARY_PATH = join(BIN_DIR, 'cloudflared');
export const VERSION_FILE = join(BIN_DIR, '.version');

const ASSET_MAP: Record<string, string> = {
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
  'linux-arm64': 'cloudflared-linux-arm64',
  'linux-x64': 'cloudflared-linux-amd64',
};

const DOWNLOAD_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const GITHUB_API_LATEST = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';

export function getAssetName(): string {
  const key = `${process.platform}-${process.arch}`;
  const asset = ASSET_MAP[key];
  if (!asset) {
    throw new Error(`Unsupported platform: ${key}`);
  }
  return asset;
}

function isTarball(asset: string): boolean {
  return asset.endsWith('.tgz');
}

export function binaryExists(): boolean {
  return existsSync(BINARY_PATH);
}

export function getInstalledVersion(): string | null {
  if (existsSync(VERSION_FILE)) {
    return readFileSync(VERSION_FILE, 'utf-8').trim();
  }
  if (!binaryExists()) {
    return null;
  }
  try {
    const output = execFileSync(BINARY_PATH, ['version', '--short'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return output.trim();
  } catch {
    return null;
  }
}

export async function getLatestVersion(): Promise<string> {
  const res = await fetch(GITHUB_API_LATEST, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { tag_name: string };
  // tag_name is like "2025.8.0" or "v2025.8.0"
  return data.tag_name.replace(/^v/, '');
}

export function isUpdateAvailable(installed: string, latest: string): boolean {
  return installed !== latest;
}

async function fetchChecksum(asset: string): Promise<string | null> {
  const res = await fetch(GITHUB_API_LATEST, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!res.ok) return null;

  const data = await res.json() as { body: string };
  if (!data.body) return null;

  // Checksums in release notes: "asset-name: <64-char-hex>"
  for (const line of data.body.split('\n')) {
    if (line.includes(asset)) {
      const match = line.match(/([a-f0-9]{64})/);
      if (match) return match[1];
    }
  }
  return null;
}

function computeFileHash(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

export async function downloadBinary(
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<string> {
  const asset = getAssetName();
  const url = `${DOWNLOAD_BASE}/${asset}`;

  // Fetch version once upfront (reused for version file at the end)
  const version = await getLatestVersion();

  if (!existsSync(BIN_DIR)) {
    mkdirSync(BIN_DIR, { recursive: true });
  }

  const tmpPath = join(BIN_DIR, `${asset}.tmp`);

  // Download the file
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to download cloudflared: ${res.status} ${res.statusText}`);
  }

  const contentLength = res.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : null;
  let downloaded = 0;

  const body = res.body;
  if (!body) {
    throw new Error('Empty response body from download');
  }

  const writeStream = createWriteStream(tmpPath);

  // Transform to track progress
  const reader = body.getReader();
  const progressStream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      downloaded += value.byteLength;
      if (onProgress) onProgress(downloaded, total);
      controller.enqueue(value);
    },
  });

  await pipeline(
    Readable.fromWeb(progressStream as import('stream/web').ReadableStream),
    writeStream,
  );

  // Best-effort checksum verification (parsed from release notes, not authoritative)
  try {
    const expectedHash = await fetchChecksum(asset);
    if (expectedHash) {
      const actualHash = computeFileHash(tmpPath);
      if (actualHash !== expectedHash) {
        // Warn but don't block — release notes checksums are unreliable
        process.stderr.write(
          `warning: SHA256 checksum from release notes did not match for ${asset}\n` +
          `  Release notes hash: ${expectedHash}\n` +
          `  Downloaded file:    ${actualHash}\n` +
          `  Continuing anyway (release notes parsing is best-effort).\n`,
        );
      }
    }
  } catch {
    // Checksum fetch failed — not critical, continue
  }

  // Extract or move binary
  if (isTarball(asset)) {
    // macOS: extract .tgz archive
    execFileSync('tar', ['-xzf', tmpPath, '-C', BIN_DIR], { timeout: 10000 });
    unlinkSync(tmpPath);
  } else {
    // Linux: rename bare binary
    renameSync(tmpPath, BINARY_PATH);
  }

  // Make executable
  chmodSync(BINARY_PATH, 0o755);

  // Store version (fetched at start of download)
  writeFileSync(VERSION_FILE, version + '\n', 'utf-8');

  return BINARY_PATH;
}

export async function ensureBinary(
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<string> {
  if (binaryExists()) {
    return BINARY_PATH;
  }
  return downloadBinary(onProgress);
}
