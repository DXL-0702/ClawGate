import type { DagRunDetail, DagRunTriggerResponse } from '@clawgate/shared';
import type { HttpClient } from '../client.js';
import { ClawGateError } from '../errors.js';

export class DagsModule {
  constructor(private readonly http: HttpClient) {}

  /** Manually trigger a DAG run. Requires apiKey in team mode. */
  async trigger(dagId: string): Promise<DagRunTriggerResponse> {
    if (!dagId) throw new ClawGateError('dagId is required');
    return this.http.request<DagRunTriggerResponse>(
      'POST',
      `/api/dags/${encodeURIComponent(dagId)}/run`,
      {},
      { requireApiKey: true },
    );
  }

  /** Fetch a DAG run detail (status + per-node states). */
  async getRun(runId: string): Promise<DagRunDetail> {
    if (!runId) throw new ClawGateError('runId is required');
    return this.http.request<DagRunDetail>('GET', `/api/dag-runs/${encodeURIComponent(runId)}`, undefined, {
      requireApiKey: true,
    });
  }

  /**
   * Trigger a DAG via its pre-shared webhook token. This endpoint authenticates
   * via the token query parameter (not X-API-Key), so it is safe to call from
   * environments that do not possess the team apiKey.
   */
  async triggerWebhook(dagId: string, token: string): Promise<DagRunTriggerResponse> {
    if (!dagId) throw new ClawGateError('dagId is required');
    if (!token) throw new ClawGateError('webhook token is required');
    return this.http.request<DagRunTriggerResponse>(
      'POST',
      `/api/dags/${encodeURIComponent(dagId)}/webhook?token=${encodeURIComponent(token)}`,
      {},
    );
  }
}
