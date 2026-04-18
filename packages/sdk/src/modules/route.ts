import type {
  RouteDecision,
  StatsOverview,
  HealthStatus,
  ChatMessage,
  ChatCompletion,
  ChatChunk,
} from '@clawgate/shared';
import type { HttpClient } from '../client.js';
import type { ChatOptions } from '../types.js';
import { parseSseStream } from '../stream.js';
import { ClawGateError } from '../errors.js';

/** Raw server response for POST /api/route — uses snake_case per API contract. */
interface RouteResponseRaw {
  model: string;
  provider: string;
  layer: string;
  cacheHit?: boolean;
  cache_hit?: boolean;
  latencyMs?: number;
  latency_ms?: number;
}

export class RouteModule {
  constructor(private readonly http: HttpClient) {}

  /**
   * Request a routing decision for a prompt without actually invoking the model.
   * Useful for cost-gated paths or debugging the L1/L2/L3 split.
   */
  async route(prompt: string, sessionKey?: string): Promise<RouteDecision> {
    if (!prompt) throw new ClawGateError('prompt is required');
    const raw = await this.http.request<RouteResponseRaw>('POST', '/api/route', {
      prompt,
      session_key: sessionKey,
    });
    return {
      model: raw.model,
      provider: raw.provider,
      layer: raw.layer as RouteDecision['layer'],
      cacheHit: raw.cacheHit ?? raw.cache_hit ?? false,
      latencyMs: raw.latencyMs ?? raw.latency_ms ?? 0,
    };
  }

  /** Global stats overview (routing hit rates, costs, trend, circuit breakers). */
  async stats(): Promise<StatsOverview> {
    return this.http.request<StatsOverview>('GET', '/api/stats/overview');
  }

  /** Health probe, including OpenClaw connection status. */
  async health(): Promise<HealthStatus> {
    return this.http.request<HealthStatus>('GET', '/api/health');
  }

  /**
   * OpenAI-compatible chat completion. Set `opts.stream = true` to receive
   * an `AsyncIterable<ChatChunk>` of SSE chunks.
   */
  async chat(messages: ChatMessage[], opts?: ChatOptions & { stream?: false }): Promise<ChatCompletion>;
  async chat(messages: ChatMessage[], opts: ChatOptions & { stream: true }): Promise<AsyncIterable<ChatChunk>>;
  async chat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): Promise<ChatCompletion | AsyncIterable<ChatChunk>> {
    if (!messages?.length) throw new ClawGateError('messages must be a non-empty array');

    const body = {
      messages,
      model: opts.model,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
      stream: !!opts.stream,
    };

    if (!opts.stream) {
      return this.http.request<ChatCompletion>('POST', '/v1/chat/completions', body);
    }

    const raw = await this.http.rawRequest('POST', '/v1/chat/completions', body, {
      noTimeout: true,
      headers: { Accept: 'text/event-stream' },
    });
    if (!raw.body.ok) {
      const text = await raw.body.text();
      throw new ClawGateError(text || `HTTP ${raw.status}`, { status: raw.status });
    }
    return parseSseStream(raw.body);
  }
}
