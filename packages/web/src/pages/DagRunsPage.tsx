import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.js';

interface DagRun {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'cron' | 'webhook';
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  duration: number | null;
}

interface DagInfo {
  id: string;
  name: string;
}

const PAGE_SIZE = 20;

export default function DagRunsPage() {
  const navigate = useNavigate();
  const { id: dagId } = useParams<{ id: string }>();
  const { t } = useLang();
  const [dag, setDag] = useState<DagInfo | null>(null);
  const [runs, setRuns] = useState<DagRun[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey] = useState(() => localStorage.getItem('clawgate-api-key') || '');

  const headers: Record<string, string> = apiKey ? { 'X-API-Key': apiKey } : {};

  // 加载 DAG 基本信息
  useEffect(() => {
    if (!dagId) return;
    fetch(`/api/dags/${dagId}`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(t('common.load_failed'));
        return r.json();
      })
      .then((data) => setDag({ id: data.id, name: data.name }))
      .catch(() => setDag(null));
  }, [dagId]);

  // 加载执行历史
  useEffect(() => {
    if (!dagId) return;
    setIsLoading(true);
    fetch(`/api/dags/${dagId}/runs?limit=${PAGE_SIZE}&offset=0`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(t('common.load_failed'));
        return r.json();
      })
      .then((data) => {
        setRuns(data.runs || []);
        setTotal(data.total || 0);
        setOffset(PAGE_SIZE);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [dagId]);

  // 加载更多
  const handleLoadMore = async () => {
    if (!dagId || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/dags/${dagId}/runs?limit=${PAGE_SIZE}&offset=${offset}`, { headers });
      if (!res.ok) throw new Error(t('common.load_failed'));
      const data = await res.json();
      setRuns((prev) => [...prev, ...(data.runs || [])]);
      setTotal(data.total || 0);
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknown_error'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const statusBadge = (status: DagRun['status']) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-700 text-gray-300',
      running: 'bg-amber-900/60 text-amber-300',
      completed: 'bg-green-900/60 text-green-300',
      failed: 'bg-red-900/60 text-red-300',
    };
    const labels: Record<string, string> = {
      pending: t('node.status.pending'),
      running: t('node.status.running'),
      completed: t('node.status.completed'),
      failed: t('node.status.failed'),
    };
    return (
      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    );
  };

  const triggerLabel = (trigger: DagRun['triggeredBy']) => {
    const key = `runs.trigger.${trigger}` as const;
    return t(key);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const hasMore = runs.length < total;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/dags/${dagId}`)}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← {t('runs.back_to_editor')}
            </button>
          </div>
          <h1 className="text-xl font-semibold text-white mt-2">
            {dag?.name ? `${dag.name} — ${t('runs.title')}` : t('runs.title')}
          </h1>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12">
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-700">
          <p className="text-red-400">{t('common.load_failed')}: {error}</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && runs.length === 0 && (
        <div className="text-center py-12 border border-dashed border-gray-700 rounded-lg">
          <p className="text-gray-400 mb-2">{t('runs.empty')}</p>
          <p className="text-sm text-gray-500">{t('runs.empty_hint')}</p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && runs.length > 0 && (
        <>
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('runs.col_status')}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('runs.col_trigger')}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('runs.col_started')}</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('runs.col_duration')}</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">{t('runs.col_action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/dags/${dagId}/runs/${run.id}`)}
                  >
                    <td className="px-4 py-3">
                      {statusBadge(run.status)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-300">{triggerLabel(run.triggeredBy)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-400">{formatDate(run.startedAt || run.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-400">{formatDuration(run.duration)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dags/${dagId}/runs/${run.id}`);
                        }}
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {t('runs.detail_link')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="text-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? t('common.loading') : t('runs.load_more')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
