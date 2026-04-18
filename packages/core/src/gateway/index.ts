import WebSocket from 'ws';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Session } from '@clawgate/shared';

interface GatewayClientOptions {
  url: string;
  token: string;
  reconnectIntervalMs?: number;
  /** 认证模式：'token' | 'challenge' | 'auto'（默认 auto：有 device key 时用 challenge，否则 token） */
  authMode?: 'token' | 'challenge' | 'auto';
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
  private readonly authMode: 'token' | 'challenge' | 'auto';
  private eventListeners = new Map<string, Array<(data: unknown) => void>>();
  private privateKeyPem: string | null = null;
  private publicKeyPem: string | null = null;
  private deviceId: string | null = null;

  constructor(private readonly opts: GatewayClientOptions) {
    this.reconnectIntervalMs = opts.reconnectIntervalMs ?? 3000;
    // 优先级：构造参数 > 环境变量 GATEWAY_AUTH_MODE > 默认值 'auto'
    this.authMode = opts.authMode ?? (process.env['GATEWAY_AUTH_MODE'] as 'token' | 'challenge' | 'auto') ?? 'auto';
    const key = loadDeviceKey();
    if (key) {
      this.privateKeyPem = key.privateKeyPem;
      this.publicKeyPem = key.publicKeyPem;
      this.deviceId = key.deviceId;
    }
  }

  /** 判断是否使用 Challenge-Response 模式 */
  private useChallengeMode(): boolean {
    if (this.authMode === 'challenge') return true;
    if (this.authMode === 'token') return false;
    // auto 模式：有 device key 且私钥存在时用 challenge
    return !!this.privateKeyPem;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    return this._connect();
  }

  private _connect(): Promise<void> {
    // 重连时重新尝试加载设备密钥（首次加载失败，文件后来可能出现）
    if (!this.privateKeyPem) {
      const key = loadDeviceKey();
      if (key) {
        this.privateKeyPem = key.privateKeyPem;
        this.publicKeyPem = key.publicKeyPem;
        this.deviceId = key.deviceId;
        console.log('[GatewayClient] device key loaded on reconnect');
      }
    }

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

      // 标记是否已完成认证（解决无 device key 时 challenge 干扰）
      let authCompleted = false;

      // 处理消息
      const handleMessage = (raw: Buffer | string) => {
        const rawStr = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(rawStr) as RpcResponse & { event?: string; data?: unknown; type?: string; payload?: ChallengePayload };

        // challenge 事件：有 device key 时响应，无则忽略
        if (msg.event === 'connect.challenge') {
          if (!this.privateKeyPem) {
            console.log('[GatewayClient] Ignoring challenge (no device key, token-only mode)');
            return;
          }
          const payload = msg.payload ?? (msg.data as ChallengePayload);
          this._handleChallenge(payload)
            .then(() => {
              console.log('[GatewayClient] challenge responded, waiting for connect.success...');
            })
            .catch((err) => {
              console.error('[GatewayClient] challenge handling failed:', err);
              challengeReject?.(err instanceof Error ? err : new Error(String(err)));
              ws.close();
            });
          return;
        }

        // connect.success：认证完成
        if (msg.event === 'connect.success') {
          authCompleted = true;
          challengeResolve?.();
          console.log('[GatewayClient] Gateway authentication successful');
          return;
        }

        // connect.failed / connect.error：认证失败
        if (msg.event === 'connect.failed' || msg.event === 'connect.error') {
          const errorMsg = (msg.data as { message?: string })?.message ?? 'Authentication failed';
          console.error(`[GatewayClient] ${msg.event}: ${errorMsg}`);
          challengeReject?.(new Error(`${msg.event}: ${errorMsg}`));
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
        const useChallenge = this.useChallengeMode();

        if (useChallenge) {
          // Challenge-Response 模式（生产环境推荐）
          console.log('[GatewayClient] Using challenge-response mode');
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
        } else {
          // Token-Only 模式（开发环境，快速接入）
          console.log('[GatewayClient] Using token-only mode (set GATEWAY_AUTH_MODE=challenge to enable device auth)');
          // 发送简单的 connect 消息（不包含 device 签名）
          const connectMsg = {
            type: 'connect',
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: 'clawgate', version: '0.5.0' },
            auth: { token: this.opts.token },
          };
          this.ws.send(JSON.stringify(connectMsg));
          // 等待短暂时间让 Gateway 处理
          await new Promise(r => setTimeout(r, 500));
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

    // 从 PEM 直接创建公钥对象（Node.js 自动解析 SPKI 格式）
    const pubKeyObj = createPublicKey(this.publicKeyPem);
    // 导出为 JWK 格式获取裸公钥（x 字段是 base64url 编码的 32 字节公钥）
    const jwk = pubKeyObj.export({ format: 'jwk' });
    const rawPublicKey = Buffer.from(jwk.x as string, 'base64url');

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
