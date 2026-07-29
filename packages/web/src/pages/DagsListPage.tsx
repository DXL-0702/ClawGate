import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../i18n/LanguageContext.js';

interface Dag {
  id: string;
  name: string;
  createdAt: string;
}

export default function DagsListPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [dags, setDags] = useState<Dag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDags = () => {
    setIsLoading(true);
    fetch('/api/dags')
      .then((r) => {
        if (!r.ok) throw new Error(t('common.load_failed'));
        return r.json();
      })
      .then((data) => {
        setDags(data.dags || []);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  };

  useEffect(() => { loadDags(); }, [t]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 导出：fetch 二进制 JSON → 浏览器下载
  const handleExport = async (e: React.MouseEvent, dagId: string) => {
    e.stopPropagation();
    setExportingId(dagId);
    try {
      const res = await fetch(`/api/dags/${dagId}/export`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `dag_${dagId.slice(0, 8)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportError('导出失败，请重试');
    } finally {
      setExportingId(null);
    }
  };

  // 导入：读取文件 → POST /api/dags/import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input 值，允许重复选同一文件
    e.target.value = '';

    setImportError(null);
    setImportSuccess(null);

    let json: unknown;
    try {
      const text = await file.text();
      json = JSON.parse(text);
    } catch {
      setImportError('文件格式错误：不是有效的 JSON');
      return;
    }

    try {
      const res = await fetch('/api/dags/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(`导入失败：${data.error ?? '未知错误'}`);
        return;
      }
      setImportSuccess(`已导入：${data.name}（ID: ${data.id.slice(0, 8)}）`);
      loadDags(); // 刷新列表
    } catch {
      setImportError('导入请求失败，请检查服务器状态');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{t('dags.title')}</h1>
          <p className="text-sm text-gray-400 mt-1">{t('dags.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 导入按钮 */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-300 bg-gray-800/60 border border-gray-700/50 rounded-lg hover:bg-gray-700/60 hover:text-white hover:border-gray-600 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            导入
          </button>
          {/* 新建按钮 */}
          <button
            onClick={() => navigate('/dags/new')}
            className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg border border-amber-500 hover:border-amber-400 transition-all shadow-sm hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]"
          >
            {t('dags.create')}
          </button>
        </div>
      </div>

      {/* 导入结果提示 */}
      {importError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/50">
          <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <p className="text-sm text-red-400">{importError}</p>
          <button onClick={() => setImportError(null)} className="ml-auto text-red-500 hover:text-red-300 text-xs">✕</button>
        </div>
      )}
      {importSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-900/20 border border-green-700/50">
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-400">{importSuccess}</p>
          <button onClick={() => setImportSuccess(null)} className="ml-auto text-green-600 hover:text-green-300 text-xs">✕</button>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-12">
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-700">
          <p className="text-red-400">{t('common.load_failed')}: {error}</p>
        </div>
      )}

      {!isLoading && !error && dags.length === 0 && (
        <div className="text-center py-12 border border-dashed border-gray-700 rounded-lg">
          <p className="text-gray-400 mb-4">{t('dags.empty')}</p>
          <button
            onClick={() => navigate('/dags/new')}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors"
          >
            {t('dags.create_first')}
          </button>
        </div>
      )}

      {!isLoading && !error && dags.length > 0 && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('dags.col_name')}</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">{t('dags.col_created')}</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">{t('dags.col_action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {dags.map((dag) => (
                <tr
                  key={dag.id}
                  className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/dags/${dag.id}`)}
                >
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-white">{dag.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">ID: {dag.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-400">{formatDate(dag.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* 导出按钮 */}
                      <button
                        onClick={(e) => handleExport(e, dag.id)}
                        disabled={exportingId === dag.id}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
                        title="导出为 JSON"
                      >
                        {exportingId === dag.id ? (
                          <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        )}
                        导出
                      </button>
                      <span className="text-gray-700">·</span>
                      {/* 编辑按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dags/${dag.id}`);
                        }}
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {t('dags.edit_link')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
