import { describe, test, expect } from 'bun:test';
import { buildIngressConfig, buildSingleIngress } from '../../src/cloudflared/config.js';
import type { IngressMapping } from '../../src/cloudflared/config.js';

describe('buildIngressConfig', () => {
  test('single tunnel produces 2 entries (rule + catch-all)', () => {
    const result = buildIngressConfig([
      { hostname: 'app.example.com', service: 'http://127.0.0.1:3000' },
    ]);
    expect(result.config.ingress).toHaveLength(2);
    expect(result.config.ingress[0].hostname).toBe('app.example.com');
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:3000');
    expect(result.config.ingress[1].service).toBe('http_status:404');
  });

  test('multiple tunnels (3) produce 4 entries in correct order', () => {
    const tunnels: IngressMapping[] = [
      { hostname: 'app.example.com', service: 'http://127.0.0.1:3000' },
      { hostname: 'api.example.com', service: 'http://127.0.0.1:8080' },
      { hostname: 'ws.example.com', service: 'http://127.0.0.1:9090' },
    ];
    const result = buildIngressConfig(tunnels);
    expect(result.config.ingress).toHaveLength(4);
    expect(result.config.ingress[0].hostname).toBe('app.example.com');
    expect(result.config.ingress[1].hostname).toBe('api.example.com');
    expect(result.config.ingress[2].hostname).toBe('ws.example.com');
    expect(result.config.ingress[3].service).toBe('http_status:404');
    expect(result.config.ingress[3].hostname).toBeUndefined();
  });

  test('empty array produces only catch-all', () => {
    const result = buildIngressConfig([]);
    expect(result.config.ingress).toHaveLength(1);
    expect(result.config.ingress[0].service).toBe('http_status:404');
  });

  test('with originRequest { noTLSVerify: true } it is preserved', () => {
    const result = buildIngressConfig([
      { hostname: 'app.example.com', service: 'https://127.0.0.1:3000', originRequest: { noTLSVerify: true } },
    ]);
    expect(result.config.ingress[0].originRequest).toEqual({ noTLSVerify: true });
  });

  test('without originRequest defaults to empty object', () => {
    const result = buildIngressConfig([
      { hostname: 'app.example.com', service: 'http://127.0.0.1:3000' },
    ]);
    expect(result.config.ingress[0].originRequest).toEqual({});
  });

  test('hostname variations (subdomain, apex, wildcard) are preserved', () => {
    const tunnels: IngressMapping[] = [
      { hostname: 'sub.example.com', service: 'http://127.0.0.1:3000' },
      { hostname: 'example.com', service: 'http://127.0.0.1:3001' },
      { hostname: '*.example.com', service: 'http://127.0.0.1:3002' },
    ];
    const result = buildIngressConfig(tunnels);
    expect(result.config.ingress[0].hostname).toBe('sub.example.com');
    expect(result.config.ingress[1].hostname).toBe('example.com');
    expect(result.config.ingress[2].hostname).toBe('*.example.com');
  });

  test('service URL formats (http, https, unix socket) are preserved', () => {
    const tunnels: IngressMapping[] = [
      { hostname: 'a.example.com', service: 'http://127.0.0.1:3000' },
      { hostname: 'b.example.com', service: 'https://127.0.0.1:3001' },
      { hostname: 'c.example.com', service: 'unix:///var/run/app.sock' },
    ];
    const result = buildIngressConfig(tunnels);
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:3000');
    expect(result.config.ingress[1].service).toBe('https://127.0.0.1:3001');
    expect(result.config.ingress[2].service).toBe('unix:///var/run/app.sock');
  });

  test('IDN hostname is handled', () => {
    const result = buildIngressConfig([
      { hostname: 'xn--bcher-kva.example.com', service: 'http://127.0.0.1:3000' },
    ]);
    expect(result.config.ingress[0].hostname).toBe('xn--bcher-kva.example.com');
  });
});

describe('buildSingleIngress', () => {
  test('HTTP default produces correct service URL and httpHostHeader', () => {
    const result = buildSingleIngress('app.example.com', 3000);
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:3000');
    expect(result.config.ingress[0].originRequest).toEqual({
      httpHostHeader: 'localhost:3000',
    });
  });

  test('HTTPS produces https URL with noTLSVerify and httpHostHeader', () => {
    const result = buildSingleIngress('app.example.com', 3000, 'https');
    expect(result.config.ingress[0].service).toBe('https://127.0.0.1:3000');
    expect(result.config.ingress[0].originRequest).toEqual({
      httpHostHeader: 'localhost:3000',
      noTLSVerify: true,
    });
  });

  test('custom loopback 127.0.0.1 is used in service URL', () => {
    const result = buildSingleIngress('app.example.com', 3000, 'http', '127.0.0.1');
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:3000');
  });

  test('IPv6 ::1 is correctly formatted in URL', () => {
    const result = buildSingleIngress('app.example.com', 3000, 'http', '::1');
    expect(result.config.ingress[0].service).toBe('http://::1:3000');
  });

  test('port 1 boundary value is correct', () => {
    const result = buildSingleIngress('app.example.com', 1);
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:1');
    expect(result.config.ingress[0].originRequest).toEqual({
      httpHostHeader: 'localhost:1',
    });
  });

  test('port 65535 boundary value is correct', () => {
    const result = buildSingleIngress('app.example.com', 65535);
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:65535');
    expect(result.config.ingress[0].originRequest).toEqual({
      httpHostHeader: 'localhost:65535',
    });
  });

  test('high port 50001 is formatted correctly', () => {
    const result = buildSingleIngress('app.example.com', 50001);
    expect(result.config.ingress[0].service).toBe('http://127.0.0.1:50001');
  });

  test('default protocol is http when omitted', () => {
    const result = buildSingleIngress('app.example.com', 8080);
    expect(result.config.ingress[0].service).toStartWith('http://');
  });

  test('default loopback is 127.0.0.1 when omitted', () => {
    const result = buildSingleIngress('app.example.com', 8080);
    expect(result.config.ingress[0].service).toContain('127.0.0.1');
  });

  test('config.ingress is array with 2 entries (rule + catch-all)', () => {
    const result = buildSingleIngress('app.example.com', 3000);
    expect(Array.isArray(result.config.ingress)).toBe(true);
    expect(result.config.ingress).toHaveLength(2);
    expect(result.config.ingress[1].service).toBe('http_status:404');
  });

  test('httpHostHeader always uses localhost:PORT format', () => {
    const result = buildSingleIngress('app.example.com', 4000, 'http', '10.0.0.1');
    expect(result.config.ingress[0].originRequest).toHaveProperty('httpHostHeader', 'localhost:4000');
  });

  test('HTTPS originRequest has 2 keys (noTLSVerify + httpHostHeader)', () => {
    const result = buildSingleIngress('app.example.com', 3000, 'https');
    const originRequest = result.config.ingress[0].originRequest!;
    expect(Object.keys(originRequest)).toHaveLength(2);
    expect(originRequest).toHaveProperty('noTLSVerify', true);
    expect(originRequest).toHaveProperty('httpHostHeader', 'localhost:3000');
  });

  test('HTTP originRequest has 1 key (httpHostHeader only)', () => {
    const result = buildSingleIngress('app.example.com', 3000, 'http');
    const originRequest = result.config.ingress[0].originRequest!;
    expect(Object.keys(originRequest)).toHaveLength(1);
    expect(originRequest).toHaveProperty('httpHostHeader', 'localhost:3000');
  });
});
