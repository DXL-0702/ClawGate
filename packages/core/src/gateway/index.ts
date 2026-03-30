import WebSocket from 'ws';
import type { Session } from '@clawgate/shared';

interface GatewayClientOptions {
  url: string;
  token: string;
  reconnectIntervalMs?: number;
}

interface RpcResponse {
  id: string;
  result?: unknown;
  error?: { message: string };
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (res: RpcResponse) => void>();
  private msgId = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private readonly reconnectIntervalMs: number;
  private eventListeners = new Map<string, Array<(data: unknown) => void>>();

  constructor(private readonly opts: GatewayClientOptions) {
    this.reconnectIntervalMs = opts.reconnectIntervalMs ?? 3000;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    return this._connect();
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      });
      ws.once('open', () => {
        this.ws = ws;
        resolve();
      });
      ws.once('error', (err) => {
        if (!this.ws) reject(err);
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as RpcResponse & { event?: string; data?: unknown };
        // RPC 响应
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
        // 服务端推送事件
        if (msg.event) {
          const listeners = this.eventListeners.get(msg.event) ?? [];
          for (const fn of listeners) fn(msg.data);
        }
      });
      ws.on('close', () => {
        this.ws = null;
        // reject 所有等待中的 RPC，避免泄漏
        for (const [id, resolve] of this.pending) {
          resolve({ id, error: { message: 'Gateway disconnected' } });
        }
        this.pending.clear();
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this._connect().catch(() => {});
          }, this.reconnectIntervalMs);
        }
      });
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  onEvent(event: string, listener: (data: unknown) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
    return () => {
      const listeners = this.eventListeners.get(event) ?? [];
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  private call<T>(method: string, params?: unknown, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('Gateway not connected'));
      const id = String(++this.msgId);

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, (res) => {
        clearTimeout(timer);
        if (res.error) reject(new Error(res.error.message));
        else resolve(res.result as T);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async listSessions(agentId?: string): Promise<Session[]> {
    try {
      return await this.call<Session[]>('sessions.list', { agentId });
    } catch {
      return [];
    }
  }

  async createSession(agentId: string): Promise<Session> {
    return this.call<Session>('sessions.create', { agentId });
  }

  async abortSession(sessionKey: string): Promise<void> {
    await this.call('sessions.abort', { key: sessionKey });
  }

  async sendMessage(sessionKey: string, content: string): Promise<void> {
    await this.call('sessions.send', { key: sessionKey, content });
  }

  async listAgents(): Promise<unknown[]> {
    try {
      return await this.call<unknown[]>('agents.list');
    } catch {
      return [];
    }
  }
}
