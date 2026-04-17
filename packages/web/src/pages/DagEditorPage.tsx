import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useDagStore, type NodeExecutionStatus } from '../stores/dagStore.js';
import { AgentNode } from '../components/nodes/AgentNode.js';
import { DagNodePanel } from '../components/DagNodePanel.js';
import { useLang } from '../i18n/LanguageContext.js';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

interface Agent {
  id: string;
  name: string;
}

interface NodeState {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: string;
  error?: string;
}

function DagEditorInner() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { t } = useLang();
  const isNew = id === 'new';

  const {
    nodes,
    edges,
    selectedNodeId,
    isRunning,
    runStatus,
    runOutput,
    runError,
    nodeStatuses,
    addNode,
    setSelectedNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    startRun,
    setRunResult,
    setRunError,
    resetRun,
    setNodeStatuses,
    clearNodeStatuses,
    updateEdgesWithStatus,
    toDefinition,
    loadFromDefinition,
    reset,
  } = useDagStore();

  const { fitView } = useReactFlow();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dagName, setDagName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('clawgate-api-key') || '');

  // 根据节点状态更新连线样式（执行时流动效果）
  useEffect(() => {
    updateEdgesWithStatus(nodeStatuses);
  }, [nodeStatuses, updateEdgesWithStatus]);

  // 加载 Agents 列表
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.agents || []);
      })
      .catch(() => setAgents([]));
  }, []);

  // 新建或加载现有 DAG
  useEffect(() => {
    if (isNew) {
      reset();
      clearNodeStatuses();
      setDagName('');
      setTimeout(() => {
        addNode('agent', { x: 300, y: 200 });
        fitView({ padding: 0.2 });
      }, 100);
    } else if (id) {
      fetch(`/api/dags/${id}`, {
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      })
        .then((r) => r.json())
        .then((data) => {
          setDagName(data.name);
          if (data.definition) {
            loadFromDefinition(data.definition);
            setTimeout(() => {
              fitView({ padding: 0.2 });
            }, 100);
          }
        })
        .catch(() => {
          navigate('/dags');
        });
    }
  }, [id, isNew, reset, clearNodeStatuses, addNode, loadFromDefinition, fitView, navigate]);

  // 添加节点
  const handleAddNode = useCallback(() => {
    const lastNode = nodes[nodes.length - 1];
    const position = lastNode
      ? { x: lastNode.position.x + 250, y: lastNode.position.y }
      : { x: 300, y: 200 };
    addNode('agent', position);
  }, [nodes, addNode]);

  // 保存 DAG（含 edges）
  const handleSave = async () => {
    if (!dagName.trim()) {
      alert(t('editor.enter_name'));
      return;
    }

    if (nodes.length === 0) {
      alert(t('editor.add_one_node'));
      return;
    }

    const firstNode = nodes[0];
    if (!firstNode?.data.agentId || !firstNode.data.prompt) {
      alert(t('editor.config_node'));
      setSelectedNode(firstNode!.id);
      return;
    }

    setIsSaving(true);
    try {
      const definition = toDefinition();

      const body = {
        name: dagName,
        definition: {
          nodes: definition.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            agentId: n.data.agentId,
            prompt: n.data.prompt,
          })),
          edges: definition.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          })),
        },
      };

      const isExisting = id && !isNew;
      const response = await fetch(isExisting ? `/api/dags/${id}` : '/api/dags', {
        method: isExisting ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(t('editor.save_failed'));

      const result = await response.json();
      if (!isExisting) {
        navigate(`/dags/${result.id}`);
      }
      alert(t('editor.save_success'));
    } catch (error) {
      alert(t('editor.save_failed') + ': ' + (error instanceof Error ? error.message : t('common.unknown_error')));
    } finally {
      setIsSaving(false);
    }
  };

  // 运行 DAG，轮询时写入节点级状态
  const handleRun = async () => {
    if (!id || isNew) {
      alert(t('editor.save_first'));
      return;
    }

    resetRun();
    clearNodeStatuses();
    startRun();

    try {
      const response = await fetch(`/api/dags/${id}/run`, {
        method: 'POST',
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
      });

      if (!response.ok) throw new Error(t('common.failed'));

      const result = await response.json();

      // 轮询：同时获取 run 状态和节点级状态（已内嵌在同一响应中）
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/dag-runs/${result.runId}`, {
            headers: apiKey ? { 'X-API-Key': apiKey } : {},
          });
          const runData = await statusRes.json();

          // 写入节点级状态
          if (Array.isArray(runData.nodes) && runData.nodes.length > 0) {
            const statuses: Record<string, NodeExecutionStatus> = {};
            for (const node of runData.nodes as NodeState[]) {
              statuses[node.nodeId] = node.status;
            }
            setNodeStatuses(statuses);
          }

          if (runData.status === 'completed') {
            clearInterval(pollInterval);
            setRunResult(runData.output || t('common.success'));
          } else if (runData.status === 'failed') {
            clearInterval(pollInterval);
            setRunError(runData.error || t('common.failed'));
          }
        } catch {
          // 轮询网络错误时静默忽略，继续轮询
        }
      }, 1000);

      // 60 秒超时
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isRunning) {
          setRunError(t('editor.timeout'));
        }
      }, 60000);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t('common.failed'));
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 - 图标化紧凑设计 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800/80 bg-gradient-to-b from-gray-900 to-gray-900/95">
        {/* DAG 名称输入 */}
        <div className="flex-1 max-w-xs">
          <input
            type="text"
            value={dagName}
            onChange={(e) => setDagName(e.target.value)}
            placeholder={t('editor.name_placeholder')}
            className="w-full px-3 py-2 text-sm bg-gray-800/80 border border-gray-700/60 rounded-lg text-white placeholder-gray-500 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 focus:outline-none transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]"
          />
        </div>

        {/* 分隔线 */}
        <div className="h-6 w-px bg-gray-800 mx-1" />

        {/* API Key 输入（临时） */}
        <div className="relative group">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              localStorage.setItem('clawgate-api-key', e.target.value);
            }}
            placeholder="API Key"
            className="w-32 px-3 py-2 text-xs bg-gray-800/60 border border-gray-700/50 rounded-lg text-white placeholder-gray-600 focus:border-amber-500/40 focus:outline-none transition-all"
            title="留空=个人模式，输入=团队模式"
          />
          {/* tooltip */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-gray-800 text-[10px] text-gray-400 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-gray-700">
            团队模式 API Key（可选）
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-6 w-px bg-gray-800 mx-1" />

        {/* 添加节点按钮 - 次要操作 */}
        <button
          onClick={handleAddNode}
          className="group flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-300 bg-gray-800/60 border border-gray-700/50 rounded-lg hover:bg-gray-700/60 hover:text-white hover:border-gray-600 transition-all duration-200"
          title="添加节点"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">{t('editor.add_node')}</span>
        </button>

        {/* 保存按钮 - 沉稳固态 */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700/50 disabled:text-slate-400 border border-slate-500 rounded-lg transition-all duration-200 shadow-sm"
          title="保存工作流"
        >
          {isSaving ? (
            <span className="w-3.5 h-3.5 border-2 border-slate-300/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="hidden sm:inline">{isSaving ? t('editor.saving') : t('editor.save')}</span>
        </button>

        {/* 运行按钮 - 亮橙主题色，强调 */}
        <button
          onClick={handleRun}
          disabled={isRunning || isNew}
          className={`
            group flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-all duration-200 shadow-sm
            ${isRunning
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed border-gray-700'
              : isNew
              ? 'bg-amber-600/50 text-amber-200/50 cursor-not-allowed border-amber-500/30'
              : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)]'}
          `}
          title={isNew ? '请先保存工作流' : '运行工作流'}
        >
          {isRunning ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-white rounded-full animate-spin" />
              <span>{t('editor.running')}</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
              </svg>
              <span>{t('editor.run')}</span>
            </>
          )}
        </button>
      </div>

      {/* 主区域：画布 + 属性面板 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 画布区域 */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node.id)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
            className="bg-gray-900"
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#6b7280', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
              animated: false,
            }}
          >
            <Background
              color="#4b5563"
              gap={20}
              size={1}
              style={{
                maskImage: 'radial-gradient(circle at center, black 40%, transparent 85%)',
                opacity: 0.12,
              }}
            />
            <Controls className="!bg-gray-800/90 !border-gray-700 !backdrop-blur-sm" />
            <MiniMap
              className="!bg-gray-800/90 !border-gray-700 !backdrop-blur-sm"
              maskColor="#11182790"
              nodeColor={(node) => {
                // 亮橙主题：选中=amber-500，默认=gray-600
                return node.id === selectedNodeId ? '#f59e0b' : '#4b5563';
              }}
            />
          </ReactFlow>
        </div>

        {/* 右侧属性面板 */}
        <div className="w-72 border-l border-gray-800 p-4 bg-gray-900/50 overflow-y-auto">
          <DagNodePanel agents={agents} />

          {/* 运行结果 */}
          {runStatus !== 'idle' && (
            <div className="mt-4 p-3 rounded-lg border border-gray-700 bg-gray-800">
              <p className="text-xs text-gray-400 mb-1">{t('editor.run_result')}</p>
              {runStatus === 'running' && (
                <p className="text-sm text-orange-400 animate-pulse">{t('editor.running')}</p>
              )}
              {runStatus === 'completed' && runOutput && (
                <p className="text-sm text-green-400 line-clamp-4">{runOutput}</p>
              )}
              {runStatus === 'failed' && runError && (
                <p className="text-sm text-red-400 line-clamp-4">{runError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DagEditorPage() {
  return (
    <ReactFlowProvider>
      <DagEditorInner />
    </ReactFlowProvider>
  );
}
