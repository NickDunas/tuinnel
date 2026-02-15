import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectFramework, suggestSubdomain } from '../../src/config/port-map.js';

describe('detectFramework', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tuinnel-portmap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('detects next dev -> "next"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'next dev' },
    }));
    expect(detectFramework(tmpDir)).toBe('next');
  });

  test('detects vite -> "vite"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite' },
    }));
    expect(detectFramework(tmpDir)).toBe('vite');
  });

  test('detects ng serve -> "angular"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'ng serve' },
    }));
    expect(detectFramework(tmpDir)).toBe('angular');
  });

  test('detects react-scripts -> "react"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { start: 'react-scripts start' },
    }));
    expect(detectFramework(tmpDir)).toBe('react');
  });

  test('detects nuxt -> "nuxt"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'nuxt dev' },
    }));
    expect(detectFramework(tmpDir)).toBe('nuxt');
  });

  test('detects remix -> "remix"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'remix dev' },
    }));
    expect(detectFramework(tmpDir)).toBe('remix');
  });

  test('detects astro -> "astro"', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'astro dev' },
    }));
    expect(detectFramework(tmpDir)).toBe('astro');
  });

  test('returns null for no package.json', () => {
    expect(detectFramework(tmpDir)).toBeNull();
  });

  test('returns null for package.json without scripts', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-project',
    }));
    expect(detectFramework(tmpDir)).toBeNull();
  });

  test('returns null for unknown framework', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'node server.js' },
    }));
    expect(detectFramework(tmpDir)).toBeNull();
  });

  test('prefers dev script over start script', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'next dev', start: 'react-scripts start' },
    }));
    expect(detectFramework(tmpDir)).toBe('next');
  });

  test('falls back to start script when dev is absent', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { start: 'react-scripts start' },
    }));
    expect(detectFramework(tmpDir)).toBe('react');
  });

  test('returns null for invalid JSON', () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not valid json');
    expect(detectFramework(tmpDir)).toBeNull();
  });
});

describe('suggestSubdomain', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `tuinnel-subdomain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('prefers CWD detection over static map', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { dev: 'next dev' },
    }));
    // Port 3000 would map to "app" in static map, but CWD says "next"
    expect(suggestSubdomain(3000, tmpDir)).toBe('next');
  });

  test('static port map fallback: 4200 -> "angular"', () => {
    expect(suggestSubdomain(4200, tmpDir)).toBe('angular');
  });

  test('static port map fallback: 3000 -> "app"', () => {
    expect(suggestSubdomain(3000, tmpDir)).toBe('app');
  });

  test('static port map fallback: 8080 -> "api"', () => {
    expect(suggestSubdomain(8080, tmpDir)).toBe('api');
  });

  test('static port map fallback: 5173 -> "vite"', () => {
    expect(suggestSubdomain(5173, tmpDir)).toBe('vite');
  });

  test('static port map fallback: 8000 -> "django"', () => {
    expect(suggestSubdomain(8000, tmpDir)).toBe('django');
  });

  test('static port map fallback: 5000 -> "flask"', () => {
    expect(suggestSubdomain(5000, tmpDir)).toBe('flask');
  });

  test('static port map fallback: 3001 -> "next"', () => {
    expect(suggestSubdomain(3001, tmpDir)).toBe('next');
  });

  test('static port map fallback: 4000 -> "graphql"', () => {
    expect(suggestSubdomain(4000, tmpDir)).toBe('graphql');
  });

  test('unknown port -> "app-{port}"', () => {
    expect(suggestSubdomain(9999, tmpDir)).toBe('app-9999');
  });

  test('unknown port 1234 -> "app-1234"', () => {
    expect(suggestSubdomain(1234, tmpDir)).toBe('app-1234');
  });
});
