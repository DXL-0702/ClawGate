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
    'editor.save': '保存',
    'editor.saving': '保存中...',
    'editor.run': '运行',
    'editor.running': '运行中...',
    'editor.run_result': '运行结果',
    'editor.save_first': '请先保存 DAG',
    'editor.enter_name': '请输入 DAG 名称',
    'editor.add_one_node': '请至少添加一个节点',
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

    // 节点执行状态
    'node.status.pending': '等待中',
    'node.status.running': '执行中',
    'node.status.completed': '已完成',
    'node.status.failed': '失败',
    'node.status.skipped': '已跳过',
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
    'editor.save': 'Save',
    'editor.saving': 'Saving...',
    'editor.run': 'Run',
    'editor.running': 'Running...',
    'editor.run_result': 'Run Result',
    'editor.save_first': 'Please save the DAG first',
    'editor.enter_name': 'Please enter a DAG name',
    'editor.add_one_node': 'Please add at least one node',
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

    // Node execution status
    'node.status.pending': 'Pending',
    'node.status.running': 'Running',
    'node.status.completed': 'Completed',
    'node.status.failed': 'Failed',
    'node.status.skipped': 'Skipped',
  },
} as const;

export type TranslationKey = keyof typeof translations.zh;

export function getTranslations(lang: Lang) {
  return translations[lang];
}
