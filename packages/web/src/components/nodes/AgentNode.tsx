import { Handle, Position, type NodeProps } from 'reactflow';
import type { AgentNodeData } from '../../stores/dagStore.js';

export function AgentNode({ data, selected, id }: NodeProps<AgentNodeData>) {
  const hasPrompt = data.prompt && data.prompt.length > 0;
  const hasAgent = data.agentId && data.agentId.length > 0;

  return (
    <div
      className={`
        w-56 rounded-lg border-2 transition-all duration-200
        ${selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-gray-600'}
        bg-gray-800
      `}
    >
      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-800"
      />

      {/* 节点头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <div
          className={`
            w-2 h-2 rounded-full
            ${hasAgent ? 'bg-green-400' : 'bg-yellow-400'}
          `}
        />
        <span className="text-sm font-medium text-white truncate">
          {hasAgent ? data.agentId : '未配置 Agent'}
        </span>
      </div>

      {/* Prompt 预览 */}
      <div className="px-3 py-2">
        <p
          className={`
            text-xs truncate
            ${hasPrompt ? 'text-gray-300' : 'text-gray-500 italic'}
          `}
        >
          {hasPrompt ? data.prompt : '点击编辑 Prompt'}
        </p>
      </div>

      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-800"
      />
    </div>
  );
}
