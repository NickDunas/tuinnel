import { z } from 'zod';
import {
  cfResponseSchema,
  ZoneSchema,
  TunnelSchema,
  DNSRecordSchema,
  type Zone,
  type Tunnel,
  type DNSRecord,
  type TunnelConfiguration,
  type CFError,
  type CFResultInfo,
} from './types.js';
import { classifyError, userMessage } from './errors.js';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;
const MAX_429_RETRIES = 3;
const MAX_5XX_RETRIES = 1;
const MAX_NETWORK_RETRIES = 1;

// -- Cached account ID --

let cachedAccountId: string | null = null;

// -- Core fetch with timeout, validation, and retry --

interface CFResponse<T> {
  success: boolean;
  errors: CFError[];
  messages: CFError[];
  result: T;
  result_info?: CFResultInfo;
}

interface CfFetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
}

export async function cfFetch<T extends z.ZodType>(
  endpoint: string,
  schema: T,
  token: string,
  opts: CfFetchOptions = {},
): Promise<CFResponse<z.infer<T>>> {
  const url = buildUrl(endpoint, opts.params);
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const requestInit: RequestInit = {
    method: opts.method ?? 'GET',
    headers,
  };
  if (opts.body !== undefined) {
    requestInit.body = JSON.stringify(opts.body);
  }

  return fetchWithRetry(url, requestInit, schema);
}

function buildUrl(endpoint: string, params?: Record<string, string>): string {
  const url = new URL(`${CF_API_BASE}${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchWithRetry<T extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: T,
  retryState: { retries429: number; retries5xx: number; retriesNetwork: number } = {
    retries429: 0,
    retries5xx: 0,
    retriesNetwork: 0,
  },
): Promise<CFResponse<z.infer<T>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    // Network error or timeout — retry once after 2s
    if (retryState.retriesNetwork < MAX_NETWORK_RETRIES) {
      retryState.retriesNetwork++;
      await sleep(2000);
      return fetchWithRetry(url, init, schema, retryState);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      throw new Error('error: Cloudflare API request timed out after 30 seconds\n\nCheck your network connection and try again.');
    }
    throw new Error(`error: Network error connecting to Cloudflare API\n\n${message}`);
  } finally {
    clearTimeout(timeout);
  }

  // Handle 429 rate limiting
  if (res.status === 429 && retryState.retries429 < MAX_429_RETRIES) {
    retryState.retries429++;
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    await sleep(retryAfter);
    return fetchWithRetry(url, init, schema, retryState);
  }

  // Handle 5xx server errors
  if (res.status >= 500 && retryState.retries5xx < MAX_5XX_RETRIES) {
    retryState.retries5xx++;
    const backoff = retryState.retries5xx * 1000; // 1s, 2s
    await sleep(backoff);
    return fetchWithRetry(url, init, schema, retryState);
  }

  const json = await res.json().catch(() => {
    throw new Error(`error: Cloudflare API returned non-JSON response (status ${res.status})`);
  }) as Record<string, unknown>;

  // Validate the response envelope
  const envelopeSchema = cfResponseSchema(schema);
  const parsed = envelopeSchema.safeParse(json);

  if (!parsed.success) {
    // If Zod parsing fails, check if the API returned errors
    const rawErrors = Array.isArray(json.errors) ? json.errors as CFError[] : [];
    if (!json.success && rawErrors.length > 0) {
      throw new Error(userMessage(res.status, rawErrors));
    }
    throw new Error(`error: Unexpected response from Cloudflare API\n\nStatus: ${res.status}\nValidation: ${parsed.error.message}`);
  }

  const data = parsed.data as CFResponse<z.infer<T>>;

  // Check for API-level errors
  if (!data.success) {
    const category = classifyError(res.status, data.errors);
    if (category === 'recoverable') {
      // Return the response as-is — caller handles recoverable errors
      return data;
    }
    throw new Error(userMessage(res.status, data.errors));
  }

  return data;
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1000;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  // Retry-After can also be a date
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -- Pagination generator --

export async function* paginate<T>(
  endpoint: string,
  schema: z.ZodType<T>,
  token: string,
  params: Record<string, string> = {},
): AsyncGenerator<T> {
  let page = 1;
  while (true) {
    const response = await cfFetch(
      endpoint,
      z.array(schema),
      token,
      { params: { ...params, page: String(page), per_page: '50' } },
    );
    const items = response.result;
    for (const item of items) {
      yield item;
    }
    const info = response.result_info;
    if (!info
      || (info.total_pages != null && info.page >= info.total_pages)
      || items.length === 0
      || (info.per_page != null && items.length < info.per_page)) {
      break;
    }
    page++;
  }
}

// -- Helper to collect all items from a paginated endpoint --

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

// -- Zone operations --

export function listZones(token: string): AsyncGenerator<Zone> {
  return paginate('/zones', ZoneSchema, token);
}

export async function getAllZones(token: string): Promise<Zone[]> {
  return collectAll(listZones(token));
}

// -- Account ID discovery --

export async function discoverAccountId(token: string): Promise<string> {
  if (cachedAccountId) return cachedAccountId;

  const response = await cfFetch(
    '/zones',
    z.array(ZoneSchema),
    token,
    { params: { per_page: '1' } },
  );

  if (response.result.length === 0) {
    throw new Error('error: No zones found\n\nYour API token has access to zero zones.\nMake sure your token has Zone:Read permission and at least one active zone.');
  }

  cachedAccountId = response.result[0].account.id;
  return cachedAccountId;
}

export function clearAccountIdCache(): void {
  cachedAccountId = null;
}

// -- Token validation --

export async function validateToken(token: string): Promise<{ valid: boolean; zones: Zone[]; error?: string }> {
  try {
    const zones = await getAllZones(token);
    return { valid: true, zones };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, zones: [], error: message };
  }
}

// -- Tunnel operations --

export function listTunnels(accountId: string, token: string): AsyncGenerator<Tunnel> {
  return paginate(
    `/accounts/${accountId}/cfd_tunnel`,
    TunnelSchema,
    token,
    { is_deleted: 'false' },
  );
}

export async function getAllTunnels(accountId: string, token: string): Promise<Tunnel[]> {
  return collectAll(listTunnels(accountId, token));
}

export async function createTunnel(
  accountId: string,
  name: string,
  token: string,
): Promise<Tunnel> {
  const response = await cfFetch(
    `/accounts/${accountId}/cfd_tunnel`,
    TunnelSchema,
    token,
    {
      method: 'POST',
      body: { name, config_src: 'cloudflare' },
    },
  );
  return response.result;
}

export async function getTunnelByName(
  accountId: string,
  name: string,
  token: string,
): Promise<Tunnel | null> {
  const response = await cfFetch(
    `/accounts/${accountId}/cfd_tunnel`,
    z.array(TunnelSchema),
    token,
    { params: { name, is_deleted: 'false' } },
  );
  return response.result.length > 0 ? response.result[0] : null;
}

export async function getTunnelToken(
  accountId: string,
  tunnelId: string,
  token: string,
): Promise<string> {
  const response = await cfFetch(
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
    z.string(),
    token,
  );
  return response.result;
}

export async function deleteTunnel(
  accountId: string,
  tunnelId: string,
  token: string,
): Promise<void> {
  await cfFetch(
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}`,
    TunnelSchema,
    token,
    { method: 'DELETE' },
  );
}

