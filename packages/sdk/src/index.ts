/**
 * @clawgate/sdk — Official Node.js SDK for ClawGate.
 *
 * Covers the personal scenario (route / stats / health / chat) and the team
 * operations scenario (instances, alerts, DAG automation). Zero runtime
 * dependencies — only the native `fetch` API.
 */

import { HttpClient } from './client.js';
import { RouteModule } from './modules/route.js';
import { InstancesModule } from './modules/instances.js';
import { AlertsModule } from './modules/alerts.js';
import { DagsModule } from './modules/dags.js';
import type {
  ClawGateOptions,
  ChatOptions,
  InstanceListFilter,
  AlertListFilter,
} from './types.js';
import type {
  RouteDecision,
  StatsOverview,
  HealthStatus,
  ChatMessage,
  ChatCompletion,
  ChatChunk,
  InstanceListResponse,
  InstanceLoad,
  AlertListResponse,
  DagRunTriggerResponse,
  DagRunDetail,
} from '@clawgate/shared';

export {
  ClawGateError,
  ClawGateAuthError,
  ClawGateBudgetError,
} from './errors.js';

export type {
  ClawGateOptions,
  ChatOptions,
  InstanceListFilter,
  AlertListFilter,
} from './types.js';

// Re-export shared response types so consumers need only one install.
export type {
  RouteDecision,
  StatsOverview,
  HealthStatus,
  ChatMessage,
  ChatCompletion,
  ChatChunk,
  Alert,
  AlertSeverity,
  AlertType,
  AlertListResponse,
  Instance,
  InstanceStatus,
  InstanceEnvironment,
  InstanceListResponse,
  InstanceLoad,
  DagRunStatus,
  DagNodeStatus,
  DagNodeState,
  DagRunDetail,
  DagRunTriggerResponse,
} from '@clawgate/shared';

/**
 * Main SDK entry point. Construct once per process / service, reuse for all calls.
 *
 * ```ts
 * const gate = new ClawGate({ baseUrl: 'http://localhost:3000' });
 * const decision = await gate.route('write a sort algorithm');
 * ```
 */
export class ClawGate {
  private readonly http: HttpClient;

  private readonly routes: RouteModule;
  private readonly instancesModule: InstancesModule;
  private readonly alertsModule: AlertsModule;
  private readonly dagsModule: DagsModule;

  constructor(opts: ClawGateOptions) {
    this.http = new HttpClient(opts);
    this.routes = new RouteModule(this.http);
    this.instancesModule = new InstancesModule(this.http);
    this.alertsModule = new AlertsModule(this.http);
    this.dagsModule = new DagsModule(this.http);
  }

  // ── 个人场景（4 方法）─────────────────────────────────────
  route(prompt: string, sessionKey?: string): Promise<RouteDecision> {
    return this.routes.route(prompt, sessionKey);
  }

  stats(): Promise<StatsOverview> {
    return this.routes.stats();
  }

  health(): Promise<HealthStatus> {
    return this.routes.health();
  }

  chat(messages: ChatMessage[], opts?: ChatOptions & { stream?: false }): Promise<ChatCompletion>;
  chat(messages: ChatMessage[], opts: ChatOptions & { stream: true }): Promise<AsyncIterable<ChatChunk>>;
  chat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): Promise<ChatCompletion | AsyncIterable<ChatChunk>> {
    // Route via the overload-preserving wrapper.
    if (opts.stream) {
      return this.routes.chat(messages, { ...opts, stream: true });
    }
    return this.routes.chat(messages, { ...opts, stream: false });
  }

  // ── 团队场景（7 方法）─────────────────────────────────────
  listInstances(filter?: InstanceListFilter): Promise<InstanceListResponse> {
    return this.instancesModule.list(filter);
  }

  getInstanceLoad(id: string): Promise<InstanceLoad> {
    return this.instancesModule.getLoad(id);
  }

  listAlerts(filter?: AlertListFilter): Promise<AlertListResponse> {
    return this.alertsModule.list(filter);
  }

  ackAlert(id: string): Promise<{ success: boolean; message: string }> {
    return this.alertsModule.ack(id);
  }

  triggerDag(dagId: string): Promise<DagRunTriggerResponse> {
    return this.dagsModule.trigger(dagId);
  }

  getDagRun(runId: string): Promise<DagRunDetail> {
    return this.dagsModule.getRun(runId);
  }

  triggerWebhook(dagId: string, token: string): Promise<DagRunTriggerResponse> {
    return this.dagsModule.triggerWebhook(dagId, token);
  }
}
