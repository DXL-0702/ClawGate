import WebSocket from 'ws';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Session } from '@clawgate/shared';

// Ed25519 SPKI 前缀（用于从 SubjectPublicKeyInfo DER 格式提取原始公钥）
const ED25519_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

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

interface ChallengePayload {
  nonce: string;
  ts: number;
}

interface DeviceKey {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/** base64url 编码（URL-safe base64） */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** 从 ~/.openclaw/identity/device.json 读取设备密钥 */
function loadDeviceKey(): DeviceKey | null {
  const home = process.env['HOME'] ?? '/root';
  const path = join(normalize(home), '.openclaw', 'identity', 'device.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as DeviceKey;
    if (!parsed.privateKeyPem || !parsed.publicKeyPem || !parsed.deviceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (res: RpcResponse) => void>();
  private msgId = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private readonly reconnectIntervalMs: number;
  private eventListeners = new Map<string, Array<(data: unknown) => void>>();
  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;
  private deviceId: string | null = null;

  constructor(private readonly opts: GatewayClientOptions) {
    this.reconnectIntervalMs = opts.reconnectIntervalMs ?? 3000;
    const key = loadDeviceKey();
    if (key) {
      this.privateKeyPem = key.privateKeyPem;
      this.publicKeyPem = key.publicKeyPem;
      this.deviceId = key.deviceId;
    }
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

      // challenge-response 握手状态机
      let challengeResolve: ((value: void) => void) | null = null;
      let challengeReject: ((err: Error) => void) | null = null;
      const challengePromise = new Promise<void>((res, rej) => {
        challengeResolve = res;
        challengeReject = rej;
      });
      // 防止 close 事件触发的 reject 产生 unhandled rejection
      challengePromise.catch(() => {});

      // 处理消息
      const handleMessage = (raw: Buffer | string) => {
        const rawStr = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(rawStr) as RpcResponse & { event?: string; data?: unknown; type?: string; payload?: ChallengePayload };

        // challenge 事件（数据在 payload 字段）
        if (msg.event === 'connect.challenge') {
          const payload = msg.payload ?? (msg.data as ChallengePayload);
          this._handleChallenge(payload)
            .then(() => {
              console.log('[GatewayClient] challenge responded, waiting for connect.success...');
            })
            .catch((err) => challengeReject?.(err));
          return;
        }

        // connect.success 确认：认证完成，可放行
        if (msg.event === 'connect.success') {
          challengeResolve?.();
          return;
        }

        // RPC 响应
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }

        // 透传其他事件
        if (msg.event) {
          const listeners = this.eventListeners.get(msg.event) ?? [];
          for (const fn of listeners) fn(msg.data);
        }
      };

      ws.once('open', async () => {
        this.ws = ws;
        // 等待 challenge-response → connect.success 完成（若有设备密钥）
        if (this.privateKeyPem) {
          try {
            await Promise.race([
              challengePromise,
              new Promise<void>((_, rej) => setTimeout(() => rej(new Error('Challenge timeout (5s)')), 5000)),
            ]);
          } catch (err) {
            this.ws = null;
            ws.close();
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
        }
        resolve();
      });

      ws.once('error', (err) => {
        if (!this.ws) reject(err);
      });

      ws.on('message', handleMessage);

      ws.on('close', () => {
        this.ws = null;
        for (const [id, res] of this.pending) {
          res({ id, error: { message: 'Gateway disconnected' } });
        }
        this.pending.clear();
        // 仅当连接仍在等待 challenge 完成时才 reject（否则 Promise 已被消费）
        const reject = challengeReject;
        challengeReject = null;
        try { reject?.(new Error('Gateway disconnected')); } catch { /* already settled */ }
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this._connect().catch(() => {});
          }, this.reconnectIntervalMs);
        }
      });
    });
  }

  /** 处理 challenge：构造完整 connect 消息（完全符合 OpenClaw SDK 协议） */
  private async _handleChallenge(payload: ChallengePayload): Promise<void> {
    if (!this.ws || !this.privateKeyPem || !this.publicKeyPem || !this.deviceId) {
      throw new Error('Device key not loaded, cannot respond to challenge');
    }

    // 从 PEM 提取原始公钥字节
    const pemBody = this.publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const publicKeyDer = Buffer.from(pemBody, 'base64');

    // 提取 32 字节 Ed25519 原始公钥
    const pubKeyObj = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyDer]),
      format: 'der',
      type: 'spki',
    });
    const rawPublicKey = pubKeyObj.export({ format: 'der', type: 'spki' }).slice(ED25519_SPKI_PREFIX.length);

    // 构建签名 payload（严格符合 OpenClaw SDK buildDeviceAuthPayloadV3 格式）
    const scopes = 'sessions,agents,gateway';
    const clientId = 'clawgate';
    const clientMode = 'backend';
    const role = 'operator';
    const signedAtMs = Date.now();
    const platform = process.platform ?? 'darwin';
    const deviceFamily = platform;
    const token = this.opts.token;

    const authPayload = [
      'v3',
      this.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      String(signedAtMs),
      token,
      payload.nonce,
      platform,
      deviceFamily,
    ].join('|');

    // Ed25519 签名
    const privateKey = createPrivateKey(this.privateKeyPem);
    const signature = cryptoSign(null, Buffer.from(authPayload, 'utf8'), privateKey);
    const signatureB64Url = base64url(signature);

    // 完整 connect 消息（严格符合 OpenClaw SDK 实现）
    const connectMsg = {
      type: 'connect',
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '0.5.0',
        platform,
        deviceFamily,
        mode: clientMode,
      },
      caps: [] as string[],
      auth: { token },
      role,
      scopes,
      device: {
        id: this.deviceId,
        publicKey: base64url(rawPublicKey),
        signature: signatureB64Url,
        signedAt: signedAtMs,
        nonce: payload.nonce,
      },
    };

    this.ws.send(JSON.stringify(connectMsg));
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

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
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
