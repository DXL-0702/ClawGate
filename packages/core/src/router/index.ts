import axios, { AxiosInstance } from 'axios';
import type { RouteDecision } from '@clawgate/shared';

interface RouterRouteResponse {
  model: string;
  provider: string;
  layer: string;
  cache_hit: boolean;
  latency_ms: number;
}

interface RouterStatsResponse {
  total: number;
  cache_hits: number;
  hit_rate: number;
}

export class RouterClient {
  private http: AxiosInstance;
  private readonly fallbackModel: string;
  private readonly fallbackProvider: string;

  constructor(
    baseUrl = 'http://127.0.0.1:3001',
    fallbackModel = 'claude-sonnet-4-6',
    fallbackProvider = 'anthropic',
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
    this.fallbackModel = fallbackModel;
    this.fallbackProvider = fallbackProvider;
  }

  async route(
    prompt: string,
    sessionKey?: string,
  ): Promise<RouteDecision> {
    try {
      const { data } = await this.http.post<RouterRouteResponse>('/route', {
        prompt,
        session_key: sessionKey,
      });
      return {
        model: data.model,
        provider: data.provider,
        layer: data.layer as RouteDecision['layer'],
        cacheHit: data.cache_hit,
        latencyMs: data.latency_ms,
      };
    } catch {
      // Router 不可用时 fallback 到默认模型
      return {
        model: this.fallbackModel,
        provider: this.fallbackProvider,
        layer: 'L1',
        cacheHit: false,
        latencyMs: 0,
      };
    }
  }

  async stats(): Promise<RouterStatsResponse | null> {
    try {
      const { data } = await this.http.get<RouterStatsResponse>('/stats');
      return data;
    } catch {
      return null;
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.http.get('/health');
      return true;
    } catch {
      return false;
    }
  }

  async circuitStatus(): Promise<Record<string, {
    state: 'Closed' | 'Open' | 'HalfOpen';
    allowed: boolean;
    failure_count: number;
  }> | null> {
    try {
      const { data } = await this.http.get<{
        circuits: Record<string, { state: string; allowed: boolean; failure_count: number }>;
      }>('/circuit/status');
      return data.circuits as Record<string, {
        state: 'Closed' | 'Open' | 'HalfOpen';
        allowed: boolean;
        failure_count: number;
      }>;
    } catch {
      return null;
    }
  }

  async reportOutcome(provider: string, success: boolean): Promise<void> {
    try {
      await this.http.post('/circuit/report', { provider, success });
    } catch {
      // silent degradation — Rust service unavailable
    }
  }
}
