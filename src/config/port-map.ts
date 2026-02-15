import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PORT_MAP: Record<number, string> = {
  4200: 'angular',
  3000: 'app',
  8080: 'api',
  5173: 'vite',
  8000: 'django',
  5000: 'flask',
  3001: 'next',
  4000: 'graphql',
};

const FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bnext\b/, name: 'next' },
  { pattern: /\bvite\b/, name: 'vite' },
  { pattern: /\bng\s+serve\b/, name: 'angular' },
  { pattern: /\breact-scripts\b/, name: 'react' },
  { pattern: /\bnuxt\b/, name: 'nuxt' },
  { pattern: /\bremix\b/, name: 'remix' },
  { pattern: /\bastro\b/, name: 'astro' },
];

export function detectFramework(cwd: string): string | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }

  try {
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts;
    if (!scripts) return null;

    const devScript = scripts.dev || scripts.start || '';
    for (const { pattern, name } of FRAMEWORK_PATTERNS) {
      if (pattern.test(devScript)) {
        return name;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function suggestSubdomain(port: number, cwd: string): string {
  // Try CWD framework detection first
  const framework = detectFramework(cwd);
  if (framework) {
    return framework;
  }

  // Fall back to static port map
  return PORT_MAP[port] ?? `app-${port}`;
}