// -- Tunnel configuration (ingress) --

export async function updateTunnelConfig(
  accountId: string,
  tunnelId: string,
  config: TunnelConfiguration,
  token: string,
): Promise<void> {
  await cfFetch(
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
    z.unknown(),
    token,
    {
      method: 'PUT',
      body: config,
    },
  );
}

// -- DNS operations --

export function listDnsRecords(
  zoneId: string,
  token: string,
  params: Record<string, string> = {},
): AsyncGenerator<DNSRecord> {
  return paginate(`/zones/${zoneId}/dns_records`, DNSRecordSchema, token, params);
}

export async function createDnsRecord(
  zoneId: string,
  record: { type: string; name: string; content: string; proxied: boolean; ttl: number },
  token: string,
): Promise<DNSRecord> {
  const response = await cfFetch(
    `/zones/${zoneId}/dns_records`,
    DNSRecordSchema,
    token,
    {
      method: 'POST',
      body: record,
    },
  );
  return response.result;
}

export async function updateDnsRecord(
  zoneId: string,
  recordId: string,
  record: { type: string; name: string; content: string; proxied: boolean; ttl: number },
  token: string,
): Promise<DNSRecord> {
  const response = await cfFetch(
    `/zones/${zoneId}/dns_records/${recordId}`,
    DNSRecordSchema,
    token,
    {
      method: 'PUT',
      body: record,
    },
  );
  return response.result;
}

export async function deleteDnsRecord(
  zoneId: string,
  recordId: string,
  token: string,
): Promise<void> {
  await cfFetch(
    `/zones/${zoneId}/dns_records/${recordId}`,
    z.object({ id: z.string() }),
    token,
    { method: 'DELETE' },
  );
}
