import { describe, test, expect } from 'bun:test';
import { ConfigSchema, TunnelConfigSchema } from '../../src/config/schema.js';

describe('TunnelConfigSchema', () => {
  test('valid config parses correctly', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', protocol: 'http' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(3000);
      expect(result.data.subdomain).toBe('app');
      expect(result.data.zone).toBe('example.com');
      expect(result.data.protocol).toBe('http');
    }
  });

  test('default protocol is http', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocol).toBe('http');
    }
  });

  test('https protocol is accepted', () => {
    const input = { port: 443, subdomain: 'secure', zone: 'example.com', protocol: 'https' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocol).toBe('https');
    }
  });

  test('invalid port 0 fails', () => {
    const input = { port: 0, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('invalid port 65536 fails', () => {
    const input = { port: 65536, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('negative port fails', () => {
    const input = { port: -1, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('string port fails', () => {
    const input = { port: '3000', subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('floating point port fails', () => {
    const input = { port: 3000.5, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('empty subdomain fails', () => {
    const input = { port: 3000, subdomain: '', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('empty zone fails', () => {
    const input = { port: 3000, subdomain: 'app', zone: '' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('invalid protocol fails', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', protocol: 'ftp' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('boundary port 1 is valid', () => {
    const input = { port: 1, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('boundary port 65535 is valid', () => {
    const input = { port: 65535, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('lastState running is accepted', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', lastState: 'running' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastState).toBe('running');
    }
  });

  test('lastState stopped is accepted', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', lastState: 'stopped' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastState).toBe('stopped');
    }
  });

  test('lastState is optional', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastState).toBeUndefined();
    }
  });

  test('invalid lastState fails', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', lastState: 'paused' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('tunnelId is accepted', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com', tunnelId: 'abc-123-def' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tunnelId).toBe('abc-123-def');
    }
  });

  test('tunnelId is optional', () => {
    const input = { port: 3000, subdomain: 'app', zone: 'example.com' };
    const result = TunnelConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tunnelId).toBeUndefined();
    }
  });
});

describe('ConfigSchema', () => {
  test('valid config parses correctly', () => {
    const input = {
      version: 1,
      apiToken: 'test-token',
      defaultZone: 'example.com',
      tunnels: {
        angular: { port: 4200, subdomain: 'angular', zone: 'example.com', protocol: 'http' },
      },
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.apiToken).toBe('test-token');
      expect(result.data.tunnels.angular.port).toBe(4200);
    }
  });

  test('missing version field fails', () => {
    const input = {
      apiToken: 'test-token',
      tunnels: {},
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('wrong version number fails', () => {
    const input = {
      version: 2,
      tunnels: {},
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('minimal valid config', () => {
    const input = { version: 1 };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tunnels).toEqual({});
      expect(result.data.apiToken).toBeUndefined();
      expect(result.data.defaultZone).toBeUndefined();
    }
  });

  test('tunnels default to empty object', () => {
    const input = { version: 1 };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tunnels).toEqual({});
    }
  });

  test('apiToken is optional', () => {
    const input = { version: 1, tunnels: {} };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test('config with invalid tunnel entry fails', () => {
    const input = {
      version: 1,
      tunnels: {
        bad: { port: -1, subdomain: '', zone: '' },
      },
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  test('config with tunnel lastState and tunnelId', () => {
    const input = {
      version: 1,
      tunnels: {
        myapp: {
          port: 3000,
          subdomain: 'myapp',
          zone: 'example.com',
          protocol: 'http',
          lastState: 'running',
          tunnelId: 'uuid-abc-123',
        },
      },
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tunnels.myapp.lastState).toBe('running');
      expect(result.data.tunnels.myapp.tunnelId).toBe('uuid-abc-123');
    }
  });

  test('extra fields are stripped', () => {
    const input = {
      version: 1,
      tunnels: {},
      unknownField: 'should be stripped',
    };
    const result = ConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });
});
