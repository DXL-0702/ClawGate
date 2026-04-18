import type { AlertListResponse } from '@clawgate/shared';
import type { HttpClient } from '../client.js';
import type { AlertListFilter } from '../types.js';
import { ClawGateError } from '../errors.js';

export class AlertsModule {
  constructor(private readonly http: HttpClient) {}

  async list(filter: AlertListFilter = {}): Promise<AlertListResponse> {
    const qs = new URLSearchParams();
    if (filter.acknowledged !== undefined) qs.set('acknowledged', String(filter.acknowledged));
    if (filter.severity) qs.set('severity', filter.severity);
    if (filter.type) qs.set('type', filter.type);
    if (filter.limit !== undefined) qs.set('limit', String(filter.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.http.request<AlertListResponse>('GET', `/api/alerts${suffix}`, undefined, {
      requireApiKey: true,
    });
  }

  async ack(id: string): Promise<{ success: boolean; message: string }> {
    if (!id) throw new ClawGateError('alert id is required');
    return this.http.request<{ success: boolean; message: string }>(
      'POST',
      `/api/alerts/${encodeURIComponent(id)}/ack`,
      {},
      { requireApiKey: true },
    );
  }
}
