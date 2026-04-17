import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  type NodeTypes,
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
    toDefinition,
    loadFromDefinition,
    reset,
  } = useDagStore();

  const { fitView } = useReactFlow();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [dagName, setDagName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
      fetch(`/api/dags/${id}`)
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
        headers: { 'Content-Type': 'application/json' },
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
      });

      if (!response.ok) throw new Error(t('common.failed'));

      const result = await response.json();

      // 轮询：同时获取 run 状态和节点级状态（已内嵌在同一响应中）
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/dag-runs/${result.runId}`);
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
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/50">
        <input
          type="text"
          value={dagName}
          onChange={(e) => setDagName(e.target.value)}
          placeholder={t('editor.name_placeholder')}
          className="flex-1 max-w-xs px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />

        <button
          onClick={handleAddNode}
          className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded border border-gray-700 transition-colors"
        >
          {t('editor.add_node')}
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded transition-colors"
        >
          {isSaving ? t('editor.saving') : t('editor.save')}
        </button>

        <button
          onClick={handleRun}
          disabled={isRunning || isNew}
          className={`
            px-4 py-1.5 text-sm rounded transition-colors
            ${isRunning
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-500 text-white'}
          `}
        >
          {isRunning ? t('editor.running') : t('editor.run')}
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
          >
            <Background color="#374151" gap={16} size={1} />
            <Controls className="!bg-gray-800 !border-gray-700" />
            <MiniMap
              className="!bg-gray-800 !border-gray-700"
              maskColor="#11182780"
              nodeColor={(node) => {
                return node.id === selectedNodeId ? '#3b82f6' : '#4b5563';
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
