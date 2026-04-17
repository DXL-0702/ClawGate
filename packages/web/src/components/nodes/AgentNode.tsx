import { Handle, Position, type NodeProps } from 'reactflow';
import type { AgentNodeData } from '../../stores/dagStore.js';
import type { NodeExecutionStatus } from '../../stores/dagStore.js';
import { useDagStore } from '../../stores/dagStore.js';
import { useLang } from '../../i18n/LanguageContext.js';

/**
 * 亮橙主题专业化配色 + 精致视觉层次
 *
 * 阴影系统：
 * - 基础: shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]
 * - 内高光: shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]
 * - 悬浮发光: hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.15)]
 *
 * 状态配色：
 * - running:   amber-500  亮橙脉冲 + 双环发光
 * - completed: slate-500  冷岩灰沉稳
 * - failed:    rose-500   暖玫瑰警示
 * - pending:   gray-500   中性灰静默
 * - skipped:   stone-400  暖灰虚线
 */
function getStatusConfig(status: NodeExecutionStatus | undefined) {
  switch (status) {
    case 'running':
      return {
        // 边框：亮橙 + 外发光
        border: 'border-amber-500/80',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_30px_-5px_rgba(245,158,11,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.25)]',
        // 顶部条：亮橙脉冲
        bar: 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.8)]',
        barAnimation: 'animate-pulse',
        // 状态点：双环发光
        dot: 'bg-amber-500',
        dotRing: 'border-amber-500/30',
        dotAnimation: 'animate-ping',
        // 微标签
        label: 'text-amber-500',
        labelBg: 'bg-amber-500/10',
      };
    case 'completed':
      return {
        border: 'border-slate-500/70',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.5)]',
        bar: 'bg-slate-500',
        barAnimation: '',
        dot: 'bg-slate-500',
        dotRing: 'border-slate-500/30',
        dotAnimation: '',
        label: 'text-slate-400',
        labelBg: 'bg-slate-500/10',
      };
    case 'failed':
      return {
        border: 'border-rose-500/70',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_20px_-5px_rgba(225,29,72,0.3)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(225,29,72,0.2)]',
        bar: 'bg-rose-500',
        barAnimation: '',
        dot: 'bg-rose-500',
        dotRing: 'border-rose-500/30',
        dotAnimation: '',
        label: 'text-rose-400',
        labelBg: 'bg-rose-500/10',
      };
    case 'skipped':
      return {
        border: 'border-stone-500/50 border-dashed',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3)]',
        hoverShadow: '',
        bar: 'bg-stone-400',
        barAnimation: '',
        dot: 'bg-stone-400',
        dotRing: 'border-stone-400/30',
        dotAnimation: '',
        label: 'text-stone-400',
        labelBg: 'bg-stone-400/10',
      };
    case 'pending':
      return {
        border: 'border-gray-600/70',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.5)]',
        bar: 'bg-gray-500',
        barAnimation: '',
        dot: 'bg-gray-500',
        dotRing: 'border-gray-500/30',
        dotAnimation: '',
        label: 'text-gray-400',
        labelBg: 'bg-gray-500/10',
      };
    default:
      return {
        border: 'border-gray-700/70',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(245,158,11,0.15)]',
        bar: 'bg-transparent',
        barAnimation: '',
        dot: 'bg-gray-600',
        dotRing: 'border-gray-600/30',
        dotAnimation: '',
        label: 'text-gray-500',
        labelBg: 'bg-gray-600/10',
      };
  }
}

