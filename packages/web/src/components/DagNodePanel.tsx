import { useState } from 'react';
import { useDagStore, type ConditionNodeData } from '../stores/dagStore.js';
import { useLang } from '../i18n/LanguageContext.js';

const CONDITION_OPERATORS: ConditionNodeData['expression']['operator'][] = [
  'eq', 'neq', 'contains', 'not_contains', 'empty', 'not_empty',
];

const UNARY_OPERATORS = new Set(['empty', 'not_empty']);

interface DagNodePanelProps {
  agents: { id: string; name: string }[];
}

export function DagNodePanel({ agents }: DagNodePanelProps) {
  const { t } = useLang();
  const { nodes, selectedNodeId, updateNodeData, removeNode } = useDagStore();
  const [configOpen, setConfigOpen] = useState(true);
  const [promptOpen, setPromptOpen] = useState(true);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="w-80 p-4">
        <div className="bg-gray-800/40 rounded-2xl border border-gray-700/40 p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-700/50 to-gray-800/50 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
            <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">{t('panel.click_to_edit')}</p>
          <p className="text-xs text-gray-600 mt-1">点击画布上的节点进行配置</p>
        </div>

        {/* 节点列表概览 */}
        <div className="mt-4">
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">工作流节点</h4>
          <div className="space-y-1.5">
            {nodes.map((node, idx) => (
              <div
                key={node.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800/30 border border-gray-700/30 text-xs"
              >
                <span className="w-5 h-5 rounded-full bg-gray-700/50 flex items-center justify-center text-[10px] text-gray-500 font-mono">
                  {node.data.type === 'condition' ? '◇' : node.data.type === 'delay' ? '⏱' : (idx + 1)}
                </span>
                <span className="text-gray-400 truncate">
                  {node.data.type === 'condition'
                    ? t('condition.title')
                    : node.data.type === 'delay'
                    ? t('delay.title')
                    : (node.data.type === 'agent' ? (node.data.agentId || '未配置') : '未配置')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { data, id } = selectedNode;
  const isCondition = data.type === 'condition';
  const isDelay = data.type === 'delay';

  // 查找上游节点（用于变量引用）
  const upstreamNodes = nodes.filter((n) => {
    // 简单判断：在当前节点之前的节点视为上游
    const nodeIndex = nodes.findIndex((nn) => nn.id === id);
    const upstreamIndex = nodes.findIndex((nn) => nn.id === n.id);
    return upstreamIndex < nodeIndex;
  });

  return (
    <div className="w-80 p-4 space-y-3 overflow-y-auto">
      {/* 节点配置卡片 - 可折叠 */}
      <div className="bg-gradient-to-b from-gray-800/60 to-gray-900/60 rounded-xl border border-gray-700/40 overflow-hidden shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.03)]">
        {/* 卡片头部 - 可点击折叠 */}
        <button
          onClick={() => setConfigOpen(!configOpen)}
          className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${isCondition ? 'from-teal-500/20 to-teal-600/10' : isDelay ? 'from-violet-500/20 to-violet-600/10' : 'from-amber-500/20 to-amber-600/10'}`}>
              {isCondition ? (
                <svg className="w-4 h-4 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l9 9-9 9-9-9 9-9z" />
                </svg>
              ) : isDelay ? (
                <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold text-gray-200">
                {isCondition ? t('condition.title') : isDelay ? t('delay.title') : t('panel.node_config')}
              </h3>
              <p className="text-[10px] text-gray-500">{id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeNode(id);
              }}
              className="p-1.5 rounded-lg text-rose-400/70 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
              title={t('common.delete')}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <svg
              className={`w-4 h-4 text-gray-500 transition-transform ${configOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {/* 配置内容 */}
        {configOpen && (
          <div className="p-4 space-y-4">
            {isCondition && data.type === 'condition' ? (
              /* ── 条件节点表达式构建器 ── */
              <>
                {/* 左操作数 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t('condition.left')}
                  </label>
                  <input
                    type="text"
                    value={data.expression.left}
                    onChange={(e) =>
                      updateNodeData(id, {
                        type: 'condition',
                        expression: { ...data.expression, left: e.target.value },
                      } as any)
                    }
                    placeholder="{{node-1.output}}"
                    className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white font-mono placeholder-gray-600 focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 focus:outline-none transition-all hover:border-gray-600"
                  />
                </div>

                {/* 运算符 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t('condition.operator')}
                  </label>
                  <div className="relative">
                    <select
                      value={data.expression.operator}
                      onChange={(e) =>
                        updateNodeData(id, {
                          type: 'condition',
                          expression: { ...data.expression, operator: e.target.value as any },
                        } as any)
                      }
                      className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 focus:outline-none transition-all appearance-none hover:border-gray-600"
                    >
                      {CONDITION_OPERATORS.map((op) => (
                        <option key={op} value={op}>
                          {t(`condition.op.${op}` as any)}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* 右操作数（empty/not_empty 时隐藏） */}
                {!UNARY_OPERATORS.has(data.expression.operator) && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      {t('condition.right')}
                    </label>
                    <input
                      type="text"
                      value={data.expression.right ?? ''}
                      onChange={(e) =>
                        updateNodeData(id, {
                          type: 'condition',
                          expression: { ...data.expression, right: e.target.value },
                        } as any)
                      }
                      placeholder="error"
                      className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white font-mono placeholder-gray-600 focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 focus:outline-none transition-all hover:border-gray-600"
                    />
                  </div>
                )}

                {/* 节点 ID 信息 */}
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/40 border border-gray-800/50">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Node ID</span>
                  <code className="text-[10px] font-mono text-gray-400 bg-gray-800/50 px-2 py-0.5 rounded">{id}</code>
                </div>

                {/* 分支说明 */}
                <div className="flex gap-2 text-[10px]">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-green-500/10 border border-green-500/20">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    <span className="text-green-400">{t('condition.true_branch')}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/20">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="text-rose-400">{t('condition.false_branch')}</span>
                  </div>
                </div>
              </>
            ) : isDelay && data.type === 'delay' ? (
              /* ── 延迟节点配置 ── */
              <>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t('delay.seconds')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    step={1}
                    value={data.delaySeconds}
                    onChange={(e) =>
                      updateNodeData(id, {
                        type: 'delay',
                        delaySeconds: Math.max(0, parseInt(e.target.value) || 0),
                      } as any)
                    }
                    className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white font-mono focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 focus:outline-none transition-all hover:border-gray-600"
                  />
                  <p className="text-[10px] text-gray-500">{t('delay.hint')}</p>
                </div>

                {/* 节点 ID 信息 */}
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/40 border border-gray-800/50">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Node ID</span>
                  <code className="text-[10px] font-mono text-gray-400 bg-gray-800/50 px-2 py-0.5 rounded">{id}</code>
                </div>
              </>
            ) : (
              /* ── Agent 节点配置 ── */
              <>
                {/* Agent 选择 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t('panel.agent')}
                  </label>
                  <div className="relative">
                    <select
                      value={data.type === 'agent' ? data.agentId : ''}
                      onChange={(e) => updateNodeData(id, { agentId: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 focus:outline-none transition-all appearance-none hover:border-gray-600"
                    >
                      <option value="">{t('panel.agent_placeholder')}</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* 缓存 TTL */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t('cache.ttl')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    step={60}
                    value={data.type === 'agent' ? data.cacheTtl : 0}
                    onChange={(e) => updateNodeData(id, { cacheTtl: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full px-3 py-2.5 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-white font-mono focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 focus:outline-none transition-all hover:border-gray-600"
                  />
                  <p className="text-[10px] text-gray-500">{t('cache.hint')}</p>
                </div>

                {/* 节点 ID 信息 */}
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/40 border border-gray-800/50">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Node ID</span>
                  <code className="text-[10px] font-mono text-gray-400 bg-gray-800/50 px-2 py-0.5 rounded">{id}</code>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Prompt 编辑卡片 - 仅 agent 节点显示 */}
      {!isCondition && !isDelay && data.type === 'agent' && (
        <div className="bg-gradient-to-b from-gray-800/60 to-gray-900/60 rounded-xl border border-gray-700/40 overflow-hidden shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.03)]">
          <button
            onClick={() => setPromptOpen(!promptOpen)}
            className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/10">
                <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-200">{t('panel.prompt')}</h3>
            </div>
            <svg
              className={`w-4 h-4 text-gray-500 transition-transform ${promptOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {promptOpen && (
            <div className="p-4">
              <textarea
                value={data.prompt}
                onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
                placeholder={t('panel.prompt_placeholder')}
                rows={10}
                className="w-full px-3 py-3 text-sm bg-gray-900/80 border border-gray-700/50 rounded-lg text-gray-200 placeholder-gray-600 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 focus:outline-none resize-none font-mono leading-relaxed transition-all hover:border-gray-600"
                spellCheck={false}
              />

              {/* 字符计数 */}
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
                <span>字符: {data.prompt.length}</span>
                <span>行: {data.prompt.split('\n').length}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 变量引用地图 */}
      {upstreamNodes.length > 0 && (
        <div className="bg-gradient-to-br from-amber-900/20 to-amber-950/10 rounded-xl border border-amber-700/20 p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.2)]">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h4 className="text-xs font-semibold text-amber-400">可用变量引用</h4>
          </div>
          <div className="space-y-1.5">
            {upstreamNodes.map((node) => (
              <div
                key={node.id}
                className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10"
              >
                <code className="text-[11px] font-mono text-amber-300">{'{{' + node.id + '.output}}'}</code>
                <span className="text-[9px] text-amber-500/60 truncate max-w-[80px]">
                  {node.data.agentId || '未命名'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-amber-400/50 leading-relaxed">
            在 Prompt 中使用上述变量引用上游节点输出
          </p>
        </div>
      )}

      {/* 快捷提示 */}
      <div className="px-4 py-3 rounded-xl bg-gray-800/30 border border-gray-700/30">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <div>
            <p className="text-[10px] text-gray-400">快捷键</p>
            <p className="text-[10px] text-gray-500 mt-0.5">拖拽节点调整位置 · 点击连线连接节点</p>
          </div>
        </div>
      </div>
    </div>
  );
}
