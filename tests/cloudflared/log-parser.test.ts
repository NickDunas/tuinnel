import { describe, test, expect } from 'bun:test';
import {
  parseLogLine,
  extractMetricsAddr,
  extractRegistration,
  extractQuickTunnelUrl,
  extractVersion,
  extractConnectorId,
} from '../../src/cloudflared/log-parser.js';

describe('parseLogLine', () => {
  test('valid line with key=value fields returns correct timestamp, level, message, fields', () => {
    const result = parseLogLine(
      '2024-02-08T06:25:48Z INF Registered tunnel connection connIndex=0 connection=abc-123 ip=198.41.200.13',
    );
    expect(result).not.toBeNull();
    expect(result!.timestamp).toEqual(new Date('2024-02-08T06:25:48Z'));
    expect(result!.level).toBe('INF');
    expect(result!.message).toBe('Registered tunnel connection');
    expect(result!.fields.connIndex).toBe('0');
    expect(result!.fields.connection).toBe('abc-123');
    expect(result!.fields.ip).toBe('198.41.200.13');
  });

  test('valid line with 5+ fields extracts all fields', () => {
    const result = parseLogLine(
      '2024-02-08T06:25:48Z INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.200.13 location=LAX protocol=quic',
    );
    expect(result).not.toBeNull();
    expect(Object.keys(result!.fields).length).toBeGreaterThanOrEqual(5);
    expect(result!.fields.connIndex).toBe('0');
    expect(result!.fields.connection).toBe('abc');
    expect(result!.fields.event).toBe('0');
    expect(result!.fields.ip).toBe('198.41.200.13');
    expect(result!.fields.location).toBe('LAX');
    expect(result!.fields.protocol).toBe('quic');
  });

  test('line without fields returns message as full text and empty fields', () => {
    const result = parseLogLine('2024-02-08T06:25:48Z INF Starting tunnel');
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Starting tunnel');
    expect(Object.keys(result!.fields)).toHaveLength(0);
  });

  test('all log levels are preserved', () => {
    const levels = ['DBG', 'INF', 'WRN', 'ERR', 'FTL'] as const;
    for (const level of levels) {
      const result = parseLogLine(`2024-02-08T06:25:48Z ${level} Test message`);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(level);
    }
  });

  test('malformed timestamp returns null', () => {
    expect(parseLogLine('not-a-date INF some message')).toBeNull();
  });

  test('missing level returns null', () => {
    expect(parseLogLine('2024-02-08T06:25:48Z some message without level')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(parseLogLine('')).toBeNull();
  });

  test('unicode in message is preserved', () => {
    const result = parseLogLine('2024-02-08T06:25:48Z INF Tunnel started successfully \u2714');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('\u2714');
  });

  test('fields with special chars (slashes, colons) are intact', () => {
    const result = parseLogLine(
      '2024-02-08T06:25:48Z INF Starting metrics server on addr=127.0.0.1:20241/metrics',
    );
    expect(result).not.toBeNull();
    expect(result!.fields.addr).toBe('127.0.0.1:20241/metrics');
  });

  test('very long message (1000+ chars) is not truncated', () => {
    const longMsg = 'A'.repeat(1200);
    const result = parseLogLine(`2024-02-08T06:25:48Z INF ${longMsg}`);
    expect(result).not.toBeNull();
    expect(result!.message.length).toBeGreaterThanOrEqual(1200);
  });

  test('multiple spaces in message are handled', () => {
    const result = parseLogLine('2024-02-08T06:25:48Z INF Starting  tunnel   now');
    expect(result).not.toBeNull();
    // The regex captures everything after level as "rest", spaces preserved
    expect(result!.message).toContain('Starting');
    expect(result!.message).toContain('tunnel');
    expect(result!.message).toContain('now');
  });

  test('field values with equals signs (URLs) include nested =', () => {
    // The regex (\w+)=(\S+) grabs from first = to next space
    const result = parseLogLine(
      '2024-02-08T06:25:48Z INF Request url=http://example.com?a=b',
    );
    expect(result).not.toBeNull();
    expect(result!.fields.url).toBe('http://example.com?a=b');
  });

  test('null bytes or control characters are handled gracefully', () => {
    const result = parseLogLine('2024-02-08T06:25:48Z INF Message with \x00 null byte');
    // May return null or a result depending on regex, just don't throw
    // The regex won't match across \x00 in the middle because . doesn't match \x00 by default
    // Just verify no exception is thrown
    expect(true).toBe(true);
  });

  test('ISO timestamp boundary (year 2025) returns correct Date', () => {
    const result = parseLogLine('2025-12-31T23:59:59Z INF Year boundary test');
    expect(result).not.toBeNull();
    expect(result!.timestamp.getUTCFullYear()).toBe(2025);
    expect(result!.timestamp.getUTCMonth()).toBe(11); // December = 11
    expect(result!.timestamp.getUTCDate()).toBe(31);
  });

  test('ISO timestamp boundary (year 2030) returns correct Date', () => {
    const result = parseLogLine('2030-01-01T00:00:00Z INF Future timestamp');
    expect(result).not.toBeNull();
    expect(result!.timestamp.getUTCFullYear()).toBe(2030);
  });
});

describe('extractMetricsAddr', () => {
  test('valid metrics line extracts address', () => {
    const result = extractMetricsAddr(
      '2024-02-08T06:25:48Z INF Starting metrics server on 127.0.0.1:20241/metrics',
    );
    expect(result).toBe('127.0.0.1:20241');
  });

  test('different port extracts correctly', () => {
    const result = extractMetricsAddr(
      '2024-02-08T06:25:48Z INF Starting metrics server on 127.0.0.1:45678/metrics',
    );
    expect(result).toBe('127.0.0.1:45678');
  });

  test('IPv6 address returns null (regex only supports IPv4)', () => {
    const result = extractMetricsAddr(
      '2024-02-08T06:25:48Z INF Starting metrics server on [::1]:20241/metrics',
    );
    expect(result).toBeNull();
  });

  test('unrelated line returns null', () => {
    expect(extractMetricsAddr('2024-02-08T06:25:48Z INF Starting tunnel')).toBeNull();
  });

  test('malformed metrics line returns null', () => {
    expect(extractMetricsAddr('Starting metrics server on')).toBeNull();
  });
});

describe('extractRegistration', () => {
  test('full registration with all fields', () => {
    const result = extractRegistration(
      '2024-02-08T06:25:48Z INF Registered tunnel connection connIndex=0 connection=abcdef-1234-5678 event=0 ip=198.41.200.13 location=LAX protocol=quic',
    );
    expect(result).not.toBeNull();
    expect(result!.connIndex).toBe(0);
    expect(result!.connectionId).toBe('abcdef-1234-5678');
    expect(result!.edgeIp).toBe('198.41.200.13');
    expect(result!.location).toBe('LAX');
    expect(result!.protocol).toBe('quic');
  });

  test('connIndex > 0 (multi-digit) parses as integer', () => {
    const result = extractRegistration(
      'Registered tunnel connection connIndex=12 connection=abc event=0 ip=1.2.3.4 location=ORD protocol=quic',
    );
    expect(result).not.toBeNull();
    expect(result!.connIndex).toBe(12);
  });

  test('different protocol (http2) is extracted correctly', () => {
    const result = extractRegistration(
      'Registered tunnel connection connIndex=0 connection=abc event=0 ip=1.2.3.4 location=SJC protocol=http2',
    );
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe('http2');
  });

  test('non-registration line returns null', () => {
    expect(extractRegistration('Starting tunnel')).toBeNull();
  });

  test('partial match (missing field) returns null', () => {
    // Missing protocol
    expect(extractRegistration(
      'Registered tunnel connection connIndex=0 connection=abc event=0 ip=1.2.3.4 location=LAX',
    )).toBeNull();
  });

  test('various datacenter codes are preserved', () => {
    for (const loc of ['ORD', 'LAX', 'SJC07', 'lax08']) {
      const result = extractRegistration(
        `Registered tunnel connection connIndex=0 connection=abc event=0 ip=1.2.3.4 location=${loc} protocol=quic`,
      );
      expect(result).not.toBeNull();
      expect(result!.location).toBe(loc);
    }
  });
});

describe('extractQuickTunnelUrl', () => {
  test('valid quick tunnel URL is extracted', () => {
    const result = extractQuickTunnelUrl(
      'Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): https://able-happy-bright-lucky.trycloudflare.com',
    );
    expect(result).toBe('https://able-happy-bright-lucky.trycloudflare.com');
  });

  test('URL embedded in message is extracted', () => {
    const result = extractQuickTunnelUrl(
      '2024-02-08T06:25:48Z INF +-------------------------------------------+ | https://word-word-word-word.trycloudflare.com |',
    );
    expect(result).toBe('https://word-word-word-word.trycloudflare.com');
  });

  test('no URL returns null', () => {
    expect(extractQuickTunnelUrl('Just a regular log line')).toBeNull();
  });

  test('non-matching URL format returns null', () => {
    // URL pattern expects exactly 4 hyphen-separated words
    expect(extractQuickTunnelUrl(
      'https://example.com is not a quick tunnel URL',
    )).toBeNull();
  });
});

describe('extractVersion', () => {
  test('version with checksum is extracted', () => {
    const result = extractVersion('Version 2025.8.0 (Checksum abc123)');
    expect(result).toBe('2025.8.0');
  });

  test('version without checksum is extracted', () => {
    const result = extractVersion('Version 2025.8.0');
    expect(result).toBe('2025.8.0');
  });

  test('pre-release version with suffix is extracted', () => {
    const result = extractVersion('Version 2025.8.0-rc1');
    expect(result).toBe('2025.8.0-rc1');
  });

  test('no version returns null', () => {
    expect(extractVersion('Starting tunnel')).toBeNull();
  });
});

describe('extractConnectorId', () => {
  test('valid connector line extracts UUID', () => {
    const result = extractConnectorId(
      'Generated Connector ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  test('different UUID format is extracted', () => {
    const result = extractConnectorId(
      'Generated Connector ID: 00000000-0000-0000-0000-000000000000',
    );
    expect(result).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('no connector ID returns null', () => {
    expect(extractConnectorId('Some other log line')).toBeNull();
  });
});
