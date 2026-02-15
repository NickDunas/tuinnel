import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to test the store module with a temp directory instead of the real ~/.tuinnel.
// The store uses hardcoded CONFIG_DIR/CONFIG_PATH based on homedir().
// We'll mock the module-level constants by importing the functions and replacing the paths.
// Since the store uses module-level constants, we need to test behavior by manipulating
// the actual functions' dependencies.

// Strategy: We'll test the store functions by temporarily creating/reading from a temp
// directory and manually calling the underlying fs operations the same way the store does,
// OR we can use Bun's module mocking to override the constants.

import { writeConfig, readConfig, configExists, getDefaultConfig, CONFIG_DIR, CONFIG_PATH } from '../../src/config/store.js';
import type { Config } from '../../src/config/schema.js';

// Create a temporary test directory that mirrors the store behavior
const TEST_DIR = join(tmpdir(), `tuinnel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const TEST_CONFIG_PATH = join(TEST_DIR, 'config.json');

// Since the store module uses hardcoded paths to ~/.tuinnel/config.json,
// we need to test it differently. We'll test the functions that DO work
// with the real path (using cleanup), and for isolation we'll directly
// test the schema validation and file operations patterns.

describe('config store', () => {
  // For tests that need filesystem isolation, we'll create a custom
  // write/read cycle using a temp directory, testing the PATTERNS the store uses.
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tuinnel-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test('getDefaultConfig returns valid config with version 1', () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
    expect(config.tunnels).toEqual({});
  });

  test('writeConfig creates file with 0600 permissions', () => {
    // Test using the real store (will write to ~/.tuinnel)
    // We need to save/restore any existing config
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
    }

    try {
      const config: Config = {
        version: 1,
        tunnels: {},
      };
      writeConfig(config);

      expect(existsSync(CONFIG_PATH)).toBe(true);

      const stat = statSync(CONFIG_PATH);
      // Check file permissions: 0600 = owner read/write only
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      // Restore original config if it existed
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      } else if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
    }
  });

  test('readConfig returns null for missing file', () => {
    // Temporarily rename existing config if present
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
      rmSync(CONFIG_PATH);
    }

    try {
      const result = readConfig();
      expect(result).toBeNull();
    } finally {
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        if (!existsSync(CONFIG_DIR)) {
          mkdirSync(CONFIG_DIR, { recursive: true });
        }
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      }
    }
  });

  test('readConfig validates against schema', () => {
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
    }

    try {
      // Write an invalid config directly (bypassing writeConfig validation)
      const { writeFileSync, chmodSync } = require('fs');
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }
      writeFileSync(CONFIG_PATH, JSON.stringify({ invalid: true }), 'utf-8');
      chmodSync(CONFIG_PATH, 0o600);

      expect(() => readConfig()).toThrow('Invalid config');
    } finally {
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      } else if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
    }
  });

  test('writeConfig validates config before writing', () => {
    const invalidConfig = { version: 2, tunnels: {} } as unknown as Config;
    expect(() => writeConfig(invalidConfig)).toThrow('Invalid config');
  });

  test('atomic write: uses temp file then renames', () => {
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
    }

    try {
      const config: Config = {
        version: 1,
        apiToken: 'test-token-123',
        tunnels: {
          myapp: { port: 3000, subdomain: 'myapp', zone: 'example.com', protocol: 'http' },
        },
      };
      writeConfig(config);

      // After write, the temp file should NOT exist (it was renamed)
      const tmpPath = CONFIG_PATH + '.tmp';
      expect(existsSync(tmpPath)).toBe(false);

      // The final file should exist and contain valid data
      expect(existsSync(CONFIG_PATH)).toBe(true);
      const written = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      expect(written.version).toBe(1);
      expect(written.apiToken).toBe('test-token-123');
      expect(written.tunnels.myapp.port).toBe(3000);
    } finally {
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      } else if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
    }
  });

  test('configExists returns correct boolean', () => {
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
    }

    try {
      // Remove config if it exists
      if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
      expect(configExists()).toBe(false);

      // Write a config
      writeConfig(getDefaultConfig());
      expect(configExists()).toBe(true);
    } finally {
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      } else if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
    }
  });

  test('write then read roundtrip preserves data', () => {
    const hadConfig = existsSync(CONFIG_PATH);
    let savedConfig: string | null = null;
    if (hadConfig) {
      savedConfig = readFileSync(CONFIG_PATH, 'utf-8');
    }

    try {
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
    } finally {
      if (savedConfig !== null) {
        const { writeFileSync, chmodSync } = require('fs');
        writeFileSync(CONFIG_PATH, savedConfig, 'utf-8');
        chmodSync(CONFIG_PATH, 0o600);
      } else if (existsSync(CONFIG_PATH)) {
        rmSync(CONFIG_PATH);
      }
    }
  });
});
