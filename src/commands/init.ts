import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { configExists, readConfig, writeConfig, getDefaultConfig } from '../config/store.js';
import { validateToken } from '../cloudflare/api.js';
import type { Zone } from '../cloudflare/types.js';
import { logger } from '../utils/logger.js';
import { prompt } from '../utils/prompt.js';

function isGlobalApiKey(token: string): boolean {
  // Global API keys are 37 chars hex, API tokens are longer with mixed chars
  return /^[0-9a-f]{37}$/.test(token);
}

function maskToken(token: string): string {
  if (token.length <= 4) return '****';
  return '*'.repeat(token.length - 4) + token.slice(-4);
}

export async function initCommand(): Promise<void> {
  // Check for existing config
  if (configExists()) {
    const existing = readConfig();
    if (existing?.apiToken) {
      const answer = await prompt(`\nExisting config found with token ending ...${existing.apiToken.slice(-4)}. Reconfigure? (y/N) `);
      if (answer.toLowerCase() !== 'y') {
        logger.info('Keeping existing configuration.');
        return;
      }
    }
  }

  // Print required permissions
  console.error(`
Required API Token Permissions:
  - Zone:Read              (list your domains)
  - DNS:Edit               (create/delete CNAME records)
  - Cloudflare Tunnel:Edit (create/manage tunnels)

Create a token at: https://dash.cloudflare.com/profile/api-tokens
`);

  let token: string | null = null;

  // Check for env var
  const envToken = process.env.CLOUDFLARE_API_TOKEN || process.env.TUINNEL_API_TOKEN;
  if (envToken) {
    const answer = await prompt(`Found CLOUDFLARE_API_TOKEN env var (${maskToken(envToken)}). Use it? (Y/n) `);
    if (answer.toLowerCase() !== 'n') {
      token = envToken;
    }
  }

  // Check for existing cloudflared credentials
  if (!token) {
    const cloudflaredDir = join(homedir(), '.cloudflared');
    if (existsSync(cloudflaredDir)) {
      logger.info(`Found existing ~/.cloudflared/ directory.`);
      // Check for cert.pem which might have credentials
      const certPath = join(cloudflaredDir, 'cert.pem');
      if (existsSync(certPath)) {
        logger.info('Found cloudflared certificate. Note: tuinnel uses API tokens, not cloudflared certificates.');
      }
    }
  }

  // Prompt for token if not provided
  if (!token) {
    token = await prompt('Paste your API token: ');
  }

  if (!token) {
    logger.error('No token provided.');
    process.exitCode = 1;
    return;
  }

  // Detect Global API Key format
  if (isGlobalApiKey(token)) {
    logger.error('This looks like a Global API Key, not an API Token.');
    console.error('\ntuinnel requires a scoped API Token, not a Global API Key.');
    console.error('Create an API Token at: https://dash.cloudflare.com/profile/api-tokens');
    process.exitCode = 1;
    return;
  }

  console.error(`\nToken: ${maskToken(token)}`);

  // Validate token
  logger.info('Validating token...');
  const result = await validateToken(token);

  if (!result.valid) {
    logger.error('Token validation failed.');
    if (result.error) {
      console.error(result.error);
    }
    process.exitCode = 1;
    return;
  }

  logger.success(`Token valid. Found ${result.zones.length} zone${result.zones.length !== 1 ? 's' : ''}.`);

  // Zone selection
  let defaultZone: string | undefined;

  if (result.zones.length === 1) {
    defaultZone = result.zones[0].name;
    logger.info(`Using zone: ${defaultZone}`);
  } else if (result.zones.length > 1) {
    console.error('\nAvailable zones:');
    result.zones.forEach((zone: Zone, i: number) => {
      console.error(`  ${i + 1}. ${zone.name} (${zone.status})`);
    });
    const answer = await prompt(`\nSelect default zone (1-${result.zones.length}): `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < result.zones.length) {
      defaultZone = result.zones[idx].name;
    } else {
      logger.warn('Invalid selection. No default zone set (you can specify per tunnel).');
    }
  }

  // Save config
  const config = configExists() ? readConfig() ?? getDefaultConfig() : getDefaultConfig();
  config.apiToken = token;
  if (defaultZone) {
    config.defaultZone = defaultZone;
  }
  writeConfig(config);

  logger.success('Configuration saved.');
  console.error(`\nTry: tuinnel up 3000`);
}
