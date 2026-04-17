import { useQuery } from '@tanstack/react-query';
import { useLang } from '../i18n/LanguageContext.js';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';

interface StatsOverview {
  routing: {
    total: number;
    by_layer: Record<string, number>;
    layer_pct: Record<string, number>;
    avg_latency_ms: number;
  };
  costs: {
    today_usd: number;
    budget_limit_usd: number;
    budget_used_pct: number;
    by_model: Record<string, { tokens: number; usd: number }>;
  };
  trend: {
    dates: string[];
    usd: number[];
  };
  circuit: Record<string, { state: string; allowed: boolean }> | null;
}

const LAYER_COLORS: Record<string, string> = {
  L1: '#f59e0b',
  L2: '#3b82f6',
  L3: '#8b5cf6',
};

const MODEL_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444', '#6b7280'];

export default function StatsPage() {
  const { t } = useLang();

  const { data, isLoading, error } = useQuery<StatsOverview>({
    queryKey: ['stats-overview'],
    queryFn: async () => {
      const res = await fetch('/api/stats/overview');
      if (!res.ok) throw new Error(t('common.load_failed'));
      return res.json();
    },
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-text-secondary">{t('common.loading')}</div>;
  }
  if (error || !data) {
    return <div className="text-red-400 p-6">{t('common.load_failed')}</div>;
  }

  // Prepare chart data
  const layerData = Object.entries(data.routing.by_layer)
    .filter(([, count]) => count > 0)
    .map(([layer, count]) => ({
      layer,
      count,
      pct: data.routing.layer_pct[layer] ?? 0,
    }));

  const trendData = data.trend.dates.map((date, i) => ({
    date: date.slice(5), // MM-DD
    usd: data.trend.usd[i] ?? 0,
  }));

  const modelData = Object.entries(data.costs.by_model).map(([model, info]) => ({
    name: model,
    tokens: info.tokens,
    usd: info.usd,
  }));

  const circuitEntries = data.circuit ? Object.entries(data.circuit) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t('stats.title')}</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label={t('stats.total_requests')} value={String(data.routing.total)} />
        <SummaryCard label={t('stats.avg_latency')} value={`${data.routing.avg_latency_ms.toFixed(1)}ms`} />
        <SummaryCard label={t('stats.today_cost')} value={`$${data.costs.today_usd.toFixed(4)}`} />
        <SummaryCard
          label={t('stats.budget_used')}
          value={data.costs.budget_limit_usd > 0 ? `${data.costs.budget_used_pct.toFixed(1)}%` : '—'}
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Routing layer distribution */}
        <ChartCard title={t('stats.routing_distribution')}>
          {layerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={layerData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis type="category" dataKey="layer" tick={{ fill: '#9ca3af', fontSize: 12 }} width={40} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#f59e0b' }}
                  formatter={(value: number, _name: string, props: { payload: { pct: number } }) => [
                    `${value} (${props.payload.pct}%)`,
                    t('stats.requests'),
                  ]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {layerData.map((entry) => (
                    <Cell key={entry.layer} fill={LAYER_COLORS[entry.layer] ?? '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text={t('stats.no_data')} />
          )}
        </ChartCard>

        {/* Cost trend */}
        <ChartCard title={t('stats.cost_trend')}>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#f59e0b' }}
                  formatter={(value: number) => [`$${value.toFixed(4)}`, t('stats.usd')]}
                />
                <Line type="monotone" dataKey="usd" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text={t('stats.no_data')} />
          )}
        </ChartCard>

        {/* Model usage (pie) */}
        <ChartCard title={t('stats.model_usage')}>
          {modelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={modelData}
                  dataKey="tokens"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {modelData.map((_entry, idx) => (
                    <Cell key={idx} fill={MODEL_COLORS[idx % MODEL_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString()} tokens`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState text={t('stats.no_data')} />
          )}
        </ChartCard>

        {/* Circuit breaker status */}
        <ChartCard title={t('stats.circuit_status')}>
          {circuitEntries.length > 0 ? (
            <div className="space-y-3 pt-2">
              {circuitEntries.map(([name, status]) => (
                <div key={name} className="flex items-center justify-between px-4 py-3 rounded-lg bg-bg-base">
                  <span className="text-sm font-medium text-text-primary">{name}</span>
                  <CircuitBadge state={status.state} t={t} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text={t('stats.no_data')} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-overlay border border-border-subtle p-4">
      <p className="text-xs text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-text-primary mt-1">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-bg-overlay border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">{title}</h3>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-text-tertiary text-sm">
      {text}
    </div>
  );
}

function CircuitBadge({ state, t }: { state: string; t: (key: string) => string }) {
  const map: Record<string, { color: string; key: string }> = {
    Closed: { color: 'bg-green-500/20 text-green-400 border-green-500/30', key: 'stats.circuit_closed' },
    Open: { color: 'bg-red-500/20 text-red-400 border-red-500/30', key: 'stats.circuit_open' },
    HalfOpen: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', key: 'stats.circuit_halfopen' },
  };
  const info = map[state] ?? map['Closed']!;
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${info.color}`}>
      {t(info.key)}
    </span>
  );
}
