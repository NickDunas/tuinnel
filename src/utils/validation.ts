import { logger } from './logger.js';

export function validatePort(portStr: string, throwOnError = true): number | null {
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    if (throwOnError) {
      logger.error(`Invalid port: "${portStr}". Must be 1-65535.`);
      process.exit(1);
    }
    return null;
  }
  return port;
}

export function validateSubdomain(subdomain: string, throwOnError = true): string | null {
  const normalized = subdomain.toLowerCase();
  // RFC 1123: alphanumeric + hyphens, max 63 chars
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
    if (throwOnError) {
      logger.error(
        `Invalid subdomain: "${subdomain}". Must be lowercase alphanumeric with hyphens, ` +
        `cannot start or end with a hyphen, max 63 characters.`,
      );
      process.exit(1);
    }
    return null;
  }
  return normalized;
}
