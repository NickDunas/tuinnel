import { createInterface } from 'readline';
import { readConfig, writeConfig, getDefaultConfig, configExists } from '../config/store.js';
import { suggestSubdomain } from '../config/port-map.js';
import { logger } from '../utils/logger.js';

interface AddOptions {
  subdomain?: string;
  zone?: string;
  adopt?: boolean;
  verbose?: boolean;
}

function validatePort(portStr: string): number {
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    logger.error(`Invalid port: "${portStr}". Must be 1-65535.`);
    process.exit(1);
  }
  return port;
}

function validateSubdomain(subdomain: string): string {
  const normalized = subdomain.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalized)) {
    logger.error(
      `Invalid subdomain: "${subdomain}". Must be lowercase alphanumeric with hyphens, ` +
      `cannot start or end with a hyphen.`,
    );
    process.exit(1);
  }
  return normalized;
}

async function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function addCommand(portStr: string, options: AddOptions): Promise<void> {
  const port = validatePort(portStr);
  const isInteractive = process.stdin.isTTY ?? false;
  const config = configExists() ? readConfig() ?? getDefaultConfig() : getDefaultConfig();

  // Determine subdomain
  let subdomain: string;
  if (options.subdomain) {
    subdomain = validateSubdomain(options.subdomain);
  } else if (isInteractive) {
    const suggestion = suggestSubdomain(port, process.cwd());
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await prompt(rl, `Subdomain: ${suggestion} — accept? (Y/n) `);
      if (answer.toLowerCase() === 'n') {
        const custom = await prompt(rl, 'Enter subdomain: ');
        if (!custom) {
          logger.error('No subdomain provided.');
          process.exit(1);
        }
        subdomain = validateSubdomain(custom);
      } else {
        subdomain = suggestion;
      }
    } finally {
      rl.close();
    }
  } else {
    logger.error('--subdomain is required in non-interactive mode.');
    process.exit(1);
  }

  // Determine zone
  let zone: string;
  if (options.zone) {
    zone = options.zone;
  } else if (config.defaultZone) {
    zone = config.defaultZone;
  } else if (isInteractive) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await prompt(rl, 'Enter zone (domain): ');
      if (!answer) {
        logger.error('No zone provided. Run `tuinnel init` to set a default zone.');
        process.exit(1);
      }
      zone = answer;
    } finally {
      rl.close();
    }
  } else {
    logger.error('--zone is required (no default zone configured). Run `tuinnel init` first.');
    process.exit(1);
  }

  // Use subdomain as tunnel name
  const name = subdomain;

  // Check for duplicate
  if (config.tunnels[name]) {
    logger.error(`Tunnel "${name}" already exists in config (port ${config.tunnels[name].port}).`);
    console.error(`Use \`tuinnel remove ${name}\` first, or choose a different subdomain.`);
    process.exit(1);
  }

  // Save to config
  config.tunnels[name] = {
    port,
    subdomain,
    zone,
    protocol: 'http',
  };
  writeConfig(config);

  logger.success(`Added tunnel "${name}" — ${subdomain}.${zone} <- :${port}`);
  console.error('\nThis saves configuration only. Run `tuinnel up` to start the tunnel.');
}
