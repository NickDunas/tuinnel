import { z } from 'zod';

// -- Standard CF API envelope --

export const CFErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

export type CFError = z.infer<typeof CFErrorSchema>;

export const CFResultInfoSchema = z.object({
  page: z.number(),
  per_page: z.number(),
  count: z.number(),
  total_count: z.number().optional(),
  total_pages: z.number().optional(),
});

export type CFResultInfo = z.infer<typeof CFResultInfoSchema>;

export function cfResponseSchema<T extends z.ZodType>(resultSchema: T) {
  return z.object({
    success: z.boolean(),
    errors: z.array(CFErrorSchema),
    messages: z.array(CFErrorSchema),
    result: resultSchema.nullable(),
    result_info: CFResultInfoSchema.optional(),
  });
}

// -- Zone --

export const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  account: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export type Zone = z.infer<typeof ZoneSchema>;

// -- Tunnel --

export const TunnelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['inactive', 'healthy', 'down', 'degraded']),
  created_at: z.string(),
  deleted_at: z.string().nullable().optional(),
  connections: z.array(z.object({
    colo_name: z.string(),
    uuid: z.string(),
    is_pending_reconnect: z.boolean(),
    opened_at: z.string(),
    origin_ip: z.string(),
    client_id: z.string().optional(),
    client_version: z.string().optional(),
  })).optional(),
  token: z.string().optional(),
});

export type Tunnel = z.infer<typeof TunnelSchema>;

// -- DNS Record --

export const DNSRecordSchema = z.object({
  id: z.string(),
  zone_id: z.string().optional(),
  zone_name: z.string().optional(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
  proxied: z.boolean(),
  ttl: z.number(),
  created_on: z.string().optional(),
  modified_on: z.string().optional(),
});

export type DNSRecord = z.infer<typeof DNSRecordSchema>;

// -- Tunnel Configuration (Ingress) --

export const IngressRuleSchema = z.object({
  hostname: z.string().optional(),
  path: z.string().optional(),
  service: z.string(),
  originRequest: z.record(z.unknown()).optional(),
});

export const TunnelConfigurationSchema = z.object({
  config: z.object({
    ingress: z.array(IngressRuleSchema),
    originRequest: z.record(z.unknown()).optional(),
    'warp-routing': z.object({ enabled: z.boolean() }).optional(),
  }),
});

export type TunnelConfiguration = z.infer<typeof TunnelConfigurationSchema>;
