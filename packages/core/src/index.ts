export { configReader } from './config/index.js';
export { GatewayClient } from './gateway/index.js';
export { AgentDiscovery } from './agent/index.js';
export type { Session } from '@clawgate/shared';
export { loadYamlConfig, getYamlConfig, watchYamlConfig, generateDefaultConfig } from './yaml-config/index.js';
export type { ClawGateConfig } from './yaml-config/index.js';
export { initDb, getDb, schema } from './db/index.js';
export type { Db } from './db/index.js';
export {
  initRedis, getRedis, connectRedis, disconnectRedis,
  getBullMqRedis, disconnectBullMqRedis,
  setSessionState, getSessionState,
  incrCostRealtime, pushRoutingLog,
  REDIS_KEYS, REDIS_TTL,
} from './redis/index.js';
export {
  initQueue, getQueue, startArchiveWorker,
  scheduleArchiveJobs, stopQueue,
} from './queue/index.js';
export {
  startHealthCheckScheduler,
  startHealthCheckWorker,
  stopHealthCheck,
  triggerManualHealthCheck,
} from './queue/health-check.js';
export { RouterClient } from './router/index.js';
export {
  executeAgentNode,
  executeAgentNodesParallel,
} from './dag/gateway-executor.js';
export type {
  ExecuteNodeOptions,
  ExecuteNodeResult,
} from './dag/gateway-executor.js';
export {
  initDagQueue,
  getDagQueue,
  stopDagQueue,
  addDagCronJob,
  removeDagCronJob,
  updateDagCronJob,
} from './dag/queue.js';
export type { DagExecutionJob } from './dag/queue.js';
export {
  startDagWorker,
  stopDagWorker,
} from './dag/executor.js';

// OpenClaw 生命周期管理
export { OpenClawLifecycle } from './openclaw/lifecycle.js';
export type {
  LifecycleOptions,
  LifecycleResult,
  OpenClawStatus,
} from './openclaw/lifecycle.js';

// GatewayPool 多实例连接池（团队部署）
export {
  GatewayPool,
  getGatewayPool,
  resetGatewayPool,
} from './gateway/pool.js';
export type {
  SelectOptions,
  HealthResult,
} from './gateway/pool.js';
