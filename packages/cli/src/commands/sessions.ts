import { Command } from 'commander';
import { configReader, GatewayClient } from '@clawgate/core';

export const sessionsCommand = new Command('sessions')
  .description('Manage OpenClaw sessions');

sessionsCommand
  .command('list')
  .description('List sessions')
  .option('--agent <agentId>', 'Filter by agent ID')
  .action(async (opts: { agent?: string }) => {
    try {
      await configReader.load();
      const cfg = configReader.get();
      const client = new GatewayClient({ url: cfg.gatewayUrl, token: cfg.gatewayToken });
      await client.connect();
      const sessions = await client.listSessions(opts.agent);
      client.disconnect();
      if ((sessions as unknown[]).length === 0) {
        console.log('No active sessions.');
        return;
      }
      console.log(JSON.stringify(sessions, null, 2));
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
