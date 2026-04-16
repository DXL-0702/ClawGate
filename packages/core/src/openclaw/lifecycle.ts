/**
 * OpenClaw 生命周期管理模块
 *
 * 支持功能：
 * - 本地模式：直接执行 openclaw CLI 命令
 * - 远程模式：通过 SSH 执行（团队部署）
 * - 重启 Gateway（优雅/强制）
 * - 升级 OpenClaw（brew/apt）
 * - 状态检查（版本/Gateway 连接）
 */

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { setTimeout as sleep } from 'timers/promises';

const execFileAsync = promisify(execFile);

export interface LifecycleOptions {
  /** 远程模式：SSH 主机地址 */
  sshHost?: string;
  /** 远程模式：SSH 用户名 */
  sshUser?: string;
  /** 远程模式：SSH 私钥路径 */
  sshKeyPath?: string;
}

export interface LifecycleResult {
  success: boolean;
  message: string;
  pid?: number;
  version?: string;
  error?: string;
}

export interface OpenClawStatus {
  /** Gateway 是否连接 */
  gatewayConnected: boolean;
  /** OpenClaw CLI 版本 */
  version: string | null;
  /** Gateway PID（如果可获取） */
  pid: number | null;
  /** 运行时间（秒） */
  uptime: number | null;
  /** 平台信息 */
  platform: string;
}

/** 执行命令的超时时间（毫秒） */
const COMMAND_TIMEOUT = 60_000;
/** 等待 Gateway 就绪的最大时间 */
const GATEWAY_READY_TIMEOUT = 15_000;
/** 轮询间隔 */
const POLL_INTERVAL = 500;

export class OpenClawLifecycle {
  private readonly gatewayUrl: string;
  private readonly gatewayHealthEndpoint: string;

  constructor(gatewayUrl = 'http://127.0.0.1:18789') {
    this.gatewayUrl = gatewayUrl;
    this.gatewayHealthEndpoint = `${gatewayUrl}/health`;
  }

