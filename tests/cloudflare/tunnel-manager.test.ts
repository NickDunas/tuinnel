import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';

// Save originals for restoration
const originalFetch = globalThis.fetch;

// -- Mock CF API response helpers --

function cfSuccess<T>(result: T, opts: {
  result_info?: { page: number; per_page: number; count: number; total_count: number; total_pages: number };
} = {}) {
  return {
    success: true,
    errors: [],
    messages: [],
    result,
    ...(opts.result_info ? { result_info: opts.result_info } : {}),
  };
}

function cfError(code: number, message: string) {
  return {
    success: false,
    errors: [{ code, message }],
    messages: [],
    result: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// -- Test data factories --

function makeTunnel(overrides: Partial<{
  id: string; name: string; status: string; created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: overrides.name ?? 'tuinnel-myapp',
    status: overrides.status ?? 'inactive',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    connections: [],
  };
}

function makeZone(overrides: Partial<{
  id: string; name: string; status: string; accountId: string; accountName: string;
}> = {}) {
  return {
    id: overrides.id ?? 'zone-id-1',
    name: overrides.name ?? 'example.com',
    status: overrides.status ?? 'active',
    account: {
      id: overrides.accountId ?? 'acct-123',
      name: overrides.accountName ?? 'My Account',
    },
  };
}

function makeDnsRecord(overrides: Partial<{
  id: string; type: string; name: string; content: string; proxied: boolean; ttl: number;
}> = {}) {
  return {
    id: overrides.id ?? 'dns-rec-1',
    type: overrides.type ?? 'CNAME',
    name: overrides.name ?? 'app.example.com',
    content: overrides.content ?? 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cfargotunnel.com',
    proxied: overrides.proxied ?? true,
    ttl: overrides.ttl ?? 1,
  };
}

// ============================================================
// createOrGetTunnel
// ============================================================

describe('createOrGetTunnel', () => {
  let createOrGetTunnel: typeof import('../../src/cloudflare/tunnel-manager.js').createOrGetTunnel;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const tm = await import('../../src/cloudflare/tunnel-manager.js');
    createOrGetTunnel = tm.createOrGetTunnel;
    const api = await import('../../src/cloudflare/api.js');
    clearAccountIdCache = api.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('successful creation returns tunnelId and connectorToken', async () => {
    const tunnel = makeTunnel();
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // POST to create tunnel
      if (url.includes('/cfd_tunnel') && method === 'POST') {
        return jsonResponse(cfSuccess(tunnel));
      }
      // GET tunnel token
      if (url.includes('/token')) {
        return jsonResponse(cfSuccess('my-connector-token'));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrGetTunnel('acct-123', 'myapp', 'token');
    expect(result.tunnelId).toBe(tunnel.id);
    expect(result.connectorToken).toBe('my-connector-token');
  });

  test('409 conflict fetches existing tunnel by name', async () => {
    const tunnel = makeTunnel({ name: 'tuinnel-myapp' });
    let fetchCallUrls: string[] = [];

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      fetchCallUrls.push(`${method} ${url}`);

      // POST to create tunnel -> 409 conflict (recoverable)
      if (url.includes('/cfd_tunnel') && method === 'POST' && !url.includes('/token')) {
        return jsonResponse({
          success: false,
          errors: [{ code: 409, message: 'Tunnel already exists' }],
          messages: [],
          result: tunnel, // CF returns the conflicting tunnel data but success=false
        }, 409);
      }
      // GET tunnels by name
      if (url.includes('/cfd_tunnel') && method === 'GET' && url.includes('name=') && !url.includes('/token')) {
        return jsonResponse(cfSuccess([tunnel]));
      }
      // GET tunnel token
      if (url.includes('/token')) {
        return jsonResponse(cfSuccess('existing-token'));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrGetTunnel('acct-123', 'myapp', 'token');
    expect(result.tunnelId).toBe(tunnel.id);
    expect(result.connectorToken).toBe('existing-token');
  });

  test('409 but tunnel not found throws descriptive error', async () => {
    const tunnel = makeTunnel();
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // POST -> 409 conflict
      if (url.includes('/cfd_tunnel') && method === 'POST' && !url.includes('/token')) {
        return jsonResponse({
          success: false,
          errors: [{ code: 409, message: 'Tunnel already exists' }],
          messages: [],
          result: tunnel,
        }, 409);
      }
      // GET by name -> empty (not found)
      if (url.includes('/cfd_tunnel') && method === 'GET' && !url.includes('/token')) {
        return jsonResponse(cfSuccess([]));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await expect(createOrGetTunnel('acct-123', 'myapp', 'token'))
      .rejects.toThrow('reported as existing but could not be found');
  });

  test('other API error propagates', async () => {
    globalThis.fetch = async () => {
      return jsonResponse({
        success: false,
        errors: [{ code: 1003, message: 'Authentication error' }],
        messages: [],
        result: null,
      }, 401);
    };

    await expect(createOrGetTunnel('acct-123', 'myapp', 'token'))
      .rejects.toThrow();
  });

  test('token fetch fails throws error', async () => {
    const tunnel = makeTunnel();
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // POST tunnel -> success
      if (url.includes('/cfd_tunnel') && method === 'POST') {
        return jsonResponse(cfSuccess(tunnel));
      }
      // GET token -> fail
      if (url.includes('/token')) {
        return jsonResponse({
          success: false,
          errors: [{ code: 1000, message: 'Token retrieval failed' }],
          messages: [],
          result: null,
        }, 403);
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await expect(createOrGetTunnel('acct-123', 'myapp', 'token'))
      .rejects.toThrow();
  });

  test('name is prefixed with tuinnel-', async () => {
    const tunnel = makeTunnel({ name: 'tuinnel-myapp' });
    let capturedBody: any;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/cfd_tunnel') && method === 'POST') {
        capturedBody = JSON.parse(init?.body as string);
        return jsonResponse(cfSuccess(tunnel));
      }
      if (url.includes('/token')) {
        return jsonResponse(cfSuccess('tok'));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await createOrGetTunnel('acct-123', 'myapp', 'token');
    expect(capturedBody.name).toBe('tuinnel-myapp');
  });
});

// ============================================================
// updateIngress
// ============================================================

describe('updateIngress', () => {
  let updateIngress: typeof import('../../src/cloudflare/tunnel-manager.js').updateIngress;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const tm = await import('../../src/cloudflare/tunnel-manager.js');
    updateIngress = tm.updateIngress;
    const api = await import('../../src/cloudflare/api.js');
    clearAccountIdCache = api.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('happy path sends correct ingress config', async () => {
    let capturedBody: any;
    let capturedUrl: string | undefined;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse(cfSuccess({ success: true }));
    };

    await updateIngress('acct-1', 'tun-1', 'app.example.com', 3000, 'http', 'tok');

    expect(capturedUrl).toContain('/configurations');
    expect(capturedBody.config.ingress).toHaveLength(2);
    expect(capturedBody.config.ingress[0].hostname).toBe('app.example.com');
    expect(capturedBody.config.ingress[0].service).toBe('http://127.0.0.1:3000');
    expect(capturedBody.config.ingress[1].service).toBe('http_status:404');
  });

  test('API error propagates', async () => {
    globalThis.fetch = async () => {
      return jsonResponse({
        success: false,
        errors: [{ code: 1000, message: 'Config update failed' }],
        messages: [],
        result: null,
      }, 400);
    };

    await expect(updateIngress('acct-1', 'tun-1', 'app.example.com', 3000, 'http', 'tok'))
      .rejects.toThrow();
  });

  test('HTTPS protocol passed to buildSingleIngress', async () => {
    let capturedBody: any;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse(cfSuccess({ success: true }));
    };

    await updateIngress('acct-1', 'tun-1', 'app.example.com', 443, 'https', 'tok');

    expect(capturedBody.config.ingress[0].service).toBe('https://127.0.0.1:443');
    expect(capturedBody.config.ingress[0].originRequest.noTLSVerify).toBe(true);
  });

  test('custom loopback address passed through', async () => {
    let capturedBody: any;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse(cfSuccess({ success: true }));
    };

    await updateIngress('acct-1', 'tun-1', 'app.example.com', 3000, 'http', 'tok', '[::1]');

    expect(capturedBody.config.ingress[0].service).toBe('http://[::1]:3000');
  });
});

// ============================================================
// createOrVerifyDns
// ============================================================

describe('createOrVerifyDns', () => {
  let createOrVerifyDns: typeof import('../../src/cloudflare/tunnel-manager.js').createOrVerifyDns;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const tm = await import('../../src/cloudflare/tunnel-manager.js');
    createOrVerifyDns = tm.createOrVerifyDns;
    const api = await import('../../src/cloudflare/api.js');
    clearAccountIdCache = api.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('no existing record creates new DNS record', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const newRecord = makeDnsRecord({ content: `${tunnelId}.cfargotunnel.com` });
    let createCalled = false;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // List DNS records -> empty (none exist)
      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([], {
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
        }));
      }
      // Create DNS record
      if (url.includes('/dns_records') && method === 'POST') {
        createCalled = true;
        return jsonResponse(cfSuccess(newRecord));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(true);
    expect(result.recordId).toBe(newRecord.id);
    expect(createCalled).toBe(true);
  });

  test('existing record pointing to our tunnel is a no-op', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const existing = makeDnsRecord({
      name: 'app.example.com',
      content: `${tunnelId}.cfargotunnel.com`,
    });

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([existing], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(false);
    expect(result.recordId).toBe(existing.id);
    expect(result.conflict).toBeUndefined();
  });

  test('existing record pointing to different tunnel calls updateDnsRecord', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const oldContent = 'old-tunnel-id.cfargotunnel.com';
    const existing = makeDnsRecord({
      id: 'dns-old',
      name: 'app.example.com',
      content: oldContent,
    });
    const updated = makeDnsRecord({
      id: 'dns-old',
      name: 'app.example.com',
      content: `${tunnelId}.cfargotunnel.com`,
    });
    let updateCalled = false;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([existing], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      if (url.includes('/dns_records/dns-old') && method === 'PUT') {
        updateCalled = true;
        return jsonResponse(cfSuccess(updated));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(false);
    expect(result.conflict).toBe(oldContent);
    expect(updateCalled).toBe(true);
  });

  test('CNAME content format is tunnelId.cfargotunnel.com', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    let createBody: any;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([], {
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
        }));
      }
      if (url.includes('/dns_records') && method === 'POST') {
        createBody = JSON.parse(init?.body as string);
        return jsonResponse(cfSuccess(makeDnsRecord()));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(createBody.content).toBe(`${tunnelId}.cfargotunnel.com`);
  });

  test('create call uses proxied=true and ttl=1', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    let createBody: any;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([], {
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
        }));
      }
      if (url.includes('/dns_records') && method === 'POST') {
        createBody = JSON.parse(init?.body as string);
        return jsonResponse(cfSuccess(makeDnsRecord()));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(createBody.proxied).toBe(true);
    expect(createBody.ttl).toBe(1);
  });

  test('listDnsRecords error propagates', async () => {
    globalThis.fetch = async () => {
      return jsonResponse({
        success: false,
        errors: [{ code: 1000, message: 'DNS list failed' }],
        messages: [],
        result: null,
      }, 500);
    };

    await expect(createOrVerifyDns('zone-1', 'app.example.com', 'tun-id', 'tok'))
      .rejects.toThrow();
  });

  test('createDnsRecord error propagates', async () => {
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([], {
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
        }));
      }
      // POST -> error (but not a 409 conflict, an actual server error)
      if (url.includes('/dns_records') && method === 'POST') {
        return jsonResponse({
          success: false,
          errors: [{ code: 1000, message: 'DNS creation error' }],
          messages: [],
          result: null,
        }, 500);
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    await expect(createOrVerifyDns('zone-1', 'app.example.com', 'tun-id', 'tok'))
      .rejects.toThrow();
  });

  test('pagination across 2 pages checks all records', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const page1Record = makeDnsRecord({
      id: 'dns-1',
      name: 'other.example.com',
      content: 'other.cfargotunnel.com',
    });
    const page2Record = makeDnsRecord({
      id: 'dns-2',
      name: 'app.example.com',
      content: `${tunnelId}.cfargotunnel.com`,
    });

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        const page = new URL(url).searchParams.get('page') || '1';
        if (page === '1') {
          return jsonResponse(cfSuccess([page1Record], {
            result_info: { page: 1, per_page: 1, count: 1, total_count: 2, total_pages: 2 },
          }));
        }
        return jsonResponse(cfSuccess([page2Record], {
          result_info: { page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 },
        }));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(false);
    expect(result.recordId).toBe('dns-2');
  });

  test('A record is skipped (only CNAME matched)', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const aRecord = makeDnsRecord({
      id: 'dns-a',
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
    });
    const newCname = makeDnsRecord({
      id: 'dns-new',
      content: `${tunnelId}.cfargotunnel.com`,
    });

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([aRecord], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      if (url.includes('/dns_records') && method === 'POST') {
        return jsonResponse(cfSuccess(newCname));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    // The A record should be skipped, and a new CNAME record created
    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(true);
    expect(result.recordId).toBe('dns-new');
  });

  test('DNS create conflict (409) re-queries and finds existing pointing to our tunnel', async () => {
    const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const existingRecord = makeDnsRecord({
      id: 'dns-existing',
      name: 'app.example.com',
      content: `${tunnelId}.cfargotunnel.com`,
    });
    let listCallCount = 0;

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url.includes('/dns_records') && method === 'GET') {
        listCallCount++;
        if (listCallCount === 1) {
          // First list: empty (race condition — someone else created it)
          return jsonResponse(cfSuccess([], {
            result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
          }));
        }
        // Second list: the record now exists
        return jsonResponse(cfSuccess([existingRecord], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      // POST -> 409 conflict (recoverable)
      if (url.includes('/dns_records') && method === 'POST') {
        return jsonResponse({
          success: false,
          errors: [{ code: 409, message: 'Record already exists' }],
          messages: [],
          result: existingRecord,
        }, 409);
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    const result = await createOrVerifyDns('zone-1', 'app.example.com', tunnelId, 'tok');
    expect(result.created).toBe(false);
    expect(result.recordId).toBe('dns-existing');
  });
});

// ============================================================
// startTunnel
// ============================================================

describe('startTunnel', () => {
  let startTunnel: typeof import('../../src/cloudflare/tunnel-manager.js').startTunnel;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  // We need to mock several modules for startTunnel:
  // - fetch (CF API calls)
  // - ensureBinary (binary download)
  // - spawnCloudflared (process spawn)
  // - resolveLoopback (port detection)
  // - writePid/removePid (PID tracking)

  const tunnelId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const zone = makeZone();
  const tunnel = makeTunnel({ id: tunnelId });
  const dnsRecord = makeDnsRecord({ content: `${tunnelId}.cfargotunnel.com`, name: 'app.example.com' });

  // Set up a standard mock fetch that handles the full startTunnel flow
  function setupHappyPathFetch() {
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      // discoverAccountId: GET /zones?per_page=1
      if (url.includes('/zones') && url.includes('per_page=1')) {
        return jsonResponse(cfSuccess([zone]));
      }
      // getAllZones: GET /zones (paginated)
      if (url.includes('/zones') && !url.includes('dns_records') && !url.includes('per_page=1')) {
        return jsonResponse(cfSuccess([zone], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      // createTunnel: POST /cfd_tunnel
      if (url.includes('/cfd_tunnel') && method === 'POST' && !url.includes('/configurations') && !url.includes('/token')) {
        return jsonResponse(cfSuccess(tunnel));
      }
      // getTunnelToken: GET /cfd_tunnel/{id}/token
      if (url.includes('/token') && method === 'GET') {
        return jsonResponse(cfSuccess('connector-token-abc'));
      }
      // updateTunnelConfig: PUT /configurations
      if (url.includes('/configurations') && method === 'PUT') {
        return jsonResponse(cfSuccess({ success: true }));
      }
      // listDnsRecords: GET /dns_records
      if (url.includes('/dns_records') && method === 'GET') {
        return jsonResponse(cfSuccess([], {
          result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 },
        }));
      }
      // createDnsRecord: POST /dns_records
      if (url.includes('/dns_records') && method === 'POST') {
        return jsonResponse(cfSuccess(dnsRecord));
      }
      // deleteDnsRecord, deleteTunnel (cleanup paths)
      if (method === 'DELETE') {
        return jsonResponse(cfSuccess({ id: 'deleted' }));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };
  }

  beforeEach(async () => {
    const tm = await import('../../src/cloudflare/tunnel-manager.js');
    startTunnel = tm.startTunnel;
    const api = await import('../../src/cloudflare/api.js');
    clearAccountIdCache = api.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Restore any mocked modules
    mock.restore();
  });

  test('full happy path calls all 4 steps and returns correct result', async () => {
    setupHappyPathFetch();

    // Mock ensureBinary
    const binaryMod = await import('../../src/cloudflared/binary.js');
    mock.module('../../src/cloudflared/binary.js', () => ({
      ...binaryMod,
      ensureBinary: async () => '/usr/local/bin/cloudflared',
    }));

    // Mock spawnCloudflared
    const mockProcess = {
      child: {} as any,
      pid: 12345,
      kill: async () => {},
      onStderr: () => {},
    };
    mock.module('../../src/cloudflared/process.js', () => ({
      spawnCloudflared: () => mockProcess,
    }));

    // Mock writePid/removePid
    const pidWriteCalls: any[] = [];
    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: (name: string, pid: number) => { pidWriteCalls.push({ name, pid }); },
      removePid: () => {},
    }));

    // Mock resolveLoopback
    mock.module('../../src/utils/port-probe.js', () => ({
      resolveLoopback: async () => '127.0.0.1',
    }));

    // Re-import after mocking
    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    const freshApi = await import('../../src/cloudflare/api.js');
    freshApi.clearAccountIdCache();

    const result = await freshTm.startTunnel('myapp', {
      port: 3000,
      subdomain: 'app',
      zone: 'example.com',
      protocol: 'http',
    }, 'token');

    expect(result.tunnelId).toBe(tunnelId);
    expect(result.publicUrl).toBe('https://app.example.com');
    expect(result.dnsRecordId).toBe(dnsRecord.id);
  });

  test('zone not found throws error with available zones', async () => {
    const zone2 = makeZone({ name: 'other.com' });
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/zones') && url.includes('per_page=1')) {
        return jsonResponse(cfSuccess([zone2]));
      }
      if (url.includes('/zones')) {
        return jsonResponse(cfSuccess([zone2], {
          result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 },
        }));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    mock.module('../../src/cloudflared/binary.js', () => ({
      ensureBinary: async () => '/bin/cloudflared',
    }));
    mock.module('../../src/cloudflared/process.js', () => ({
      spawnCloudflared: () => ({ child: {}, pid: 1, kill: async () => {}, onStderr: () => {} }),
    }));
    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));
    mock.module('../../src/utils/port-probe.js', () => ({
      resolveLoopback: async () => '127.0.0.1',
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    const freshApi = await import('../../src/cloudflare/api.js');
    freshApi.clearAccountIdCache();

    await expect(freshTm.startTunnel('myapp', {
      port: 3000,
      subdomain: 'app',
      zone: 'notfound.com',
      protocol: 'http',
    }, 'token')).rejects.toThrow('not found');
  });
});

// ============================================================
// stopTunnel
// ============================================================

describe('stopTunnel', () => {
  let stopTunnel: typeof import('../../src/cloudflare/tunnel-manager.js').stopTunnel;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const tm = await import('../../src/cloudflare/tunnel-manager.js');
    stopTunnel = tm.stopTunnel;
    const api = await import('../../src/cloudflare/api.js');
    clearAccountIdCache = api.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('stop without cleanup kills process and removes PID', async () => {
    let killCalled = false;
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => { killCalled = true; },
      onStderr: () => {},
    };

    let pidRemoved = false;
    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: (name: string) => { pidRemoved = true; },
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    await freshTm.stopTunnel('myapp', mockProc, false);

    expect(killCalled).toBe(true);
    expect(pidRemoved).toBe(true);
  });

  test('stop with cleanup deletes DNS and tunnel', async () => {
    let killCalled = false;
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => { killCalled = true; },
      onStderr: () => {},
    };

    let deletedUrls: string[] = [];
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        deletedUrls.push(url);
        if (url.includes('/dns_records')) {
          return jsonResponse(cfSuccess({ id: 'dns-del' }));
        }
        return jsonResponse(cfSuccess(makeTunnel()));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    await freshTm.stopTunnel('myapp', mockProc, true, {
      accountId: 'acct-1',
      tunnelId: 'tun-1',
      dnsZoneId: 'zone-1',
      dnsRecordId: 'dns-1',
      token: 'tok',
    });

    expect(killCalled).toBe(true);
    expect(deletedUrls.length).toBe(2);
    expect(deletedUrls.some(u => u.includes('/dns_records'))).toBe(true);
    expect(deletedUrls.some(u => u.includes('/cfd_tunnel'))).toBe(true);
  });

  test('DNS deletion failure does not prevent tunnel deletion', async () => {
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => {},
      onStderr: () => {},
    };

    let tunnelDeleteCalled = false;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url.includes('/dns_records')) {
        return jsonResponse({
          success: false,
          errors: [{ code: 1000, message: 'DNS delete failed' }],
          messages: [],
          result: null,
        }, 500);
      }
      if (method === 'DELETE' && url.includes('/cfd_tunnel')) {
        tunnelDeleteCalled = true;
        return jsonResponse(cfSuccess(makeTunnel()));
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    // Should not throw even though DNS delete fails
    await freshTm.stopTunnel('myapp', mockProc, true, {
      accountId: 'acct-1',
      tunnelId: 'tun-1',
      dnsZoneId: 'zone-1',
      dnsRecordId: 'dns-1',
      token: 'tok',
    });

    expect(tunnelDeleteCalled).toBe(true);
  });

  test('tunnel deletion failure does not crash', async () => {
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => {},
      onStderr: () => {},
    };

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (method === 'DELETE' && url.includes('/dns_records')) {
        return jsonResponse(cfSuccess({ id: 'dns-del' }));
      }
      if (method === 'DELETE' && url.includes('/cfd_tunnel')) {
        return jsonResponse({
          success: false,
          errors: [{ code: 1000, message: 'Tunnel delete failed' }],
          messages: [],
          result: null,
        }, 500);
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    // Should not throw
    await freshTm.stopTunnel('myapp', mockProc, true, {
      accountId: 'acct-1',
      tunnelId: 'tun-1',
      dnsZoneId: 'zone-1',
      dnsRecordId: 'dns-1',
      token: 'tok',
    });
  });

  test('both deletions fail gracefully', async () => {
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => {},
      onStderr: () => {},
    };

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        return jsonResponse({
          success: false,
          errors: [{ code: 1000, message: 'Delete failed' }],
          messages: [],
          result: null,
        }, 500);
      }
      return jsonResponse(cfError(404, 'Not found'), 404);
    };

    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    // Should not throw even when both fail
    await freshTm.stopTunnel('myapp', mockProc, true, {
      accountId: 'acct-1',
      tunnelId: 'tun-1',
      dnsZoneId: 'zone-1',
      dnsRecordId: 'dns-1',
      token: 'tok',
    });
  });

  test('process kill failure is handled', async () => {
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => { throw new Error('Kill failed'); },
      onStderr: () => {},
    };

    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: () => {},
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    // Kill error propagates (not caught in stopTunnel)
    await expect(freshTm.stopTunnel('myapp', mockProc, false))
      .rejects.toThrow('Kill failed');
  });

  test('PID removal uses correct name', async () => {
    const mockProc = {
      child: {} as any,
      pid: 999,
      kill: async () => {},
      onStderr: () => {},
    };

    let removedName: string | undefined;
    mock.module('../../src/cloudflared/pid.js', () => ({
      writePid: () => {},
      removePid: (name: string) => { removedName = name; },
    }));

    const freshTm = await import('../../src/cloudflare/tunnel-manager.js');
    await freshTm.stopTunnel('my-tunnel-name', mockProc, false);

    expect(removedName).toBe('my-tunnel-name');
  });
});
