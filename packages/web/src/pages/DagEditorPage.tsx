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

import { useDagStore } from '../stores/dagStore.js';
import { AgentNode } from '../components/nodes/AgentNode.js';
import { DagNodePanel } from '../components/DagNodePanel.js';

const nodeTypes: NodeTypes = {
  agent: AgentNode,
};

interface Agent {
  id: string;
  name: string;
}

function DagEditorInner() {
  const navigate = useNavigate();
  const { id } = useParams();
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
    toDefinition,
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
      setDagName('');
      // 自动添加一个节点在画布中央
      setTimeout(() => {
        addNode('agent', { x: 300, y: 200 });
        fitView({ padding: 0.2 });
      }, 100);
    } else if (id) {
      // 加载现有 DAG（Week 2 实现）
      fetch(`/api/dags/${id}`)
        .then((r) => r.json())
        .then((data) => {
          setDagName(data.name);
          // TODO: loadFromDefinition(data.definition);
        })
        .catch(() => {
          navigate('/dags');
        });
    }
  }, [id, isNew, reset, addNode, fitView, navigate]);

  // 添加节点
  const handleAddNode = useCallback(() => {
    // 在选中节点右侧添加，或在画布中央添加
    const lastNode = nodes[nodes.length - 1];
    const position = lastNode
      ? { x: lastNode.position.x + 250, y: lastNode.position.y }
      : { x: 300, y: 200 };
    addNode('agent', position);
  }, [nodes, addNode]);

  // 保存 DAG
  const handleSave = async () => {
    if (!dagName.trim()) {
      alert('请输入 DAG 名称');
      return;
    }

    // Week 1: 单节点验证，确保至少有一个节点
    if (nodes.length === 0) {
      alert('请至少添加一个节点');
      return;
    }

    // 验证节点配置
    const firstNode = nodes[0];
    if (!firstNode.data.agentId || !firstNode.data.prompt) {
      alert('请配置节点的 Agent 和 Prompt');
      setSelectedNode(firstNode.id);
      return;
    }

    setIsSaving(true);
    try {
      const definition = toDefinition();
      const response = await fetch('/api/dags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dagName,
          definition: {
            nodes: definition.nodes.map((n) => ({
              id: n.id,
              type: n.type,
              agentId: n.data.agentId,
              prompt: n.data.prompt,
            })),
            // Week 1: 无 edges
          },
        }),
      });

      if (!response.ok) throw new Error('Save failed');

      const result = await response.json();
      navigate(`/dags/${result.id}`);
      alert('保存成功');
    } catch (error) {
      alert('保存失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  // 运行 DAG
  const handleRun = async () => {
    if (!id || isNew) {
      alert('请先保存 DAG');
      return;
    }

    resetRun();
    startRun();

    try {
      const response = await fetch(`/api/dags/${id}/run`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Run failed');

      const result = await response.json();

      // 轮询结果
      const pollInterval = setInterval(async () => {
        const statusRes = await fetch(`/api/dag-runs/${result.runId}`);
        const status = await statusRes.json();

        if (status.status === 'completed') {
          clearInterval(pollInterval);
          setRunResult(status.output || '执行完成');
        } else if (status.status === 'failed') {
          clearInterval(pollInterval);
          setRunError(status.error || '执行失败');
        }
      }, 1000);

      // 30 秒超时
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isRunning) {
          setRunError('执行超时');
        }
      }, 30000);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '执行失败');
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
          placeholder="输入 DAG 名称..."
          className="flex-1 max-w-xs px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />

        <button
          onClick={handleAddNode}
          className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-white rounded border border-gray-700 transition-colors"
        >
          + 添加节点
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded transition-colors"
        >
          {isSaving ? '保存中...' : '保存'}
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
          {isRunning ? '运行中...' : '运行'}
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
              <p className="text-xs text-gray-400 mb-1">运行结果</p>
              {runStatus === 'running' && (
                <p className="text-sm text-blue-400">运行中...</p>
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
