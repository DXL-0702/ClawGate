import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.js';

interface NodeState {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface RunDetail {
  id: string;
  dagId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'cron' | 'webhook';
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  duration: number | null;
  nodes: NodeState[];
}

export default function DagRunDetailPage() {
  const navigate = useNavigate();
  const { dagId, runId } = useParams<{ dagId: string; runId: string }>();
  const { t } = useLang();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey] = useState(() => localStorage.getItem('clawgate-api-key') || '');

  const headers: Record<string, string> = apiKey ? { 'X-API-Key': apiKey } : {};

  useEffect(() => {
    if (!runId) return;
    setIsLoading(true);
    fetch(`/api/dag-runs/${runId}`, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(t('common.load_failed'));
        return r.json();
      })
      .then((data) => {
        setRun(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [runId]);

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-700 text-gray-300',
      running: 'bg-amber-900/60 text-amber-300',
      completed: 'bg-green-900/60 text-green-300',
      failed: 'bg-red-900/60 text-red-300',
      skipped: 'bg-gray-800 text-gray-500',
    };
    const key = `node.status.${status}` as const;
    return (
      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${styles[status] || styles.pending}`}>
        {t(key) || status}
      </span>
    );
  };

  const triggerLabel = (trigger: string) => {
    const key = `runs.trigger.${trigger}` as const;
    return t(key);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
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

  const computeNodeDuration = (node: NodeState): number | null => {
    if (node.startedAt && node.endedAt) {
      return new Date(node.endedAt).getTime() - new Date(node.startedAt).getTime();
    }
    return null;
  };

  // 排序：按 startedAt 升序，skipped 放末尾
  const sortedNodes = run?.nodes
    ? [...run.nodes].sort((a, b) => {
        if (a.status === 'skipped' && b.status !== 'skipped') return 1;
        if (a.status !== 'skipped' && b.status === 'skipped') return -1;
        if (!a.startedAt && !b.startedAt) return 0;
        if (!a.startedAt) return 1;
        if (!b.startedAt) return -1;
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      })
    : [];

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate(`/dags/${dagId}/runs`)}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          ← {t('run_detail.back_to_runs')}
        </button>
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-700">
          <p className="text-red-400">{t('common.load_failed')}: {error}</p>
        </div>
      </div>
    );
  }

  if (!run) return null;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div>
        <button
          onClick={() => navigate(`/dags/${dagId}/runs`)}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          ← {t('run_detail.back_to_runs')}
        </button>
        <h1 className="text-xl font-semibold text-white mt-2">{t('run_detail.title')}</h1>
        <p className="text-xs text-gray-500 mt-1">ID: {run.id}</p>
      </div>

      {/* Run 概览卡片 */}
      <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-5">
        <h2 className="text-sm font-medium text-gray-300 mb-4">{t('run_detail.overview')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.status')}</p>
            {statusBadge(run.status)}
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.trigger')}</p>
            <p className="text-sm text-gray-300">{triggerLabel(run.triggeredBy)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.started_at')}</p>
            <p className="text-sm text-gray-300">{formatDate(run.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.duration')}</p>
            <p className="text-sm text-gray-300">{formatDuration(run.duration)}</p>
          </div>
        </div>

        {/* Output / Error */}
        {run.output && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.output')}</p>
            <pre className="text-sm text-green-400 bg-gray-800/50 rounded p-3 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {run.output}
            </pre>
          </div>
        )}
        {run.error && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-1">{t('run_detail.error')}</p>
            <pre className="text-sm text-red-400 bg-gray-800/50 rounded p-3 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {run.error}
            </pre>
          </div>
        )}
      </div>

      {/* 节点执行时间线 */}
      <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-5">
        <h2 className="text-sm font-medium text-gray-300 mb-4">{t('run_detail.nodes_timeline')}</h2>

        {sortedNodes.length === 0 ? (
          <p className="text-sm text-gray-500">{t('run_detail.no_nodes')}</p>
        ) : (
          <div className="space-y-0">
            {sortedNodes.map((node, idx) => {
              const duration = computeNodeDuration(node);
              const isLast = idx === sortedNodes.length - 1;
              return (
                <div key={node.nodeId} className="flex gap-4">
                  {/* 时间线竖线 + 节点圆点 */}
                  <div className="flex flex-col items-center w-6 shrink-0">
                    <div className={`w-3 h-3 rounded-full border-2 mt-1 ${
                      node.status === 'completed' ? 'bg-green-500 border-green-400' :
                      node.status === 'failed' ? 'bg-red-500 border-red-400' :
                      node.status === 'running' ? 'bg-amber-500 border-amber-400' :
                      node.status === 'skipped' ? 'bg-gray-600 border-gray-500' :
                      'bg-gray-700 border-gray-600'
                    }`} />
                    {!isLast && <div className="w-px flex-1 bg-gray-700 min-h-[24px]" />}
                  </div>

                  {/* 节点内容 */}
                  <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{node.nodeId}</span>
                      {statusBadge(node.status)}
                      {duration !== null && (
                        <span className="text-xs text-gray-500">{formatDuration(duration)}</span>
                      )}
                    </div>

                    {node.output && (
                      <pre className="text-xs text-gray-400 bg-gray-800/50 rounded p-2 mt-1 overflow-x-auto max-h-24 whitespace-pre-wrap">
                        {node.output}
                      </pre>
                    )}
                    {node.error && (
                      <pre className="text-xs text-red-400 bg-gray-800/50 rounded p-2 mt-1 overflow-x-auto max-h-24 whitespace-pre-wrap">
                        {node.error}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
