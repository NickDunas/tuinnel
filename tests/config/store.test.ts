import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, mock } from 'bun:test';
import { mkdirSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Config } from '../../src/config/schema.js';

// Stable temp dir used for ALL tests in this file — avoids Bun module cache issues
const TEST_HOME = join(tmpdir(), 'tuinnel-store-test-home');
const TEST_CONFIG_DIR = join(TEST_HOME, '.tuinnel');
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json');

// Mock os.homedir() BEFORE any store.js import — this ensures the module-level
// CONFIG_DIR/CONFIG_PATH constants use our temp directory
mock.module('os', () => ({
  homedir: () => TEST_HOME,
  tmpdir,
}));

describe('config store', () => {
  let writeConfig: typeof import('../../src/config/store.js').writeConfig;
  let readConfig: typeof import('../../src/config/store.js').readConfig;
  let configExists: typeof import('../../src/config/store.js').configExists;
  let getDefaultConfig: typeof import('../../src/config/store.js').getDefaultConfig;
  let getToken: typeof import('../../src/config/store.js').getToken;
  let CONFIG_DIR: string;
  let CONFIG_PATH: string;

  beforeAll(async () => {
    mkdirSync(TEST_HOME, { recursive: true });

    // Import store ONCE — it will evaluate CONFIG_DIR/CONFIG_PATH using our mocked homedir
    const store = await import('../../src/config/store.js');
    writeConfig = store.writeConfig;
    readConfig = store.readConfig;
    configExists = store.configExists;
    getDefaultConfig = store.getDefaultConfig;
    getToken = store.getToken;
    CONFIG_DIR = store.CONFIG_DIR;
    CONFIG_PATH = store.CONFIG_PATH;
  });

  beforeEach(() => {
    // Clean slate: remove config dir before each test
    try {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {}
  });

  afterAll(() => {
    mock.restore();
    try {
      rmSync(TEST_HOME, { recursive: true, force: true });
    } catch {}
  });

  test('getDefaultConfig returns valid config with version 1', () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.tunnels).toEqual({});
  });

  test('CONFIG_DIR and CONFIG_PATH use mocked homedir', () => {
    expect(CONFIG_DIR).toBe(TEST_CONFIG_DIR);
    expect(CONFIG_PATH).toBe(TEST_CONFIG_PATH);
  });

  test('writeConfig creates directory and file with 0600 permissions', () => {
    const config: Config = {
      version: 1,
      tunnels: {},
    };
    writeConfig(config);

    expect(existsSync(CONFIG_PATH)).toBe(true);

    const stat = statSync(CONFIG_PATH);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('readConfig returns null for missing file', () => {
    const result = readConfig();
    expect(result).toBeNull();
  });

  test('readConfig validates against schema', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ invalid: true }), 'utf-8');
    chmodSync(TEST_CONFIG_PATH, 0o600);

    expect(() => readConfig()).toThrow('Invalid config');
  });

  test('writeConfig validates config before writing', () => {
    const invalidConfig = { version: 2, tunnels: {} } as unknown as Config;
    expect(() => writeConfig(invalidConfig)).toThrow('Invalid config');
  });

  test('atomic write: uses temp file then renames', () => {
    const config: Config = {
      version: 1,
      apiToken: 'test-token-123',
      tunnels: {
        myapp: { port: 3000, subdomain: 'myapp', zone: 'example.com', protocol: 'http' },
      },
    };
    writeConfig(config);

    // After write, the temp file should NOT exist (it was renamed)
    const tmpPath = TEST_CONFIG_PATH + '.tmp';
    expect(existsSync(tmpPath)).toBe(false);

    // The final file should exist and contain valid data
    expect(existsSync(TEST_CONFIG_PATH)).toBe(true);
    const written = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    expect(written.version).toBe(1);
    expect(written.apiToken).toBe('test-token-123');
    expect(written.tunnels.myapp.port).toBe(3000);
  });

  test('configExists returns correct boolean', () => {
    expect(configExists()).toBe(false);

    writeConfig(getDefaultConfig());
    expect(configExists()).toBe(true);
  });

  test('write then read roundtrip preserves data', () => {
    const config: Config = {
      version: 1,
      apiToken: 'roundtrip-token',
      defaultZone: 'example.com',
      tunnels: {
        angular: { port: 4200, subdomain: 'angular', zone: 'example.com', protocol: 'http' },
        api: { port: 8080, subdomain: 'api', zone: 'example.com', protocol: 'https' },
      },
    };

    writeConfig(config);
    const loaded = readConfig();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.apiToken).toBe('roundtrip-token');
    expect(loaded!.defaultZone).toBe('example.com');
    expect(loaded!.tunnels.angular.port).toBe(4200);
    expect(loaded!.tunnels.api.protocol).toBe('https');
  });

  test('readConfig throws for corrupted JSON', () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG_PATH, 'not-valid-json{{{', 'utf-8');
    chmodSync(TEST_CONFIG_PATH, 0o600);

    expect(() => readConfig()).toThrow('Corrupted config');
  });
});
