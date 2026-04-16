#!/usr/bin/env node
import { Command } from 'commander';
import { agentsCommand } from '../commands/agents.js';
import { sessionsCommand } from '../commands/sessions.js';
import { statusCommand } from '../commands/status.js';
import { initCommand } from '../commands/init.js';
import { openclawCommand } from '../commands/openclaw.js';

const program = new Command();

program
  .name('clawgate')
  .description('ClawGate — OpenClaw resource scheduling platform')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(agentsCommand);
program.addCommand(sessionsCommand);
program.addCommand(statusCommand);
program.addCommand(openclawCommand);

program.parse();
