import { Handle, Position, type NodeProps } from 'reactflow';
import type { AgentNodeData } from '../../stores/dagStore.js';
import type { NodeExecutionStatus } from '../../stores/dagStore.js';
import { useDagStore } from '../../stores/dagStore.js';
import { useLang } from '../../i18n/LanguageContext.js';

function getStatusStyles(status: NodeExecutionStatus | undefined) {
  switch (status) {
    case 'running':
      return {
        border: 'border-orange-400 shadow-lg shadow-orange-400/30',
        dot: 'bg-orange-400 animate-pulse',
        opacity: '',
        dotExtra: 'ring-2 ring-orange-400/40',
      };
    case 'completed':
      return {
        border: 'border-green-500 shadow-lg shadow-green-500/20',
        dot: 'bg-green-400',
        opacity: '',
        dotExtra: '',
      };
    case 'failed':
      return {
        border: 'border-red-500 shadow-lg shadow-red-500/20',
        dot: 'bg-red-400',
        opacity: '',
        dotExtra: '',
      };
    case 'skipped':
      return {
        border: 'border-yellow-500/60 border-dashed',
        dot: 'bg-yellow-400',
        opacity: 'opacity-60',
        dotExtra: '',
      };
    case 'pending':
      return {
        border: 'border-gray-600',
        dot: 'bg-gray-500',
        opacity: '',
        dotExtra: '',
      };
    default:
      return {
        border: 'border-gray-600',
        dot: '',
        opacity: '',
        dotExtra: '',
      };
  }
}

export function AgentNode({ data, selected, id }: NodeProps<AgentNodeData>) {
  const { t } = useLang();
  const nodeStatuses = useDagStore((s) => s.nodeStatuses);
  const executionStatus = nodeStatuses[id] as NodeExecutionStatus | undefined;

  const hasPrompt = data.prompt && data.prompt.length > 0;
  const hasAgent = data.agentId && data.agentId.length > 0;

  const statusStyles = getStatusStyles(executionStatus);

  // 执行状态优先于选中状态；无执行状态时显示选中蓝色
  const borderClass = executionStatus
    ? statusStyles.border
    : selected
    ? 'border-blue-500 shadow-lg shadow-blue-500/20'
    : 'border-gray-600';

  // 指示点：有执行状态时显示执行状态色，否则显示配置完成状态
  const dotClass = executionStatus
    ? statusStyles.dot
    : hasAgent
    ? 'bg-green-400'
    : 'bg-yellow-400';

  return (
    <div
      className={`
        w-56 rounded-lg border-2 transition-all duration-200
        bg-gray-800
        ${borderClass}
        ${statusStyles.opacity}
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
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass} ${statusStyles.dotExtra}`}
        />
        <span className="text-sm font-medium text-white truncate">
          {hasAgent ? data.agentId : t('node.unconfigured')}
        </span>
        {/* 执行状态标签 */}
        {executionStatus === 'running' && (
          <span className="ml-auto text-[10px] text-orange-400 font-medium animate-pulse flex-shrink-0">
            {t('node.status.running')}
          </span>
        )}
        {executionStatus === 'completed' && (
          <span className="ml-auto text-[10px] text-green-400 font-medium flex-shrink-0">
            ✓
          </span>
        )}
        {executionStatus === 'failed' && (
          <span className="ml-auto text-[10px] text-red-400 font-medium flex-shrink-0">
            ✗
          </span>
        )}
        {executionStatus === 'skipped' && (
          <span className="ml-auto text-[10px] text-yellow-400 font-medium flex-shrink-0">
            {t('node.status.skipped')}
          </span>
        )}
      </div>

      {/* Prompt 预览 */}
      <div className="px-3 py-2">
        <p
          className={`
            text-xs truncate
            ${hasPrompt ? 'text-gray-300' : 'text-gray-500 italic'}
          `}
        >
          {hasPrompt ? data.prompt : t('node.click_to_edit')}
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
