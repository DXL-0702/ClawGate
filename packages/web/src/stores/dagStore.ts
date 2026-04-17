import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  MarkerType,
} from 'reactflow';

export interface AgentNodeData {
  type: 'agent';
  agentId: string;
  prompt: string;
}

export interface ConditionNodeData {
  type: 'condition';
  expression: {
    left: string;
    operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'empty' | 'not_empty';
    right?: string;
  };
}

export interface DelayNodeData {
  type: 'delay';
  delaySeconds: number;
}

export type NodeData = AgentNodeData | ConditionNodeData | DelayNodeData;

export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface DagStore {
  // 画布状态
  nodes: Node<NodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;

  // 运行状态（run 级别）
  isRunning: boolean;
  runStatus: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  runOutput: string | null;
  runError: string | null;

  // 节点级执行状态
  nodeStatuses: Record<string, NodeExecutionStatus>;

  // 操作
  addNode: (type: 'agent' | 'condition' | 'delay', position: { x: number; y: number }) => void;
  updateNodeData: (id: string, data: Partial<NodeData>) => void;
  removeNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // 执行
  startRun: () => void;
  setRunResult: (output: string) => void;
  setRunError: (error: string) => void;
  resetRun: () => void;

  // 节点级执行状态操作
  setNodeStatuses: (statuses: Record<string, NodeExecutionStatus>) => void;
  clearNodeStatuses: () => void;

  // 加载/保存
  loadFromDefinition: (definition: {
    nodes: Array<{
      id: string;
      type: string;
      agentId?: string;
      prompt?: string;
      expression?: { left: string; operator: string; right?: string };
      delaySeconds?: number;
      position?: { x: number; y: number };
    }>;
    edges?: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
  }) => void;
  toDefinition: () => { nodes: Node<NodeData>[]; edges: Edge[] };
  reset: () => void;
}

const initialState = {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  isRunning: false,
  runStatus: 'idle' as const,
  runOutput: null,
  runError: null,
  nodeStatuses: {},
};

let nodeIdCounter = 0;

export const useDagStore = create<DagStore>((set, get) => ({
  ...initialState,

  addNode: (type, position) => {
    const id = `node-${++nodeIdCounter}`;
    const data: NodeData = type === 'condition'
      ? { type: 'condition', expression: { left: '', operator: 'eq', right: '' } }
      : type === 'delay'
      ? { type: 'delay', delaySeconds: 5 }
      : { type: 'agent', agentId: '', prompt: '' };
    const newNode: Node<NodeData> = {
      id,
      type,
      position,
      data,
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNodeId: id,
    }));
  },

  updateNodeData: (id, data) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node
      ),
    }));
  },

  removeNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    }));
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
    // 新连线使用亮橙主题协调配色
    const newEdge = {
      ...connection,
      type: 'smoothstep',
      style: { stroke: '#6b7280', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
      animated: false,
    };
    set({
      edges: addEdge(newEdge, get().edges),
    });
  },

  // 根据节点状态更新连线样式（用于执行时流动效果）
  updateEdgesWithStatus: (nodeStatuses: Record<string, string>) => {
    const currentEdges = get().edges;
    const updatedEdges = currentEdges.map((edge) => {
      const sourceStatus = nodeStatuses[edge.source];
      const isExecuted = sourceStatus === 'completed' || sourceStatus === 'running';
      const isRunning = sourceStatus === 'running';

      return {
        ...edge,
        // 上游已执行或正在执行：连线变亮
        style: {
          stroke: isExecuted ? '#64748b' : '#4b5563', // slate-500 : gray-600
          strokeWidth: isExecuted ? 2.5 : 1.5,
        },
        // 正在执行时：流动动画
        animated: isRunning,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isExecuted ? '#64748b' : '#4b5563',
        },
      };
    });
    set({ edges: updatedEdges });
  },

  startRun: () => {
    set({
      isRunning: true,
      runStatus: 'running',
      runOutput: null,
      runError: null,
    });
  },

  setRunResult: (output) => {
    set({
      isRunning: false,
      runStatus: 'completed',
      runOutput: output,
      runError: null,
    });
  },

  setRunError: (error) => {
    set({
      isRunning: false,
      runStatus: 'failed',
      runOutput: null,
      runError: error,
    });
  },

  resetRun: () => {
    set({
      isRunning: false,
      runStatus: 'idle',
      runOutput: null,
      runError: null,
    });
  },

  setNodeStatuses: (statuses) => {
    set({ nodeStatuses: statuses });
  },

  clearNodeStatuses: () => {
    set({ nodeStatuses: {} });
  },

  loadFromDefinition: (definition) => {
    const nodes: Node<NodeData>[] = definition.nodes.map((n, index) => {
      const data: NodeData = n.type === 'condition'
        ? {
            type: 'condition',
            expression: {
              left: n.expression?.left ?? '',
              operator: (n.expression?.operator as ConditionNodeData['expression']['operator']) ?? 'eq',
              right: n.expression?.right ?? '',
            },
          }
        : n.type === 'delay'
        ? {
            type: 'delay',
            delaySeconds: n.delaySeconds ?? 5,
          }
        : {
            type: 'agent',
            agentId: n.agentId ?? '',
            prompt: n.prompt ?? '',
          };

      return {
        id: n.id,
        type: n.type === 'condition' ? 'condition' : n.type === 'delay' ? 'delay' : 'agent',
        position: n.position ?? { x: 300 + index * 250, y: 200 },
        data,
      };
    });

    const edges: Edge[] = (definition.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

    set({
      nodes,
      edges,
      selectedNodeId: null,
      nodeStatuses: {},
    });

    const maxId = definition.nodes.reduce((max, node) => {
      const num = parseInt(node.id.replace('node-', ''));
      return Math.max(max, isNaN(num) ? 0 : num);
    }, 0);
    nodeIdCounter = maxId;
  },

  toDefinition: () => ({
    nodes: get().nodes,
    edges: get().edges,
  }),

  reset: () => {
    set(initialState);
    nodeIdCounter = 0;
  },
}));
