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
  /** RPC 层 operator token（来自 device-auth.json），用于 connect RPC 的 auth.token */
  operatorToken?: string;
  defaultModel: string;
  agentsDir: string;
}
