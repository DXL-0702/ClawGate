import { readFile, writeFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import yaml from 'js-yaml';
import { ClawGateConfigSchema, type ClawGateConfig } from './schema.js';

const DEFAULT_PATH = join(process.cwd(), 'clawgate.yaml');

let config: ClawGateConfig = ClawGateConfigSchema.parse({});
let configPath = DEFAULT_PATH;

export async function loadYamlConfig(filePath?: string): Promise<ClawGateConfig> {
  configPath = filePath ?? DEFAULT_PATH;

  if (!existsSync(configPath)) {
    config = ClawGateConfigSchema.parse({});
    return config;
  }

  const raw = await readFile(configPath, 'utf-8');
  const parsed = yaml.load(raw);
  config = ClawGateConfigSchema.parse(parsed ?? {});
  return config;
}

export function getYamlConfig(): ClawGateConfig {
  return config;
}

export async function watchYamlConfig(
  onChange: (cfg: ClawGateConfig) => void,
): Promise<void> {
  if (!existsSync(configPath)) return;
  const watcher = watch(configPath);
  for await (const _event of watcher) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed = yaml.load(raw);
      config = ClawGateConfigSchema.parse(parsed ?? {});
      onChange(config);
    } catch {
      // keep previous config on parse/validation error
    }
  }
}

export async function generateDefaultConfig(dest: string): Promise<void> {
  const defaults = ClawGateConfigSchema.parse({});
  const content = [
    '# ClawGate configuration file',
    '# See: https://github.com/clawgate/clawgate',
    '',
    yaml.dump(defaults, { lineWidth: 80 }),
  ].join('\n');
  await writeFile(dest, content, 'utf-8');
}

export { type ClawGateConfig } from './schema.js';
