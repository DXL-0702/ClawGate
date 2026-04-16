import { useQuery } from '@tanstack/react-query';
import { useEventStore } from '../stores/eventStore.js';

interface RouterStats {
  total: number;
  cache_hits: number;
  hit_rate: number;
}

interface RoutingLog {
  id: number;
  sessionKey?: string;
  prompt: string;
  layer: string;
  model: string;
  cacheHit: boolean;
  latencyMs: number;
  createdAt: string;
}

async function fetchStats(): Promise<RouterStats> {
  const res = await fetch('/api/route/stats');
  if (!res.ok) throw new Error('Failed to fetch router stats');
  return res.json() as Promise<RouterStats>;
}

async function fetchRoute(prompt: string): Promise<RoutingLog> {
  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error('Route request failed');
  return res.json() as Promise<RoutingLog>;
}

const LAYER_COLOR: Record<string, string> = {
  L1: 'bg-green-900 text-green-300',
  L2: 'bg-blue-900 text-blue-300',
  L3: 'bg-yellow-900 text-yellow-300',
  L4: 'bg-orange-900 text-orange-300',
};

export default function RouterPage() {
  const { events } = useEventStore();
  const routeEvents = events.filter((e) => e.type === 'route.decision');

  const { data: stats, refetch } = useQuery({
    queryKey: ['router-stats'],
    queryFn: fetchStats,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Router</h1>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-gray-800 rounded p-4">
          <p className="text-xs text-gray-400">Total Requests</p>
          <p className="text-2xl font-mono">{stats?.total ?? '—'}</p>
        </div>
        <div className="border border-gray-800 rounded p-4">
          <p className="text-xs text-gray-400">L1 Cache Hits</p>
          <p className="text-2xl font-mono">{stats?.cache_hits ?? '—'}</p>
        </div>
        <div className="border border-gray-800 rounded p-4">
          <p className="text-xs text-gray-400">Hit Rate</p>
          <p className="text-2xl font-mono">
            {stats ? `${(stats.hit_rate * 100).toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>

      {/* 实时路由事件流 */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 mb-2">Live Route Decisions</h2>
        {routeEvents.length === 0 && (
          <p className="text-gray-500 text-sm">No route decisions yet.</p>
        )}
        <ul className="space-y-2">
          {routeEvents.slice(0, 20).map((e, i) => (
            <li key={i} className="border border-gray-800 rounded p-3 text-sm font-mono">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  LAYER_COLOR[e['layer'] as string] ?? 'bg-gray-800 text-gray-400'
                }`}>{String(e['layer'])}</span>
                <span className="text-gray-300">{String(e['model'])}</span>
                {e['cache_hit'] && <span className="text-green-400 text-xs">CACHE</span>}
                <span className="text-gray-500 text-xs ml-auto">{Number(e['latency_ms']).toFixed(1)}ms</span>
              </div>
              <p className="text-gray-500 truncate">{String(e['prompt'] ?? '').slice(0, 80)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
