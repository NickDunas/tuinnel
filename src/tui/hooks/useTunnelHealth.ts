import { useState, useEffect, useRef } from 'react';
import { probePort } from '../../utils/port-probe.js';

export interface TunnelHealthState {
  healthy: boolean;
  lastChecked: Date | null;
}

export function useTunnelHealth(
  port: number,
  interval: number = 5000,
): TunnelHealthState {
  const [healthy, setHealthy] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const check = async () => {
      const result = await probePort(port);
      if (mountedRef.current) {
        setHealthy(result);
        setLastChecked(new Date());
      }
    };

    // Run immediately on mount
    check();

    const id = setInterval(check, interval);

    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [port, interval]);

  return { healthy, lastChecked };
}
