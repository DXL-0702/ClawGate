import WebSocket from 'ws';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Session } from '@clawgate/shared';

interface GatewayClientOptions {
  url: string;
  token: string;
  /** RPC 层 operator token（来自 device-auth.json），优先用于 connect RPC 的 auth.token */
  operatorToken?: string;
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

  /** 判断是否使用 Challenge-Response（即是否附带 device 签名） */
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

      // 握手是否已完成（防止 close 事件重复 reject）
      let handshakeDone = false;

      // 处理消息
      const handleMessage = (raw: Buffer | string) => {
        const rawStr = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(rawStr) as RpcResponse & { event?: string; data?: unknown; type?: string; payload?: ChallengePayload };

        // connect.challenge：Gateway 建连后始终发送，收到后立即发 connect RPC 请求
        if (msg.event === 'connect.challenge') {
          const payload = msg.payload ?? (msg.data as ChallengePayload);
          const useChallenge = this.useChallengeMode();
          console.log(`[GatewayClient] Received connect.challenge, mode=${useChallenge ? 'challenge' : 'token-only'}`);
          this._sendConnectRpc(payload, useChallenge)
            .catch((err) => {
              if (!handshakeDone) {
                handshakeDone = true;
                this.ws = null;
                ws.close();
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            });
          return;
        }

        // connect.failed / connect.error：认证失败（服务端关闭前发出）
        if (msg.event === 'connect.failed' || msg.event === 'connect.error') {
          const errorMsg = (msg.data as { message?: string })?.message ?? 'Authentication failed';
          console.error(`[GatewayClient] ${msg.event}: ${errorMsg}`);
          return;
        }

        // RPC 响应（含 connect 握手的 ok:true 响应）
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
          return;
        }

        // 透传其他事件
        if (msg.event) {
          const listeners = this.eventListeners.get(msg.event) ?? [];
          for (const fn of listeners) fn(msg.data);
        }
      };

      ws.once('open', () => {
        this.ws = ws;
        // 等待服务端发 connect.challenge，收到后再发 connect RPC
        // 握手超时兜底：10s 内未完成则断开
        const handshakeTimer = setTimeout(() => {
          if (!handshakeDone) {
            handshakeDone = true;
            this.ws = null;
            ws.close();
            reject(new Error('Gateway handshake timeout (10s)'));
          }
        }, 10000);

        // 当 connect RPC 成功 resolve 时清除超时并 resolve 外层 Promise
        const onHandshakeSuccess = () => {
          clearTimeout(handshakeTimer);
          if (!handshakeDone) {
            handshakeDone = true;
            console.log('[GatewayClient] Gateway authentication successful');
            resolve();
          }
        };
        // 暴露给 _sendConnectRpc 使用
        (this as unknown as Record<string, unknown>)['_pendingHandshakeResolve'] = onHandshakeSuccess;
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
        if (!handshakeDone) {
          handshakeDone = true;
          reject(new Error('Gateway disconnected before handshake'));
        }
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this._connect().catch(() => {});
          }, this.reconnectIntervalMs);
        }
      });
    });
  }

  /**
   * 发送 connect RPC 请求（符合 OpenClaw Gateway 协议）
   * 格式：{ id, method:"connect", params:{ minProtocol, maxProtocol, client, auth, [device] } }
   * 服务端回：{ type:"res", id, ok:true, payload:helloOk }
   */
  private async _sendConnectRpc(challengePayload: ChallengePayload, useChallenge: boolean): Promise<void> {
    if (!this.ws) throw new Error('WebSocket not ready');

    const clientId = 'gateway-client'; // GATEWAY_CLIENT_IDS.GATEWAY_CLIENT — Gateway 允许的枚举值
    const clientMode = 'backend';
    const role = 'operator';
    const scopes = ['sessions', 'agents', 'gateway'];
    const platform = process.platform ?? 'darwin';
    const token = this.opts.operatorToken ?? this.opts.token;

    let device: Record<string, unknown> | undefined;

    if (useChallenge) {
      if (!this.privateKeyPem || !this.publicKeyPem || !this.deviceId) {
        throw new Error('Device key not loaded, cannot use challenge mode');
      }
      // 构建 Ed25519 签名（符合 OpenClaw SDK buildDeviceAuthPayloadV3 格式）
      const pubKeyObj = createPublicKey(this.publicKeyPem);
      const jwk = pubKeyObj.export({ format: 'jwk' });
      const rawPublicKey = Buffer.from(jwk.x as string, 'base64url');
      const signedAtMs = Date.now();

      const authPayload = [
        'v3',
        this.deviceId,
        clientId,
        clientMode,
        role,
        scopes.join(','),
        String(signedAtMs),
        token,
        challengePayload.nonce,
        platform,
        platform, // deviceFamily
      ].join('|');

      const privateKey = createPrivateKey(this.privateKeyPem);
      const signature = cryptoSign(null, Buffer.from(authPayload, 'utf8'), privateKey);

      device = {
        id: this.deviceId,
        publicKey: base64url(rawPublicKey),
        signature: base64url(signature),
        signedAt: signedAtMs,
        nonce: challengePayload.nonce,
      };
      console.log('[GatewayClient] Sending connect RPC with device signature');
    } else {
      console.log('[GatewayClient] Sending connect RPC (token-only)');
    }

    // 构建符合 Gateway 协议的 RPC 请求帧
    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '1.0.0',
        platform,
        deviceFamily: platform,
        mode: clientMode,
      },
      caps: [],
      auth: { token },
      role,
      scopes,
      ...(device ? { device } : {}),
    };

    // 通过 pending Map 发 RPC，等待 ok:true 响应
    const connectId = String(++this.msgId);
    const connectPromise = new Promise<void>((res, rej) => {
      this.pending.set(connectId, (response) => {
        if (response.error) {
          rej(new Error(`connect RPC failed: ${response.error.message}`));
        } else {
          // 握手成功：通知外层 Promise resolve
          const onSuccess = (this as unknown as Record<string, unknown>)['_pendingHandshakeResolve'] as (() => void) | undefined;
          onSuccess?.();
          res();
        }
      });
    });

    this.ws.send(JSON.stringify({ type: 'req', id: connectId, method: 'connect', params }));

    await connectPromise;
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
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
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
