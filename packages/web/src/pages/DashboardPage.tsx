import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentListResponse, SessionListResponse } from '@clawgate/shared';
import { useGatewayEvents } from '../hooks/useGatewayEvents.js';
import { useEventStore } from '../stores/eventStore.js';

async function fetchAgents(): Promise<AgentListResponse> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed');
  return res.json() as Promise<AgentListResponse>;
}

async function fetchSessions(): Promise<SessionListResponse> {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error('Failed');
  return res.json() as Promise<SessionListResponse>;
}

async function fetchRouterStats(): Promise<{ total: number; cache_hits: number; hit_rate: number } | null> {
  try {
    const res = await fetch('/api/route/stats');
    if (!res.ok) return null;
    return res.json() as Promise<{ total: number; cache_hits: number; hit_rate: number }>;
  } catch { return null; }
}

interface OpenClawStatus {
  version?: string;
  gatewayConnected?: boolean;
  pid?: number;
  platform?: string;
  uptime?: number | null;
  [key: string]: unknown;
}

interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}

async function fetchOpenClawStatus(): Promise<OpenClawStatus | null> {
  try {
    const res = await fetch('/api/openclaw/status');
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: OpenClawStatus };
    return json.success ? (json.data ?? null) : null;
  } catch { return null; }
}

async function fetchOpenClawUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch('/api/openclaw/update');
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: UpdateInfo };
    return json.success ? (json.data ?? null) : null;
  } catch { return null; }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-gray-800 rounded p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-mono mt-1">{value}</p>
    </div>
  );
}

// ── OpenClaw 运维面板（信息 + 命令提示模式） ──────────────────────

interface CommandSuggestion {
  label: string;
  command: string;
  hint?: string;
}

function getRestartCommands(_platform: string | undefined, pid: number | undefined): CommandSuggestion[] {
  const cmds: CommandSuggestion[] = [
    { label: '通过 OpenClaw CLI', command: 'openclaw gateway restart', hint: '推荐：CLI 自带重启逻辑' },
  ];
  if (pid) {
    cmds.push({
      label: '强制终止进程',
      command: `kill ${pid}`,
      hint: '若由 launchd / systemd / brew services 托管，将自动复活',
    });
  }
  return cmds;
}

function getUpgradeCommands(platform: string | undefined): CommandSuggestion[] {
  const isWindows = platform === 'win32';
  const cmds: CommandSuggestion[] = [
    {
      label: isWindows ? 'npm（推荐 - Windows）' : 'npm（通用）',
      command: 'npm install -g openclaw@latest',
      hint: isWindows ? '在 PowerShell 执行' : '若遇 EACCES 错误，加 sudo 或配置 npm 用户级 prefix',
    },
    { label: 'pnpm', command: 'pnpm add -g openclaw@latest' },
  ];
  if (platform === 'darwin') {
    cmds.unshift({ label: 'Homebrew（推荐 - macOS）', command: 'brew upgrade openclaw' });
  }
  return cmds;
}

function CommandRow({ cmd }: { cmd: CommandSuggestion }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{cmd.label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-amber-400 transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              已复制
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              复制
            </>
          )}
        </button>
      </div>
      <div className="flex items-center px-3 py-2 bg-gray-950/60 border border-gray-800 rounded-md">
        <span className="text-amber-500/70 font-mono text-xs mr-2 select-none">$</span>
        <code className="text-xs text-gray-200 font-mono break-all flex-1">{cmd.command}</code>
      </div>
      {cmd.hint && (
        <p className="text-[10px] text-gray-600 px-1">{cmd.hint}</p>
      )}
    </div>
  );
}

