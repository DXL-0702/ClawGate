import { describe, it, expect, vi } from 'vitest';
import { ClawGate, ClawGateAuthError, ClawGateBudgetError, ClawGateError } from '../src/index.js';

function mockFetch(
  impl: (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string },
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = impl(String(input), init ?? {});
    const status = r.status ?? 200;
    const body = r.text !== undefined ? r.text : JSON.stringify(r.body ?? {});
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('HttpClient headers + errors', () => {
  it('injects Content-Type on every request', async () => {
    let receivedHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      receivedHeaders = (init.headers ?? {}) as Record<string, string>;
      return { body: { status: 'ok', timestamp: '', openclaw: { connected: false, mode: 'standalone' } } };
    });
    const gate = new ClawGate({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });
    await gate.health();
    expect(receivedHeaders['Content-Type']).toBe('application/json');
  });

  it('does NOT send X-API-Key when apiKey is unset (personal mode)', async () => {
    let received: Record<string, string> = {};
    const fetchImpl = mockFetch((_u, init) => {
      received = (init.headers ?? {}) as Record<string, string>;
      return { body: { status: 'ok', timestamp: '', openclaw: { connected: false, mode: 'standalone' } } };
    });
    const gate = new ClawGate({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });
    await gate.health();
    expect(received['X-API-Key']).toBeUndefined();
  });

  it('maps 401 to ClawGateAuthError', async () => {
    const fetchImpl = mockFetch(() => ({ status: 401, body: { error: 'Invalid API key' } }));
    const gate = new ClawGate({ baseUrl: 'http://x', apiKey: 'bad', fetch: fetchImpl });
    await expect(gate.listAlerts()).rejects.toBeInstanceOf(ClawGateAuthError);
  });

  it('maps 429 daily_budget_exceeded to ClawGateBudgetError', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 429,
      body: { error: 'daily_budget_exceeded', spent_usd: 5.1, limit_usd: 5.0 },
    }));
    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    try {
      await gate.chat([{ role: 'user', content: 'hi' }]);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClawGateBudgetError);
      expect((err as ClawGateBudgetError).spentUsd).toBe(5.1);
      expect((err as ClawGateBudgetError).limitUsd).toBe(5.0);
    }
  });

  it('maps generic 5xx to ClawGateError', async () => {
    const fetchImpl = mockFetch(() => ({ status: 503, body: { error: 'all providers unavailable' } }));
    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    await expect(gate.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(ClawGateError);
  });

  it('throws if baseUrl missing', () => {
    expect(() => new ClawGate({ baseUrl: '' })).toThrow(ClawGateError);
  });
});
