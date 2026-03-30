import { useQuery } from '@tanstack/react-query';
import type { AgentListResponse, SessionListResponse } from '@clawgate/shared';

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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-gray-800 rounded p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-mono mt-1">{value}</p>
    </div>
  );
}

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
    </div>
  );
}
