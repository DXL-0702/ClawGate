import { describe, it, expect, vi } from 'vitest';
import { ClawGate } from '../src/index.js';

describe('personal scenario — route / chat', () => {
  it('route() converts snake_case payload to camelCase', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        model: 'qwen2.5:7b',
        provider: 'ollama',
        layer: 'L1',
        cache_hit: true,
        latency_ms: 2,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    const decision = await gate.route('hello');
    expect(decision).toEqual({
      model: 'qwen2.5:7b',
      provider: 'ollama',
      layer: 'L1',
      cacheHit: true,
      latencyMs: 2,
    });
  });

  it('route() rejects empty prompt', async () => {
    const gate = new ClawGate({ baseUrl: 'http://x', fetch: (async () => new Response('{}')) as unknown as typeof fetch });
    await expect(gate.route('')).rejects.toThrow(/prompt is required/);
  });

  it('chat() non-streaming returns ChatCompletion', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        id: 'cc-1',
        object: 'chat.completion',
        created: 1,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    const res = await gate.chat([{ role: 'user', content: 'hi' }]);
    expect(res.choices[0].message.content).toBe('hi');
  });

  it('chat(stream:true) yields ChatChunk via AsyncIterable', async () => {
    const sse = [
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
      'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');

    const fetchImpl = vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    const stream = await gate.chat([{ role: 'user', content: 'hi' }], { stream: true });

    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.content).toBe('hello');
    expect(chunks[1].choices[0].finish_reason).toBe('stop');
  });

  it('stats() returns overview payload transparently', async () => {
    const payload = {
      routing: { total: 10, by_layer: { L1: 7, L2: 2, L3: 1 }, layer_pct: { L1: 70, L2: 20, L3: 10 }, avg_latency_ms: 5 },
      costs: { today_usd: 0.1, budget_limit_usd: 5, budget_used_pct: 2, by_model: {} },
      trend: { dates: [], usd: [] },
      circuit: null,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    const res = await gate.stats();
    expect(res.routing.total).toBe(10);
    expect(res.costs.today_usd).toBe(0.1);
  });
});
