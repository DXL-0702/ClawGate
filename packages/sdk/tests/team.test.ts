import { describe, it, expect, vi } from 'vitest';
import { ClawGate, ClawGateAuthError } from '../src/index.js';

describe('team scenario — apiKey injection & guards', () => {
  it('listAlerts() without apiKey throws ClawGateAuthError synchronously', async () => {
    const gate = new ClawGate({ baseUrl: 'http://x' });
    await expect(gate.listAlerts()).rejects.toBeInstanceOf(ClawGateAuthError);
  });

  it('listAlerts() with apiKey injects X-API-Key header', async () => {
    let received: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      received = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ alerts: [], unacknowledgedCount: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', apiKey: 'key-123', fetch: fetchImpl });
    await gate.listAlerts({ acknowledged: false, severity: 'critical', limit: 10 });

    expect(received['X-API-Key']).toBe('key-123');
    const url = String((fetchImpl as unknown as { mock: { calls: [RequestInfo][] } }).mock.calls[0][0]);
    expect(url).toContain('acknowledged=false');
    expect(url).toContain('severity=critical');
    expect(url).toContain('limit=10');
  });

  it('listInstances() with filters builds query string', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ instances: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', apiKey: 'k', fetch: fetchImpl });
    await gate.listInstances({ environment: 'production', tag: 'ci' });
    expect(calls[0]).toContain('environment=production');
    expect(calls[0]).toContain('tag=ci');
  });

  it('ackAlert() posts to correct path with apiKey', async () => {
    let method = '';
    let path = '';
    let hdr: Record<string, string> = {};
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      path = String(url);
      method = init?.method ?? 'GET';
      hdr = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ success: true, message: 'ok' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', apiKey: 'k', fetch: fetchImpl });
    const res = await gate.ackAlert('alert-1');
    expect(method).toBe('POST');
    expect(path).toBe('http://x/api/alerts/alert-1/ack');
    expect(hdr['X-API-Key']).toBe('k');
    expect(res.success).toBe(true);
  });

  it('triggerDag + getDagRun chain', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.endsWith('/run')) {
        return new Response(JSON.stringify({ runId: 'run-9', status: 'pending' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        id: 'run-9', dagId: 'd', status: 'completed', triggeredBy: 'manual',
        output: 'ok', error: null, startedAt: null, endedAt: null,
        createdAt: '', duration: null, nodes: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;

    const gate = new ClawGate({ baseUrl: 'http://x', apiKey: 'k', fetch: fetchImpl });
    const { runId } = await gate.triggerDag('d');
    const detail = await gate.getDagRun(runId);
    expect(detail.id).toBe('run-9');
    expect(detail.status).toBe('completed');
  });

  it('triggerWebhook() does NOT require apiKey (uses token query param)', async () => {
    let received: Record<string, string> = {};
    let url = '';
    const fetchImpl = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      url = String(u);
      received = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ runId: 'r1', status: 'pending' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // No apiKey configured.
    const gate = new ClawGate({ baseUrl: 'http://x', fetch: fetchImpl });
    const res = await gate.triggerWebhook('dag-1', 'secret-token');
    expect(res.runId).toBe('r1');
    expect(received['X-API-Key']).toBeUndefined();
    expect(url).toContain('token=secret-token');
  });
});
