import { Command } from 'commander';
import { configReader, AgentDiscovery } from '@clawgate/core';

export const agentsCommand = new Command('agents')
  .description('Manage OpenClaw agents');

agentsCommand
  .command('list')
  .description('List all discovered agents')
  .action(async () => {
    try {
      await configReader.load();
      const discovery = new AgentDiscovery(configReader.getAgentsDir());
      const agents = await discovery.discover();
      if (agents.length === 0) {
        console.log('No agents found in ~/.openclaw/agents/');
        return;
      }
      console.log(`Found ${agents.length} agent(s):\n`);
      for (const agent of agents) {
        console.log(`  ${agent.name} (${agent.id})`);
        console.log(`    config: ${agent.configPath}`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
