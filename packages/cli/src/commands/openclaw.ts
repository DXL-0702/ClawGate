import { Command } from 'commander';
import { configReader } from '@clawgate/core';

const API_BASE = process.env['CLAWGATE_API_URL'] || 'http://localhost:3000';

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function apiPost(path: string, body?: object, headers?: Record<string, string>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export const openclawCommand = new Command('openclaw')
  .description('Manage OpenClaw Gateway lifecycle');

// status — 显示状态
openclawCommand
  .command('status')
  .description('Show OpenClaw Gateway status')
  .action(async () => {
    try {
      await configReader.load();
      const data = await apiGet('/api/openclaw/status');

      if (!data.success) {
        console.error('Error:', data.error || 'Failed to get status');
        process.exit(1);
      }

      const s = data.data;
      console.log('OpenClaw Gateway Status');
      console.log('───────────────────────────────');
      console.log(`  Connected   : ${s.gatewayConnected ? '✅ yes' : '❌ no'}`);
      console.log(`  Version     : ${s.version || 'unknown'}`);
      console.log(`  PID         : ${s.pid || 'unknown'}`);
      console.log(`  Platform    : ${s.platform}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      console.error('Make sure ClawGate server is running on', API_BASE);
      process.exit(1);
    }
  });

// restart — 重启
openclawCommand
  .command('restart')
  .description('Restart OpenClaw Gateway')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (opts) => {
    try {
      // 确认提示
      if (!opts.force) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question('Are you sure you want to restart OpenClaw Gateway? (yes/no): ', resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'yes') {
          console.log('Restart cancelled.');
          return;
        }
      }

      console.log('Restarting OpenClaw Gateway...');
      const data = await apiPost(
        '/api/openclaw/restart',
        {},
        { 'X-Confirm-Action': 'restart' }
      );

      if (!data.success) {
        console.error('Error:', data.error || 'Restart failed');
        process.exit(1);
      }

      console.log(`✅ ${data.message}`);
      if (data.pid) {
        console.log(`   New PID: ${data.pid}`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      console.error('Make sure ClawGate server is running on', API_BASE);
      process.exit(1);
    }
  });

// upgrade — 升级
openclawCommand
  .command('upgrade')
  .description('Upgrade OpenClaw to latest version')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(async (opts) => {
    try {
      // 先检查更新
      console.log('Checking for updates...');
      const updateInfo = await apiGet('/api/openclaw/update');

      if (!updateInfo.success) {
        console.error('Error:', updateInfo.error || 'Failed to check update');
        process.exit(1);
      }

      const { hasUpdate, currentVersion, latestVersion } = updateInfo.data;

      if (!hasUpdate) {
        console.log(`Already at latest version: ${currentVersion}`);
        return;
      }

      console.log(`Update available: ${currentVersion} → ${latestVersion}`);

      // 确认提示
      if (!opts.force) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question('Proceed with upgrade? (yes/no): ', resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'yes') {
          console.log('Upgrade cancelled.');
          return;
        }
      }

      console.log('Upgrading OpenClaw...');
      const data = await apiPost(
        '/api/openclaw/upgrade',
        {},
        { 'X-Confirm-Action': 'upgrade' }
      );

      if (!data.success) {
        console.error('Error:', data.error || 'Upgrade failed');
        if (data.detail) {
          console.error('Detail:', data.detail);
        }
        process.exit(1);
      }

      console.log(`✅ ${data.message}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : String(err));
      console.error('Make sure ClawGate server is running on', API_BASE);
      process.exit(1);
    }
  });
