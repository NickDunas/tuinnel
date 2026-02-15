import type { CFError } from './types.js';

export type ErrorCategory = 'fatal' | 'recoverable' | 'transient';

export function classifyError(status: number, errors: CFError[]): ErrorCategory {
  // Fatal: bad credentials, insufficient permissions
  if (status === 401 || status === 403) return 'fatal';

  // Recoverable: resource already exists (tunnel, DNS record)
  if (status === 409) return 'recoverable';

  // Transient: rate limited
  if (status === 429) return 'transient';

  // Transient: server errors
  if (status >= 500) return 'transient';

  // Check specific CF error codes
  for (const err of errors) {
    if (err.code === 1003) return 'fatal';       // Invalid token
    if (err.code === 9109) return 'recoverable'; // Tunnel name already exists
    if (err.code === 81053) return 'recoverable'; // DNS record already exists
  }

  // Default: fatal (unknown errors should not be retried)
  return 'fatal';
}

export function userMessage(status: number, errors: CFError[]): string {
  if (status === 401) {
    return 'error: Authentication failed\n\nYour API token is invalid or expired.\nCreate a new token at: https://dash.cloudflare.com/profile/api-tokens';
  }

  if (status === 403) {
    const msg = errors.map(e => e.message).join('; ') || 'Forbidden';
    return `error: Insufficient permissions — ${msg}\n\nYour API token may not have access to this zone.\nCheck token permissions at: https://dash.cloudflare.com/profile/api-tokens\nRequired permissions: Zone:Read, DNS:Edit, Cloudflare Tunnel:Edit`;
  }

  if (status === 409) {
    const msg = errors.map(e => e.message).join('; ') || 'Resource already exists';
    return `${msg} (this is usually fine — reusing existing resource)`;
  }

  if (status === 429) {
    return 'error: Rate limited by Cloudflare API\n\nToo many requests. Retrying automatically...';
  }

  if (status >= 500) {
    return `error: Cloudflare API server error (${status})\n\nThis is usually temporary. Retrying automatically...`;
  }

  if (errors.length > 0) {
    const messages = errors.map(e => `  [${e.code}] ${e.message}`).join('\n');
    return `error: Cloudflare API error (${status})\n\n${messages}`;
  }

  return `error: Cloudflare API returned unexpected status ${status}`;
}
