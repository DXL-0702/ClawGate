import { readFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
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

async function load(): Promise<void> {
  const cfgPath = join(OPENCLAW_DIR, 'openclaw.json');
  if (!existsSync(cfgPath)) return;
  try {
    const raw = await readFile(cfgPath, 'utf-8');
    const data = JSON.parse(raw) as Partial<OpenClawConfig>;
    config = {
      gatewayUrl: data.gatewayUrl ?? defaults.gatewayUrl,
      gatewayToken: data.gatewayToken ?? defaults.gatewayToken,
      defaultModel: data.defaultModel ?? defaults.defaultModel,
      agentsDir: data.agentsDir ?? defaults.agentsDir,
    };
  } catch {
    // use defaults on parse error
  }

  // 从 device-auth.json 读取 gateway token（如果存在）
  const authPath = join(OPENCLAW_DIR, 'identity', 'device-auth.json');
  if (existsSync(authPath)) {
    try {
      const authRaw = await readFile(authPath, 'utf-8');
      const authData = JSON.parse(authRaw) as { tokens?: { operator?: { token?: string } } };
      if (authData.tokens?.operator?.token) {
        config.gatewayToken = authData.tokens.operator.token;
      }
    } catch {
      // ignore auth parse error
    }
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
