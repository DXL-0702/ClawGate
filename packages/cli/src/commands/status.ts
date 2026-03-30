import { Command } from 'commander';
import { configReader } from '@clawgate/core';

export const statusCommand = new Command('status')
  .description('Show ClawGate global status')
  .action(async () => {
    try {
      await configReader.load();
      const cfg = configReader.get();
      console.log('ClawGate Status');
      console.log('───────────────────────────────');
      console.log(`  Gateway URL : ${cfg.gatewayUrl}`);
      console.log(`  Default Model: ${cfg.defaultModel}`);
      console.log(`  Agents Dir  : ${cfg.agentsDir}`);
      console.log(`  Token Set   : ${cfg.gatewayToken ? 'yes' : 'no'}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
