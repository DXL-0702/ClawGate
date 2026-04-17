import { Handle, Position, type NodeProps } from 'reactflow';
import type { ConditionNodeData, NodeExecutionStatus } from '../../stores/dagStore.js';
import { useDagStore } from '../../stores/dagStore.js';
import { useLang } from '../../i18n/LanguageContext.js';

function getStatusConfig(status: NodeExecutionStatus | undefined) {
  switch (status) {
    case 'running':
      return {
        border: 'border-teal-500/80',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_30px_-5px_rgba(20,184,166,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(20,184,166,0.25)]',
        bar: 'bg-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.8)]',
        barAnimation: 'animate-pulse',
        dot: 'bg-teal-500',
        dotRing: 'border-teal-500/30',
        dotAnimation: 'animate-ping',
        label: 'text-teal-500',
        labelBg: 'bg-teal-500/10',
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
        border: 'border-teal-700/50',
        shadow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4)]',
        hoverShadow: 'hover:shadow-[0_8px_30px_-4px_rgba(20,184,166,0.15)]',
        bar: 'bg-transparent',
        barAnimation: '',
        dot: 'bg-teal-700/60',
        dotRing: 'border-teal-700/30',
        dotAnimation: '',
        label: 'text-gray-500',
        labelBg: 'bg-gray-600/10',
      };
  }
}

const OP_LABELS: Record<string, string> = {
  eq: '==',
  neq: '!=',
  contains: 'contains',
  not_contains: '!contains',
  empty: 'is empty',
  not_empty: 'not empty',
};

export function ConditionNode({ data, selected, id }: NodeProps<ConditionNodeData>) {
  const { t } = useLang();
  const nodeStatuses = useDagStore((s) => s.nodeStatuses);
  const executionStatus = nodeStatuses[id] as NodeExecutionStatus | undefined;

  const cfg = getStatusConfig(executionStatus);
  const { expression } = data;
  const hasExpression = expression && expression.operator;

  const isSelected = selected && !executionStatus;
  const finalBorder = isSelected ? 'border-teal-500/60' : cfg.border;
  const finalShadow = isSelected
    ? 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_30px_-5px_rgba(20,184,166,0.3)]'
    : cfg.shadow;

  // Build readable expression text
  let exprText = t('node.condition_unconfigured');
  if (hasExpression) {
    const left = expression.left || '?';
    const op = OP_LABELS[expression.operator] ?? expression.operator;
    if (expression.operator === 'empty' || expression.operator === 'not_empty') {
      exprText = `${left} ${op}`;
    } else {
      const right = expression.right || '?';
      exprText = `${left} ${op} ${right}`;
    }
  }

  return (
    <div
      className={`
        relative w-56 rounded-xl border-2
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
      {/* Top status bar */}
      <div
        className={`
          absolute top-0 left-0 right-0 h-[3px] rounded-t-xl
          ${cfg.bar}
          ${cfg.barAnimation}
        `}
      />

      {/* Inner highlight */}
      <div className="absolute inset-0 rounded-xl pointer-events-none shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]" />

      {/* Input handle (top center) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-teal-400 !border-[3px] !border-gray-900 !rounded-full !-top-1.5"
      />

      {/* Content */}
      <div className="p-4 pt-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Status dot */}
            <div className="relative shrink-0">
              {executionStatus === 'running' && (
                <div className={`
                  absolute inset-0 rounded-full border-2 ${cfg.dotRing}
                  ${cfg.dotAnimation} scale-150
                `} />
              )}
              <div className={`
                relative w-2.5 h-2.5 rounded-full ${cfg.dot}
                ${executionStatus === 'running' ? 'shadow-[0_0_8px_rgba(20,184,166,0.8)]' : ''}
              `} />
            </div>

            {/* Diamond icon + title */}
            <div className={`
              flex items-center gap-1.5 px-2 py-1 rounded-lg shrink-0
              ${executionStatus === 'running' ? 'bg-teal-500/10' : 'bg-teal-900/30'}
            `}>
              <svg
                className={`w-3.5 h-3.5 ${executionStatus === 'running' ? 'text-teal-400' : 'text-teal-500'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 3l9 9-9 9-9-9 9-9z"
                />
              </svg>
              <span className="text-xs font-semibold text-teal-300">
                {t('condition.title')}
              </span>
            </div>
          </div>

          {/* Status micro-label */}
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

        {/* Expression preview */}
        <div className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed font-mono">
          {hasExpression ? (
            <span className="text-teal-300/80">{exprText}</span>
          ) : (
            <span className="italic text-gray-500">{t('node.condition_unconfigured')}</span>
          )}
        </div>

        {/* Running indicator */}
        {executionStatus === 'running' && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className="w-1 h-1 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1 h-1 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1 h-1 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-teal-500/80 font-medium">
              Evaluating...
            </span>
          </div>
        )}
      </div>

      {/* Output handles: True (left 30%) / False (right 70%) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!w-3 !h-3 !bg-green-400 !border-[3px] !border-gray-900 !rounded-full !-bottom-1.5"
        style={{ left: '30%' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!w-3 !h-3 !bg-rose-400 !border-[3px] !border-gray-900 !rounded-full !-bottom-1.5"
        style={{ left: '70%' }}
      />

      {/* T/F labels under handles */}
      <div className="absolute -bottom-5 flex w-full pointer-events-none">
        <span className="absolute text-[9px] font-bold text-green-400/70" style={{ left: '30%', transform: 'translateX(-50%)' }}>T</span>
        <span className="absolute text-[9px] font-bold text-rose-400/70" style={{ left: '70%', transform: 'translateX(-50%)' }}>F</span>
      </div>
    </div>
  );
}