function OpenClawOpsPanel() {
  const [showWhy, setShowWhy] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['openclaw-status'],
    queryFn: fetchOpenClawStatus,
    refetchInterval: 30_000,
  });

  const { data: updateInfo } = useQuery({
    queryKey: ['openclaw-update'],
    queryFn: fetchOpenClawUpdate,
    refetchInterval: 60 * 60 * 1000, // 1h
    refetchOnWindowFocus: false,
  });

  const platform = status?.platform;
  const restartCmds = getRestartCommands(platform, status?.pid);
  const upgradeCmds = getUpgradeCommands(platform);

  const hasUpdate = updateInfo?.hasUpdate;
  const isInstalled = !!status?.version;

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gray-900/60 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status?.gatewayConnected
              ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'
              : isInstalled ? 'bg-amber-400' : 'bg-gray-600'
          }`} />
          <span className="text-sm font-semibold text-white">OpenClaw 运维</span>
          {hasUpdate && updateInfo?.latestVersion && (
            <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold text-amber-300 bg-amber-900/30 border border-amber-700/40 rounded-full">
              ⬆ 可升级 v{updateInfo.latestVersion}
            </span>
          )}
        </div>
        {status?.version && (
          <span className="text-xs text-gray-500 font-mono">v{String(status.version)}</span>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* 状态信息 */}
        {status ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-800/40 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">连接</p>
              <p className={`text-sm font-medium mt-0.5 ${status.gatewayConnected ? 'text-green-400' : 'text-amber-400'}`}>
                {status.gatewayConnected ? '已连接' : '未连接'}
              </p>
            </div>
            {status.pid !== undefined && status.pid !== null && (
              <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">PID</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{status.pid}</p>
              </div>
            )}
            {status.version && (
              <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">当前版本</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{status.version}</p>
              </div>
            )}
            {status.platform && (
              <div className="bg-gray-800/40 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">平台</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">
                  {status.platform === 'darwin' ? 'macOS' : status.platform === 'win32' ? 'Windows' : status.platform}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-1">无法获取 OpenClaw 状态（未安装或未运行）</p>
        )}

        {/* 架构说明 */}
        <div className="rounded-lg bg-gray-800/30 border border-gray-700/40 overflow-hidden">
          <button
            onClick={() => setShowWhy((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs text-gray-400">为什么 ClawGate 不直接执行重启 / 升级？</span>
            </div>
            <svg className={`w-3 h-3 text-gray-500 transition-transform ${showWhy ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showWhy && (
            <div className="px-3 py-2.5 border-t border-gray-700/40 text-[11px] text-gray-500 leading-relaxed">
              ClawGate 是独立服务，与 OpenClaw 不存在父子进程关系。直接 kill OpenClaw 后，
              若没有 launchd / systemd / brew services 等守护进程托管，进程将无法自动复活。
              团队模式下，中央服务器也无权操作成员本地的 OpenClaw 实例。
              因此 ClawGate 提供精确的命令建议，由你在终端中执行，确保安全可控。
            </div>
          )}
        </div>

        {/* 升级命令组 */}
        {hasUpdate ? (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">升级命令</h4>
              <span className="text-[10px] text-gray-500">
                {updateInfo?.currentVersion} → {updateInfo?.latestVersion}
              </span>
            </div>
            <div className="space-y-3">
              {upgradeCmds.map((cmd) => (
                <CommandRow key={cmd.command} cmd={cmd} />
              ))}
            </div>
          </div>
        ) : updateInfo && (
          <div className="px-3 py-2 rounded-lg bg-gray-800/30 border border-gray-700/40 text-xs text-gray-500">
            ✓ 已是最新版本{updateInfo.latestVersion ? ` (${updateInfo.latestVersion})` : ''}
          </div>
        )}

        {/* 重启命令组 */}
        {isInstalled && (
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">重启命令</h4>
            <div className="space-y-3">
              {restartCmds.map((cmd) => (
                <CommandRow key={cmd.command} cmd={cmd} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 实时事件流面板 ──────────────────────────────────────────────

const EVENT_TYPE_STYLES: Record<string, { color: string; label: string; dot: string }> = {
  'session.start':   { color: 'text-green-400',  label: 'START',   dot: 'bg-green-400' },
  'session.end':     { color: 'text-gray-400',   label: 'END',     dot: 'bg-gray-500' },
  'session.message': { color: 'text-blue-400',   label: 'MESSAGE', dot: 'bg-blue-400' },
  'session.failed':  { color: 'text-rose-400',   label: 'FAILED',  dot: 'bg-rose-400' },
  'connected':       { color: 'text-emerald-400', label: 'CONNECT', dot: 'bg-emerald-400' },
};

function LiveEventsPanel() {
  useGatewayEvents();
  const events = useEventStore((s) => s.events);
  const connected = useEventStore((s) => s.connected);
  const clearEvents = useEventStore((s) => s.clearEvents);

  const recent = events.slice(0, 10);

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('zh-CN', { hour12: false });
    } catch {
      return ts.slice(0, 19);
    }
  };

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 bg-gray-900/60 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connected
              ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)] animate-pulse'
              : 'bg-gray-600'
          }`} />
          <span className="text-sm font-semibold text-white">实时事件流</span>
          <span className="ml-2 text-[10px] text-gray-500">
            {connected ? '已订阅 ws://·/ws/events' : '未连接'}
          </span>
        </div>
        {events.length > 0 && (
          <button
            onClick={clearEvents}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            清空
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        {recent.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-500">
              {connected ? '等待 OpenClaw 事件...' : '尚未连接到事件流'}
            </p>
            <p className="text-[11px] text-gray-600 mt-1">
              在 OpenClaw 中创建 Session 或发送消息后，事件会实时显示
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {recent.map((evt, idx) => {
              const style = EVENT_TYPE_STYLES[evt.type] ?? {
                color: 'text-gray-400',
                label: evt.type.toUpperCase(),
                dot: 'bg-gray-500',
              };
              const sessionInfo = evt.sessionKey
                ? evt.sessionKey.length > 24 ? evt.sessionKey.slice(0, 24) + '...' : evt.sessionKey
                : null;
              return (
                <div
                  key={`${evt.type}-${evt.timestamp}-${idx}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-800/30 border border-gray-700/30 hover:bg-gray-800/50 transition-colors"
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${style.dot} shrink-0`} />
                  <span className={`text-[10px] font-bold font-mono ${style.color} w-16 shrink-0`}>
                    {style.label}
                  </span>
                  {sessionInfo && (
                    <span className="text-[11px] text-gray-400 font-mono truncate">
                      {sessionInfo}
                    </span>
                  )}
                  {evt.agentId && (
                    <span className="text-[11px] text-gray-500 truncate">
                      agent: {String(evt.agentId)}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600 ml-auto font-mono shrink-0">
                    {formatTime(evt.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: agents } = useQuery({ queryKey: ['agents'], queryFn: fetchAgents });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions });
  const { data: routerStats } = useQuery({ queryKey: ['router-stats'], queryFn: fetchRouterStats, refetchInterval: 5000 });

  const activeSessions = sessions?.sessions.filter((s) => s.status === 'active').length ?? '—';
  const hitRate = routerStats ? `${(routerStats.hit_rate * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Agents" value={agents?.total ?? '—'} />
        <StatCard label="Active Sessions" value={activeSessions} />
        <StatCard label="Route Requests" value={routerStats?.total ?? '—'} />
        <StatCard label="L1 Hit Rate" value={hitRate} />
      </div>

      {/* 实时事件流面板 */}
      <LiveEventsPanel />

      {/* OpenClaw 运维面板 */}
      <OpenClawOpsPanel />
    </div>
  );
}