  /**
   * 重启 OpenClaw Gateway
   *
   * 策略：
   * 1. 尝试优雅关闭（如果 Gateway 支持）
   * 2. 执行 CLI restart 命令
   * 3. 轮询等待 Gateway 重新就绪
   */
  async restart(opts?: LifecycleOptions): Promise<LifecycleResult> {
    try {
      // 获取当前 PID（用于验证重启后变化）
      const beforeStatus = await this.getStatus();
      const beforePid = beforeStatus.pid;

      // 执行重启
      let result: LifecycleResult;
      if (opts?.sshHost) {
        result = await this.remoteRestart(opts);
      } else {
        result = await this.localRestart();
      }

      if (!result.success) {
        return result;
      }

      // 等待 Gateway 就绪
      try {
        await this.waitForGateway(GATEWAY_READY_TIMEOUT);
      } catch (err) {
        return {
          success: false,
          message: 'Restart command executed but Gateway did not become ready',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // 验证 PID 变化（如果之前能获取到）
      const afterStatus = await this.getStatus();
      if (beforePid && afterStatus.pid === beforePid) {
        // PID 没变，可能是软重启或获取失败，不算错误
        console.warn('[OpenClawLifecycle] PID unchanged after restart:', beforePid);
      }

      return {
        success: true,
        message: `Gateway restarted successfully (new PID: ${afterStatus.pid})`,
        pid: afterStatus.pid ?? result.pid,
      };
    } catch (err) {
      return {
        success: false,
        message: 'Failed to restart Gateway',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 升级 OpenClaw
   *
   * 支持平台：
   * - macOS: brew upgrade openclaw
   * - Linux: apt/yum（待实现）
   * - Windows: winget/choco（待实现）
   *
   * 流程：
   * 1. 检查当前版本
   * 2. 执行升级命令
   * 3. 重启 Gateway
   * 4. 验证新版本
   */
  async upgrade(opts?: LifecycleOptions): Promise<LifecycleResult> {
    try {
      // 获取升级前版本
      const beforeVersion = await this.getVersion();

      // 备份配置（重要！）
      await this.backupConfig();

      // 执行升级
      let upgradeResult: { success: boolean; message: string };
      if (opts?.sshHost) {
        upgradeResult = await this.remoteUpgrade(opts);
      } else {
        upgradeResult = await this.localUpgrade();
      }

      if (!upgradeResult.success) {
        return {
          success: false,
          message: `Upgrade failed: ${upgradeResult.message}`,
        };
      }

      // 升级后重启
      const restartResult = await this.restart(opts);
      if (!restartResult.success) {
        return {
          success: false,
          message: `Upgrade succeeded but restart failed: ${restartResult.message}`,
        };
      }

      // 验证新版本
      const afterVersion = await this.getVersion();
      if (beforeVersion === afterVersion) {
        // 版本没变，可能是最新版或升级失败
        console.warn('[OpenClawLifecycle] Version unchanged after upgrade:', beforeVersion);
      }

      return {
        success: true,
        message: `Upgraded from ${beforeVersion} to ${afterVersion}`,
        version: afterVersion ?? undefined,
      };
    } catch (err) {
      return {
        success: false,
        message: 'Failed to upgrade OpenClaw',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 获取完整状态信息
   */
  async getStatus(): Promise<OpenClawStatus> {
    const [gatewayConnected, version, pid, platform] = await Promise.all([
      this.checkGatewayConnection(),
      this.getVersion(),
      this.getGatewayPid(),
      this.getPlatform(),
    ]);

    return {
      gatewayConnected,
      version,
      pid,
      uptime: null, // TODO: 从 Gateway API 获取运行时间
      platform,
    };
  }

  /**
   * 获取 OpenClaw CLI 版本
   */
  async getVersion(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('openclaw', ['--version'], {
        timeout: 5000,
      });
      // 解析版本字符串，如 "OpenClaw 2026.4.14 (323493f)"
      const match = stdout.match(/OpenClaw\s+([\d.]+)/);
      return match?.[1] ?? stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * 检查是否有可用更新
   *
   * 通过比较当前版本与最新 release
   */
  async checkUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string | null;
    latestVersion: string | null;
  }> {
    const currentVersion = await this.getVersion();

    try {
      // 根据平台检查最新版本
      const platform = process.platform;
      let latestVersion: string | null = null;

      if (platform === 'darwin') {
        // macOS: 检查 brew
        const { stdout } = await execFileAsync('brew', ['info', '--json', 'openclaw'], {
          timeout: 10000,
        });
        const info = JSON.parse(stdout);
        latestVersion = info[0]?.versions?.stable ?? null;
      }
      // TODO: Linux/Windows 版本检查

      return {
        hasUpdate: !!latestVersion && latestVersion !== currentVersion,
        currentVersion,
        latestVersion,
      };
    } catch {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
      };
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 本地重启实现
   */
  private async localRestart(): Promise<LifecycleResult> {
    try {
      // 使用 spawn 以便获取 PID
      const child = spawn('openclaw', ['gateway', 'restart'], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve({
            success: false,
            message: 'Restart command timed out',
            error: 'Timeout after 60s',
          });
        }, COMMAND_TIMEOUT);

        child.on('close', (code) => {
          clearTimeout(timeout);

          if (code === 0 || code === null) {
            // code === null 表示被信号终止，openclaw restart 可能这样
            resolve({
              success: true,
              message: 'Restart command executed',
              pid: child.pid,
            });
          } else {
            resolve({
              success: false,
              message: `Restart command failed (exit ${code})`,
              error: stderr || stdout,
            });
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            message: 'Failed to spawn restart command',
            error: err.message,
          });
        });
      });
    } catch (err) {
      return {
        success: false,
        message: 'Local restart failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 本地升级实现
   */
  private async localUpgrade(): Promise<{ success: boolean; message: string }> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        // macOS: Homebrew
        const { stdout, stderr } = await execFileAsync('brew', ['upgrade', 'openclaw'], {
          timeout: 120_000, // 升级可能需要更长时间
        });
        return {
          success: true,
          message: stdout || 'Upgrade completed',
        };
      }

      if (platform === 'linux') {
        // Linux: 尝试 apt，如果不存在则提示手动升级
        try {
          const { stdout, stderr } = await execFileAsync('apt-get', ['update', '&&', 'apt-get', 'upgrade', '-y', 'openclaw'], {
            timeout: 180_000,
            shell: true, // 需要 shell 支持 &&
          });
          return {
            success: true,
            message: stdout || 'Upgrade completed via apt-get',
          };
        } catch {
          // apt 失败（可能未安装或无权限），提示手动升级
          return {
            success: false,
            message: 'Linux auto-upgrade failed. Please run: sudo apt-get update && sudo apt-get upgrade openclaw',
          };
        }
      }

      return {
        success: false,
        message: `Unsupported platform: ${platform}`,
      };
    } catch (err) {
      // brew upgrade 如果已经是最新版会返回非 0，这不算是错误
      const errorStr = err instanceof Error ? err.message : String(err);
      if (errorStr.includes('already installed')) {
        return {
          success: true,
          message: 'Already at latest version',
        };
      }

      return {
        success: false,
        message: 'Upgrade command failed',
      };
    }
  }

  /**
   * 远程重启实现（SSH）
   *
   * TODO: 使用 node-ssh 库实现
   */
  private async remoteRestart(opts: LifecycleOptions): Promise<LifecycleResult> {
    // 远程模式暂返回错误，后续实现 SSH 支持
    return {
      success: false,
      message: 'Remote restart not yet implemented',
      error: 'SSH support coming in next release',
    };
  }

  /**
   * 远程升级实现（SSH）
   */
  private async remoteUpgrade(opts: LifecycleOptions): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Remote upgrade not yet implemented',
    };
  }

  /**
   * 检查 Gateway 连接状态
   */
  private async checkGatewayConnection(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(this.gatewayHealthEndpoint, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 等待 Gateway 就绪
   */
  private async waitForGateway(timeoutMs: number): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const isReady = await this.checkGatewayConnection();
      if (isReady) {
        return;
      }
      await sleep(POLL_INTERVAL);
    }

    throw new Error(`Gateway not ready after ${timeoutMs}ms`);
  }

  /**
   * 获取 Gateway PID
   *
   * 通过 lsof/netstat 查找占用 18789 端口的进程
   */
  private async getGatewayPid(): Promise<number | null> {
    try {
      const platform = process.platform;

      if (platform === 'darwin' || platform === 'linux') {
        // 使用 lsof 查找端口
        const { stdout } = await execFileAsync('lsof', ['-ti:18789'], {
          timeout: 5000,
        });
        const pid = parseInt(stdout.trim(), 10);
        return isNaN(pid) ? null : pid;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取平台信息
   */
  private getPlatform(): string {
    return process.platform;
  }

  /**
   * 备份 OpenClaw 配置
   *
   * 在升级前自动备份 ~/.openclaw/ 关键配置
   */
  private async backupConfig(): Promise<void> {
    try {
      const os = await import('os');
      const fs = await import('fs/promises');
      const path = await import('path');

      const homeDir = os.homedir();
      const openclawDir = path.join(homeDir, '.openclaw');
      const backupDir = path.join(openclawDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));

      // 创建备份目录
      await fs.mkdir(backupDir, { recursive: true });

      // 备份 openclaw.json
      const configPath = path.join(openclawDir, 'openclaw.json');
      try {
        await fs.copyFile(configPath, path.join(backupDir, 'openclaw.json'));
      } catch {
        // 文件不存在时忽略
      }

      // 备份 agents/ 目录
      const agentsDir = path.join(openclawDir, 'agents');
      const agentsBackupDir = path.join(backupDir, 'agents');
      try {
        await fs.cp(agentsDir, agentsBackupDir, { recursive: true, force: true });
      } catch {
        // 目录不存在时忽略
      }

      console.log(`[OpenClawLifecycle] Config backed up to: ${backupDir}`);
    } catch (err) {
      // 备份失败不阻塞升级，仅记录警告
      console.warn('[OpenClawLifecycle] Config backup failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
