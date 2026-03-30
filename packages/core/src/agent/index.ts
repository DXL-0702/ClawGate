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
      const configPath = join(this.agentsDir, entry.name, 'agent.json');
      if (!existsSync(configPath)) continue;

      try {
        const raw = await readFile(configPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        agents.push({
          id: entry.name,
          name: (data['name'] as string) ?? entry.name,
          configPath,
          status: 'unknown' as AgentStatus,
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
