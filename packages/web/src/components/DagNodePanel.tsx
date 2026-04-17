import { useDagStore } from '../stores/dagStore.js';
import { useLang } from '../i18n/LanguageContext.js';

interface DagNodePanelProps {
  agents: { id: string; name: string }[];
}

export function DagNodePanel({ agents }: DagNodePanelProps) {
  const { t } = useLang();
  const { nodes, selectedNodeId, updateNodeData, removeNode } = useDagStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="w-64 bg-gray-800 rounded-lg border border-gray-700 p-4">
        <p className="text-sm text-gray-400">{t('panel.click_to_edit')}</p>
      </div>
    );
  }

  const { data } = selectedNode;

  return (
    <div className="w-64 bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{t('panel.node_config')}</h3>
        <button
          onClick={() => removeNode(selectedNode.id)}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          {t('common.delete')}
        </button>
      </div>

      {/* Agent 选择 */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-400">{t('panel.agent')}</label>
        <select
          value={data.agentId}
          onChange={(e) =>
            updateNodeData(selectedNode.id, { agentId: e.target.value })
          }
          className="w-full px-2.5 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">{t('panel.agent_placeholder')}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      {/* Prompt 输入 */}
      <div className="space-y-1.5">
        <label className="text-xs text-gray-400">{t('panel.prompt')}</label>
        <textarea
          value={data.prompt}
          onChange={(e) =>
            updateNodeData(selectedNode.id, { prompt: e.target.value })
          }
          placeholder={t('panel.prompt_placeholder')}
          rows={6}
          className="w-full px-2.5 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none resize-none"
        />
      </div>

      {/* 节点 ID 显示 */}
      <div className="pt-2 border-t border-gray-700">
        <p className="text-xs text-gray-500">{t('panel.node_id')}: {selectedNode.id}</p>
      </div>
    </div>
  );
}
