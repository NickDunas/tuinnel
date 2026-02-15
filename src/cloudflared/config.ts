import type { TunnelConfiguration } from '../cloudflare/types.js';

export interface IngressMapping {
  hostname: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

export function buildIngressConfig(
  tunnels: IngressMapping[],
): TunnelConfiguration {
  const ingress = [
    ...tunnels.map(({ hostname, service, originRequest }) => ({
      hostname,
      service,
      originRequest: originRequest ?? {},
    })),
    // Catch-all rule must be last
    { service: 'http_status:404' },
  ];

  return { config: { ingress } };
}

export function buildSingleIngress(
  hostname: string,
  port: number,
  protocol: 'http' | 'https' = 'http',
  loopbackAddr: string = '127.0.0.1',
): TunnelConfiguration {
  const service = `${protocol}://${loopbackAddr}:${port}`;
  // Rewrite the Host header to localhost so dev servers (Angular, Vite,
  // webpack-dev-server, etc.) don't reject the request with "Invalid Host header".
  const originRequest: Record<string, unknown> = {
    httpHostHeader: `localhost:${port}`,
  };
  // Disable TLS verification for local HTTPS origins (e.g. self-signed certs)
  if (protocol === 'https') {
    originRequest.noTLSVerify = true;
  }
  return buildIngressConfig([{ hostname, service, originRequest }]);
}
