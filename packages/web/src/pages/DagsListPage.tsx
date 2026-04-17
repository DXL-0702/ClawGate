import { useEffect, useState } from 'react';
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

  useEffect(() => {
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
  }, [t]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">{t('dags.title')}</h1>
          <p className="text-sm text-gray-400 mt-1">{t('dags.subtitle')}</p>
        </div>
        <button
          onClick={() => navigate('/dags/new')}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
        >
          {t('dags.create')}
        </button>
      </div>

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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/dags/${dag.id}`);
                      }}
                      className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {t('dags.edit_link')}
                    </button>
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
