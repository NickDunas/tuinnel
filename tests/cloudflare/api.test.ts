import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';

// We need to mock the global fetch for API tests.
// Save the original and restore after each test.
const originalFetch = globalThis.fetch;

// Helper to create a mock CF API response
function cfResponse<T>(result: T, opts: {
  success?: boolean;
  errors?: Array<{ code: number; message: string }>;
  result_info?: { page: number; per_page: number; count: number; total_count: number; total_pages: number };
} = {}) {
  return {
    success: opts.success ?? true,
    errors: opts.errors ?? [],
    messages: [],
    result,
    ...(opts.result_info ? { result_info: opts.result_info } : {}),
  };
}

function mockFetchResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  }));
}

describe('cfFetch', () => {
  let cfFetch: typeof import('../../src/cloudflare/api.js').cfFetch;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    // Re-import the module fresh for each test to reset cached state
    const apiModule = await import('../../src/cloudflare/api.js');
    cfFetch = apiModule.cfFetch;
    clearAccountIdCache = apiModule.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('adds Authorization header', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(cfResponse('ok')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await cfFetch('/test', z.string(), 'my-test-token');
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer my-test-token');
  });

  test('adds Content-Type header only when body is present', async () => {
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify(cfResponse('ok')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // GET request (no body) should NOT have Content-Type
    await cfFetch('/test', z.string(), 'token');
    expect(capturedHeaders?.get('Content-Type')).toBeNull();

    // POST request (with body) should have Content-Type
    await cfFetch('/test', z.string(), 'token', { method: 'POST', body: { foo: 'bar' } });
    expect(capturedHeaders?.get('Content-Type')).toBe('application/json');
  });

  test('constructs correct URL with base and endpoint', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify(cfResponse('ok')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await cfFetch('/zones', z.string(), 'token');
    expect(capturedUrl).toContain('https://api.cloudflare.com/client/v4/zones');
  });

  test('no retry on 4xx (non-429)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({
        success: false,
        errors: [{ code: 1003, message: 'Invalid token' }],
        messages: [],
        result: null,
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await expect(cfFetch('/test', z.string(), 'bad-token')).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  test('retry on 429 with Retry-After header', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: 'Rate limited' }],
          messages: [],
          result: null,
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        });
      }
      return new Response(JSON.stringify(cfResponse('ok')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await cfFetch('/test', z.string(), 'token');
    expect(callCount).toBe(2);
    expect(result.result).toBe('ok');
  });

  test('retry once on 5xx with backoff', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: 'Server error' }],
          messages: [],
          result: null,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(cfResponse('ok')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await cfFetch('/test', z.string(), 'token');
    expect(callCount).toBe(2);
    expect(result.result).toBe('ok');
  });

  test('5xx retries exhaust after max retries', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: 'Server error' }],
        messages: [],
        result: null,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await expect(cfFetch('/test', z.string(), 'token')).rejects.toThrow();
    // 1 original + 1 retry = 2
    expect(callCount).toBe(2);
  });
});

describe('paginate', () => {
  let paginate: typeof import('../../src/cloudflare/api.js').paginate;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const apiModule = await import('../../src/cloudflare/api.js');
    paginate = apiModule.paginate;
    clearAccountIdCache = apiModule.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('yields all items across multiple pages', async () => {
    let callCount = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      callCount++;
      const url = typeof input === 'string' ? input : input.toString();
      const page = new URL(url).searchParams.get('page') || '1';

      if (page === '1') {
        return new Response(JSON.stringify(cfResponse(
          [{ id: '1', name: 'a' }, { id: '2', name: 'b' }],
          { result_info: { page: 1, per_page: 2, count: 2, total_count: 4, total_pages: 2 } },
        )), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(cfResponse(
        [{ id: '3', name: 'c' }, { id: '4', name: 'd' }],
        { result_info: { page: 2, per_page: 2, count: 2, total_count: 4, total_pages: 2 } },
      )), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const schema = z.object({ id: z.string(), name: z.string() });
    const items: Array<{ id: string; name: string }> = [];
    for await (const item of paginate('/test', schema, 'token')) {
      items.push(item);
    }

    expect(items).toHaveLength(4);
    expect(items[0].id).toBe('1');
    expect(items[3].id).toBe('4');
    expect(callCount).toBe(2);
  });

  test('stops when page >= total_pages', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify(cfResponse(
        [{ id: '1' }],
        { result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 } },
      )), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const schema = z.object({ id: z.string() });
    const items: Array<{ id: string }> = [];
    for await (const item of paginate('/test', schema, 'token')) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  test('stops when result_info is missing', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify(cfResponse([{ id: '1' }])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const schema = z.object({ id: z.string() });
    const items: Array<{ id: string }> = [];
    for await (const item of paginate('/test', schema, 'token')) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  test('sends per_page=50 in requests', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify(cfResponse(
        [{ id: '1' }],
        { result_info: { page: 1, per_page: 50, count: 1, total_count: 1, total_pages: 1 } },
      )), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const schema = z.object({ id: z.string() });
    for await (const _ of paginate('/test', schema, 'token')) {
      // consume
    }

    expect(capturedUrl).toContain('per_page=50');
  });
});

describe('discoverAccountId', () => {
  let discoverAccountId: typeof import('../../src/cloudflare/api.js').discoverAccountId;
  let clearAccountIdCache: typeof import('../../src/cloudflare/api.js').clearAccountIdCache;

  beforeEach(async () => {
    const apiModule = await import('../../src/cloudflare/api.js');
    discoverAccountId = apiModule.discoverAccountId;
    clearAccountIdCache = apiModule.clearAccountIdCache;
    clearAccountIdCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('caches result after first call', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify(cfResponse(
        [{
          id: 'zone-1',
          name: 'example.com',
          status: 'active',
          account: { id: 'acct-123', name: 'My Account' },
        }],
      )), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const id1 = await discoverAccountId('token');
    const id2 = await discoverAccountId('token');

    expect(id1).toBe('acct-123');
    expect(id2).toBe('acct-123');
    // Should only have fetched once due to caching
    expect(callCount).toBe(1);
  });

  test('throws when no zones found', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify(cfResponse([])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await expect(discoverAccountId('token')).rejects.toThrow('No zones found');
  });

  test('clearAccountIdCache allows re-fetch', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return new Response(JSON.stringify(cfResponse(
        [{
          id: 'zone-1',
          name: 'example.com',
          status: 'active',
          account: { id: `acct-${callCount}`, name: 'My Account' },
        }],
      )), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const id1 = await discoverAccountId('token');
    expect(id1).toBe('acct-1');

    clearAccountIdCache();

    const id2 = await discoverAccountId('token');
    expect(id2).toBe('acct-2');
    expect(callCount).toBe(2);
  });
});
