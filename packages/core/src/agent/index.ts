import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Agent, AgentStatus } from '@clawgate/shared';

export class AgentDiscovery {
  constructor(private readonly agentsDir: string) {}

  async discover(): Promise<Agent[]> {
    if (!existsSync(this.agentsDir)) return [];

    const entries = await readdir(this.agentsDir, { withFileTypes: true });
    const agents: Agent[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // OpenClaw 结构: agents/{agentId}/agent/models.json
      const agentSubDir = join(this.agentsDir, entry.name, 'agent');
      const configPath = join(agentSubDir, 'models.json');

      // 如果 models.json 不存在，跳过
      if (!existsSync(configPath)) continue;

      try {
        const raw = await readFile(configPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;

        // 从 models.json 读取 provider 配置（可选）
        const _providers = data.providers as Record<string, unknown> | undefined;

        agents.push({
          id: entry.name,
          name: entry.name, // 使用目录名作为 agent 名称
          configPath,
          status: 'running' as AgentStatus, // 假设运行中
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // skip malformed agent configs
      }
    }

    return agents;
  }
}
