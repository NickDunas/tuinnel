import { createConnection } from 'net';

export function probePort(
  port: number,
  host: string = '127.0.0.1',
  timeout: number = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout });

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Resolve which loopback address a port is listening on.
 * Tries IPv4 (127.0.0.1) first, then IPv6 (::1).
 * Returns the address string suitable for URLs, or '127.0.0.1' as fallback.
 */
export async function resolveLoopback(port: number): Promise<string> {
  if (await probePort(port, '127.0.0.1')) return '127.0.0.1';
  if (await probePort(port, '::1')) return '[::1]';
  return '127.0.0.1';
}
