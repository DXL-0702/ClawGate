export type Lang = 'zh' | 'en';

const translations = {
  zh: {
    // 导航
    'nav.dashboard': 'Dashboard',
    'nav.agents': 'Agents',
    'nav.sessions': 'Sessions',
    'nav.router': 'Router',
    'nav.dags': 'DAG 工作流',
    'nav.system_online': '系统在线',

    // 通用
    'common.loading': '加载中...',
    'common.save': '保存',
    'common.saving': '保存中...',
    'common.run': '运行',
    'common.running': '运行中...',
    'common.cancel': '取消',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.create': '新建',
    'common.success': '成功',
    'common.failed': '失败',
    'common.error': '错误',
    'common.unknown_error': '未知错误',
    'common.load_failed': '加载失败',

    // DAG 列表页
    'dags.title': 'DAG 工作流',
    'dags.subtitle': '创建和管理多步骤 AI 工作流',
    'dags.create': '+ 新建 DAG',
    'dags.empty': '还没有创建任何 DAG',
    'dags.create_first': '创建第一个 DAG',
    'dags.col_name': '名称',
    'dags.col_created': '创建时间',
    'dags.col_action': '操作',
    'dags.edit_link': '编辑 →',

    // DAG 编辑器
    'editor.name_placeholder': '输入 DAG 名称...',
    'editor.add_node': '+ 添加节点',
    'editor.add_condition': '+ 条件',
    'editor.add_delay': '+ 延迟',
    'editor.save': '保存',
    'editor.saving': '保存中...',
    'editor.run': '运行',
    'editor.running': '运行中...',
    'editor.run_result': '运行结果',
    'editor.save_first': '请先保存 DAG',
    'editor.enter_name': '请输入 DAG 名称',
    'editor.add_one_node': '请至少添加一个节点',
    'editor.add_one_agent_node': '请至少配置一个 Agent 节点（含 Agent 和 Prompt）',
    'editor.config_node': '请配置节点的 Agent 和 Prompt',
    'editor.save_success': '保存成功',
    'editor.save_failed': '保存失败',
    'editor.timeout': '执行超时',

    // 节点面板
    'panel.node_config': '节点配置',
    'panel.agent': 'Agent',
    'panel.agent_placeholder': '选择 Agent...',
    'panel.prompt': 'Prompt',
    'panel.prompt_placeholder': '输入要发送给 Agent 的 Prompt...\n\n支持变量替换：{{node-1.output}}',
    'panel.node_id': '节点 ID',
    'panel.click_to_edit': '点击画布上的节点进行编辑',

    // Agent 节点
    'node.unconfigured': '未配置 Agent',
    'node.click_to_edit': '点击编辑 Prompt',
    'node.condition_unconfigured': '未配置条件',

    // 条件节点
    'condition.title': '条件分支',
    'condition.left': '左操作数',
    'condition.operator': '运算符',
    'condition.right': '右操作数',
    'condition.op.eq': '等于',
    'condition.op.neq': '不等于',
    'condition.op.contains': '包含',
    'condition.op.not_contains': '不包含',
    'condition.op.empty': '为空',
    'condition.op.not_empty': '不为空',
    'condition.true_branch': 'True 分支',
    'condition.false_branch': 'False 分支',

    // 延迟节点
    'delay.title': '延迟',
    'delay.seconds': '延迟秒数',
    'delay.hint': '范围 0-3600 秒（1 小时）',

    // 节点执行状态
    'node.status.pending': '等待中',
    'node.status.running': '执行中',
    'node.status.completed': '已完成',
    'node.status.failed': '失败',
    'node.status.skipped': '已跳过',

    // 编辑器 — 历史按钮
    'editor.run_history': '历史',

    // 执行历史列表
    'runs.title': '执行历史',
    'runs.back_to_editor': '返回编辑器',
    'runs.col_status': '状态',
    'runs.col_trigger': '触发方式',
    'runs.col_started': '开始时间',
    'runs.col_duration': '耗时',
    'runs.col_action': '操作',
    'runs.detail_link': '详情 →',
    'runs.load_more': '加载更多',
    'runs.empty': '暂无执行记录',
    'runs.empty_hint': '运行 DAG 后将在此展示执行历史',
    'runs.trigger.manual': '手动',
    'runs.trigger.cron': '定时',
    'runs.trigger.webhook': 'Webhook',

    // 执行详情页
    'run_detail.title': '执行详情',
    'run_detail.back_to_runs': '返回历史',
    'run_detail.overview': '运行概览',
    'run_detail.status': '状态',
    'run_detail.trigger': '触发方式',
    'run_detail.started_at': '开始时间',
    'run_detail.ended_at': '结束时间',
    'run_detail.duration': '耗时',
    'run_detail.output': '输出',
    'run_detail.error': '错误',
    'run_detail.nodes_timeline': '节点执行时间线',
    'run_detail.no_nodes': '暂无节点执行数据',
  },

  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.agents': 'Agents',
    'nav.sessions': 'Sessions',
    'nav.router': 'Router',
    'nav.dags': 'DAG Workflows',
    'nav.system_online': 'System Online',

    // Common
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.saving': 'Saving...',
    'common.run': 'Run',
    'common.running': 'Running...',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.success': 'Success',
    'common.failed': 'Failed',
    'common.error': 'Error',
    'common.unknown_error': 'Unknown error',
    'common.load_failed': 'Load failed',

    // DAG List
    'dags.title': 'DAG Workflows',
    'dags.subtitle': 'Create and manage multi-step AI workflows',
    'dags.create': '+ New DAG',
    'dags.empty': 'No DAGs created yet',
    'dags.create_first': 'Create your first DAG',
    'dags.col_name': 'Name',
    'dags.col_created': 'Created',
    'dags.col_action': 'Action',
    'dags.edit_link': 'Edit →',

    // DAG Editor
    'editor.name_placeholder': 'Enter DAG name...',
    'editor.add_node': '+ Add Node',
    'editor.add_condition': '+ Condition',
    'editor.add_delay': '+ Delay',
    'editor.save': 'Save',
    'editor.saving': 'Saving...',
    'editor.run': 'Run',
    'editor.running': 'Running...',
    'editor.run_result': 'Run Result',
    'editor.save_first': 'Please save the DAG first',
    'editor.enter_name': 'Please enter a DAG name',
    'editor.add_one_node': 'Please add at least one node',
    'editor.add_one_agent_node': 'Please configure at least one Agent node (with Agent and Prompt)',
    'editor.config_node': 'Please configure the Agent and Prompt for the node',
    'editor.save_success': 'Saved successfully',
    'editor.save_failed': 'Save failed',
    'editor.timeout': 'Execution timed out',

    // Node Panel
    'panel.node_config': 'Node Config',
    'panel.agent': 'Agent',
    'panel.agent_placeholder': 'Select Agent...',
    'panel.prompt': 'Prompt',
    'panel.prompt_placeholder': 'Enter prompt for the Agent...\n\nVariable substitution supported: {{node-1.output}}',
    'panel.node_id': 'Node ID',
    'panel.click_to_edit': 'Click a node on the canvas to edit',

    // Agent Node
    'node.unconfigured': 'No Agent',
    'node.click_to_edit': 'Click to edit Prompt',
    'node.condition_unconfigured': 'No condition',

    // Condition Node
    'condition.title': 'Condition',
    'condition.left': 'Left operand',
    'condition.operator': 'Operator',
    'condition.right': 'Right operand',
    'condition.op.eq': 'Equals',
    'condition.op.neq': 'Not equals',
    'condition.op.contains': 'Contains',
    'condition.op.not_contains': 'Not contains',
    'condition.op.empty': 'Is empty',
    'condition.op.not_empty': 'Is not empty',
    'condition.true_branch': 'True branch',
    'condition.false_branch': 'False branch',

    // Delay Node
    'delay.title': 'Delay',
    'delay.seconds': 'Delay (seconds)',
    'delay.hint': 'Range 0-3600 seconds (1 hour)',

    // Node execution status
    'node.status.pending': 'Pending',
    'node.status.running': 'Running',
    'node.status.completed': 'Completed',
    'node.status.failed': 'Failed',
    'node.status.skipped': 'Skipped',

    // Editor — History button
    'editor.run_history': 'History',

    // Run history list
    'runs.title': 'Run History',
    'runs.back_to_editor': 'Back to Editor',
    'runs.col_status': 'Status',
    'runs.col_trigger': 'Trigger',
    'runs.col_started': 'Started',
    'runs.col_duration': 'Duration',
    'runs.col_action': 'Action',
    'runs.detail_link': 'Detail →',
    'runs.load_more': 'Load More',
    'runs.empty': 'No runs yet',
    'runs.empty_hint': 'Run history will appear here after executing the DAG',
    'runs.trigger.manual': 'Manual',
    'runs.trigger.cron': 'Cron',
    'runs.trigger.webhook': 'Webhook',

    // Run detail page
    'run_detail.title': 'Run Detail',
    'run_detail.back_to_runs': 'Back to History',
    'run_detail.overview': 'Run Overview',
    'run_detail.status': 'Status',
    'run_detail.trigger': 'Trigger',
    'run_detail.started_at': 'Started At',
    'run_detail.ended_at': 'Ended At',
    'run_detail.duration': 'Duration',
    'run_detail.output': 'Output',
    'run_detail.error': 'Error',
    'run_detail.nodes_timeline': 'Node Execution Timeline',
    'run_detail.no_nodes': 'No node execution data',
  },
} as const;

export type TranslationKey = keyof typeof translations.zh;

export function getTranslations(lang: Lang) {
  return translations[lang];
}
