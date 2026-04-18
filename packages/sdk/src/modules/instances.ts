import type { InstanceListResponse, InstanceLoad } from '@clawgate/shared';
import type { HttpClient } from '../client.js';
import type { InstanceListFilter } from '../types.js';
import { ClawGateError } from '../errors.js';

export class InstancesModule {
  constructor(private readonly http: HttpClient) {}

  async list(filter: InstanceListFilter = {}): Promise<InstanceListResponse> {
    const qs = new URLSearchParams();
    if (filter.environment) qs.set('environment', filter.environment);
    if (filter.tag) qs.set('tag', filter.tag);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.http.request<InstanceListResponse>('GET', `/api/instances${suffix}`, undefined, {
      requireApiKey: true,
    });
  }

  async getLoad(id: string): Promise<InstanceLoad> {
    if (!id) throw new ClawGateError('instance id is required');
    return this.http.request<InstanceLoad>('GET', `/api/instances/${encodeURIComponent(id)}/load`, undefined, {
      requireApiKey: true,
    });
  }
}
