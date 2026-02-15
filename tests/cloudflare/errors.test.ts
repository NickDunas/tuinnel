import { describe, test, expect } from 'bun:test';
import { classifyError, userMessage, type ErrorCategory } from '../../src/cloudflare/errors.js';

describe('classifyError', () => {
  test('401 -> fatal', () => {
    expect(classifyError(401, [])).toBe('fatal');
  });

  test('403 -> fatal', () => {
    expect(classifyError(403, [])).toBe('fatal');
  });

  test('409 -> recoverable', () => {
    expect(classifyError(409, [])).toBe('recoverable');
  });

  test('429 -> transient', () => {
    expect(classifyError(429, [])).toBe('transient');
  });

  test('500 -> transient', () => {
    expect(classifyError(500, [])).toBe('transient');
  });

  test('502 -> transient', () => {
    expect(classifyError(502, [])).toBe('transient');
  });

  test('503 -> transient', () => {
    expect(classifyError(503, [])).toBe('transient');
  });

  test('504 -> transient', () => {
    expect(classifyError(504, [])).toBe('transient');
  });

  test('CF error code 1003 -> fatal', () => {
    expect(classifyError(400, [{ code: 1003, message: 'Invalid token' }])).toBe('fatal');
  });

  test('CF error code 9109 -> recoverable', () => {
    expect(classifyError(400, [{ code: 9109, message: 'Tunnel name already exists' }])).toBe('recoverable');
  });

  test('CF error code 81053 -> recoverable', () => {
    expect(classifyError(400, [{ code: 81053, message: 'DNS record already exists' }])).toBe('recoverable');
  });

  test('unknown error -> fatal (safe default)', () => {
    expect(classifyError(400, [{ code: 99999, message: 'Unknown error' }])).toBe('fatal');
  });

  test('unknown status with no errors -> fatal', () => {
    expect(classifyError(418, [])).toBe('fatal');
  });

  test('multiple errors - first match wins', () => {
    const errors = [
      { code: 1003, message: 'Invalid token' },
      { code: 9109, message: 'Tunnel exists' },
    ];
    // 1003 is checked first, returns fatal
    expect(classifyError(400, errors)).toBe('fatal');
  });

  test('HTTP status takes priority over error codes for 401', () => {
    // Even with a recoverable error code, 401 is fatal
    expect(classifyError(401, [{ code: 9109, message: 'Tunnel exists' }])).toBe('fatal');
  });

  test('HTTP status takes priority over error codes for 429', () => {
    // Even with a fatal error code, 429 is transient
    expect(classifyError(429, [{ code: 1003, message: 'Invalid token' }])).toBe('transient');
  });

  test('HTTP status takes priority over error codes for 500', () => {
    // Even with a fatal error code, 500 is transient
    expect(classifyError(500, [{ code: 1003, message: 'Invalid token' }])).toBe('transient');
  });
});

describe('userMessage', () => {
  test('401 message includes authentication guidance', () => {
    const msg = userMessage(401, []);
    expect(msg).toContain('Authentication failed');
    expect(msg).toContain('api-tokens');
  });

  test('403 message includes permissions guidance', () => {
    const msg = userMessage(403, [{ code: 10000, message: 'Forbidden' }]);
    expect(msg).toContain('Insufficient permissions');
    expect(msg).toContain('Zone:Read');
    expect(msg).toContain('DNS:Edit');
  });

  test('409 message indicates resource reuse', () => {
    const msg = userMessage(409, [{ code: 9109, message: 'Tunnel already exists' }]);
    expect(msg).toContain('reusing existing resource');
  });

  test('429 message indicates rate limiting', () => {
    const msg = userMessage(429, []);
    expect(msg).toContain('Rate limited');
  });

  test('5xx message indicates server error', () => {
    const msg = userMessage(500, []);
    expect(msg).toContain('server error');
    expect(msg).toContain('500');
  });

  test('502 message includes status code', () => {
    const msg = userMessage(502, []);
    expect(msg).toContain('502');
  });

  test('generic error with error codes formats them', () => {
    const msg = userMessage(400, [
      { code: 1234, message: 'Something went wrong' },
    ]);
    expect(msg).toContain('[1234]');
    expect(msg).toContain('Something went wrong');
  });

  test('unknown status with no errors', () => {
    const msg = userMessage(418, []);
    expect(msg).toContain('unexpected status 418');
  });
});
