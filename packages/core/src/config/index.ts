import { readFile, watch } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OpenClawConfig } from '@clawgate/shared';

const OPENCLAW_DIR = join(homedir(), '.openclaw');

const defaults: OpenClawConfig = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  gatewayToken: '',
  defaultModel: 'claude-sonnet-4-6',
  agentsDir: join(OPENCLAW_DIR, 'agents'),
};

let config: OpenClawConfig = { ...defaults };

/** 从 device-auth.json 读取 operator token（Gateway 认证需要） */
function loadOperatorToken(): string | null {
  try {
    const path = join(OPENCLAW_DIR, 'identity', 'device-auth.json');
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as { tokens?: { operator?: { token?: string } } };
    return data.tokens?.operator?.token ?? null;
  } catch {
    return null;
  }
}

async function load(): Promise<void> {
  const cfgPath = join(OPENCLAW_DIR, 'openclaw.json');
  if (!existsSync(cfgPath)) return;

  try {
    const raw = await readFile(cfgPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    // 从 openclaw.json 读取 gateway 配置
    const gateway = (data.gateway ?? {}) as Record<string, unknown>;
    const gatewayAuth = (gateway.auth ?? {}) as Record<string, unknown>;
    const gatewayPort = gateway.port as number | undefined;

    // 优先使用 openclaw.json 的 token，若为空则尝试 device-auth.json 的 operator token
    let token = (gatewayAuth.token as string) ?? defaults.gatewayToken;
    if (!token) {
      const operatorToken = loadOperatorToken();
      if (operatorToken) {
        token = operatorToken;
        console.log('[config] Using operator token from device-auth.json');
      }
    }

    config = {
      gatewayUrl: gatewayPort
        ? `ws://127.0.0.1:${gatewayPort}`
        : defaults.gatewayUrl,
      gatewayToken: token,
      operatorToken: loadOperatorToken() ?? undefined,
      defaultModel: 'claude-sonnet-4-6',
      agentsDir: join(OPENCLAW_DIR, 'agents'),
    };
  } catch {
    // use defaults on parse error
  }
}

async function watchConfig(): Promise<void> {
  const cfgPath = join(OPENCLAW_DIR, 'openclaw.json');
  if (!existsSync(cfgPath)) return;
  const watcher = watch(cfgPath);
  for await (const _event of watcher) {
    await load();
  }
}

function get(): OpenClawConfig {
  return config;
}

function getAgentsDir(): string {
  return config.agentsDir;
}

export const configReader = { load, watch: watchConfig, get, getAgentsDir };