export function AgentNode({ data, selected, id }: NodeProps<AgentNodeData>) {
  const { t } = useLang();
  const nodeStatuses = useDagStore((s) => s.nodeStatuses);
  const executionStatus = nodeStatuses[id] as NodeExecutionStatus | undefined;

  const hasPrompt = data.prompt && data.prompt.length > 0;
  const hasAgent = data.agentId && data.agentId.length > 0;

  const cfg = getStatusConfig(executionStatus);

  // 选中状态覆盖
  const isSelected = selected && !executionStatus;
  const finalBorder = isSelected
    ? 'border-amber-500/60'
    : cfg.border;
  const finalShadow = isSelected
    ? 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_30px_-5px_rgba(245,158,11,0.3)]'
    : cfg.shadow;

  return (
    <div
      className={`
        relative w-60 rounded-xl border-2
        bg-gradient-to-b from-gray-800/98 to-gray-900/98
        backdrop-blur-sm
        transition-all duration-300 ease-out
        ${finalBorder}
        ${finalShadow}
        ${cfg.hoverShadow}
        shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]
        ${executionStatus === 'skipped' ? 'opacity-75' : ''}
      `}
    >
      {/* 顶部状态指示条 */}
      <div
        className={`
          absolute top-0 left-0 right-0 h-[3px] rounded-t-xl
          ${cfg.bar}
          ${cfg.barAnimation}
        `}
      />

      {/* 内高光边缘 */}
      <div className="absolute inset-0 rounded-xl pointer-events-none shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]" />

      {/* 输入连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 !border-[3px] !border-gray-900 !rounded-full !-top-1.5"
      />

      {/* 内容区 */}
      <div className="p-4 pt-5">
        {/* 头部：发光状态点 + Agent名 + 微标签 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* 发光状态点 */}
            <div className="relative shrink-0">
              {/* 外环发光（running时） */}
              {executionStatus === 'running' && (
                <div className={`
                  absolute inset-0 rounded-full border-2 ${cfg.dotRing}
                  ${cfg.dotAnimation} scale-150
                `} />
              )}
              {/* 状态点 */}
              <div className={`
                relative w-2.5 h-2.5 rounded-full ${cfg.dot}
                ${executionStatus === 'running' ? 'shadow-[0_0_8px_rgba(245,158,11,0.8)]' : ''}
              `} />
            </div>

            {/* Agent 图标 + 名称 */}
            <div className={`
              flex items-center gap-1.5 px-2 py-1 rounded-lg shrink-0
              ${executionStatus === 'running' ? 'bg-amber-500/10' : 'bg-gray-700/40'}
            `}>
              <svg
                className={`w-3.5 h-3.5 ${executionStatus === 'running' ? 'text-amber-500' : 'text-gray-400'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L9.75 14.5M19.5 5.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zM13.5 10.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zM19.5 15.75a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                />
              </svg>
              <span className="text-xs font-semibold text-gray-200 truncate max-w-[90px]">
                {hasAgent ? data.agentId : t('node.unconfigured')}
              </span>
            </div>
          </div>

          {/* 状态微标签 */}
          {executionStatus && (
            <span className={`
              text-[9px] font-bold uppercase tracking-wider
              px-1.5 py-0.5 rounded
              ${cfg.labelBg} ${cfg.label}
              shrink-0
            `}>
              {executionStatus === 'running' ? 'RUN' :
               executionStatus === 'completed' ? 'DONE' :
               executionStatus === 'failed' ? 'FAIL' :
               executionStatus === 'skipped' ? 'SKIP' : 'WAIT'}
            </span>
          )}
        </div>

        {/* Prompt 预览 */}
        <div className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
          {hasPrompt ? (
            <span className="text-gray-300">{data.prompt}</span>
          ) : (
            <span className="italic text-gray-500">{t('node.click_to_edit')}</span>
          )}
        </div>

        {/* 底部运行指示 */}
        {executionStatus === 'running' && (
          <div className="mt-3 flex items-center gap-2">
            {/* 进度点动画 */}
            <div className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1 h-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1 h-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-amber-500/80 font-medium">
              Executing...
            </span>
          </div>
        )}
      </div>

      {/* 输出连接点 */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 !border-[3px] !border-gray-900 !rounded-full !-bottom-1.5"
      />
    </div>
  );
}
