import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { generateDefaultConfig } from '@clawgate/core';

export const initCommand = new Command('init')
  .description('Generate a default clawgate.yaml in the current directory')
  .option('--force', 'Overwrite existing clawgate.yaml')
  .action(async (opts: { force?: boolean }) => {
    const dest = join(process.cwd(), 'clawgate.yaml');
    if (existsSync(dest) && !opts.force) {
      console.log('clawgate.yaml already exists. Use --force to overwrite.');
      return;
    }
    await generateDefaultConfig(dest);
    console.log(`Created ${dest}`);
  });
