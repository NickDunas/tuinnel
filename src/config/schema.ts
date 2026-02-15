import { z } from 'zod';

export const TunnelConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  subdomain: z.string().min(1),
  zone: z.string().min(1),
  protocol: z.enum(['http', 'https']).default('http'),
  lastState: z.enum(['running', 'stopped']).optional(),
  tunnelId: z.string().optional(),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  apiToken: z.string().optional(),
  defaultZone: z.string().optional(),
  tunnels: z.record(z.string(), TunnelConfigSchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type TunnelConfig = z.infer<typeof TunnelConfigSchema>;
