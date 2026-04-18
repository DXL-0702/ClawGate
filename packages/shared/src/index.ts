export type AgentStatus = 'running' | 'stopped' | 'unknown';

export interface Agent {
  id: string;
  name: string;
  configPath: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  key: string;       // agentId:sessionId
  agentId: string;
  sessionId: string;
  status: 'active' | 'ended' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface AgentListResponse {
  agents: Agent[];
  total: number;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface RouteDecision {
  model: string;
  provider: string;
  layer: 'L1' | 'L2' | 'L3';
  cacheHit: boolean;
  latencyMs: number;
}

export interface OpenClawConfig {
  gatewayUrl: string;
  gatewayToken: string;
  defaultModel: string;
  agentsDir: string;
}

// ── SDK 共享类型（Phase 4，供 @clawgate/sdk 与 server 复用） ─────

export interface StatsOverview {
  routing: {
    total: number;
    by_layer: Record<string, number>;
    layer_pct: Record<string, number>;
    avg_latency_ms: number;
  };
  costs: {
    today_usd: number;
    budget_limit_usd: number;
    budget_used_pct: number;
    by_model: Record<string, { tokens: number; usd: number }>;
  };
  trend: { dates: string[]; usd: number[] };
  circuit: Record<string, { state: string; allowed: boolean }> | null;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  openclaw: {
    connected: boolean;
    mode: 'integrated' | 'standalone';
  };
}

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertType = 'offline' | 'error' | 'high_load' | 'gateway_unhealthy';

export interface Alert {
  id: string;
  instanceId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface AlertListResponse {
  alerts: Alert[];
  unacknowledgedCount: number;
}

export type InstanceStatus = 'online' | 'offline' | 'error';
export type InstanceEnvironment = 'development' | 'staging' | 'production';

export interface Instance {
  id: string;
  name: string;
  environment: InstanceEnvironment;
  tags?: string[];
  status: InstanceStatus;
  version: string | null;
  platform: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
}

export interface InstanceListResponse {
  instances: Instance[];
}

export interface InstanceLoad {
  instanceId: string;
  activeSessions: number;
  queuedTasks: number;
  cpuUsage: number;
  memoryUsage: number;
  gatewayHealthy: boolean;
  timestamp: string;
}

export type DagRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type DagNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DagRunTriggerResponse {
  runId: string;
  status: DagRunStatus;
}

export interface DagNodeState {
  nodeId: string;
  status: DagNodeStatus;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface DagRunDetail {
  id: string;
  dagId: string;
  status: DagRunStatus;
  triggeredBy: string;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  duration: number | null;
  nodes: DagNodeState[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'error';
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: 'stop' | 'length' | null;
  }[];
}
