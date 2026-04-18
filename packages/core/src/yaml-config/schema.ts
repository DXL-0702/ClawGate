import { z } from 'zod';

export const ClawGateConfigSchema = z.object({
  gateway: z.object({
    openclaw_url: z.string().url().default('ws://127.0.0.1:18789'),
    port: z.number().int().min(1).max(65535).default(3000),
    /** 认证模式：token（仅 token）| challenge（Ed25519 设备签名）| auto（有 device key 时用 challenge，否则 token） */
    auth_mode: z.enum(['token', 'challenge', 'auto']).default('auto'),
  }).default({}),

  router: z.object({
    l1_ttl: z.number().int().positive().default(3600),
    l2_threshold: z.number().min(0).max(1).default(0.75),
    l3_model: z.string().default('qwen2.5:3b'),
  }).default({}),

  providers: z.array(z.object({
    name: z.string(),
    model: z.string(),
    tags: z.array(z.string()).default([]),
  })).default([
    { name: 'anthropic', model: 'claude-sonnet-4-6', tags: ['complex', 'code'] },
    { name: 'ollama',    model: 'qwen2.5:7b',        tags: ['simple', 'chat'] },
  ]),

  budgets: z.object({
    daily_limit_usd: z.number().positive().optional(),
    alert_threshold: z.number().min(0).max(1).default(0.8),
  }).default({}),
});

export type ClawGateConfig = z.infer<typeof ClawGateConfigSchema>;
