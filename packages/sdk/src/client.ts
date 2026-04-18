import { ClawGateAuthError, ClawGateBudgetError, ClawGateError } from './errors.js';
import type { ClawGateOptions } from './types.js';

export interface RequestOptions {
  /** Whether the endpoint requires `X-API-Key`. Team-mode methods pass true. */
  requireApiKey?: boolean;
  /** Override headers (rarely needed). */
  headers?: Record<string, string>;
  /** Disable timeout (for SSE streaming). */
  noTimeout?: boolean;
  /** Override per-request signal (e.g. user-cancelable streaming). */
  signal?: AbortSignal;
}

export interface RawResponse {
  status: number;
  body: Response;
}

/**
 * Internal HTTP client. Thin wrapper around `fetch` that:
 *   • injects `X-API-Key` when configured,
 *   • applies a timeout via AbortController,
 *   • parses JSON error bodies into structured SDK errors,
 *   • exposes a raw variant for SSE streaming.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClawGateOptions) {
    if (!opts.baseUrl) throw new ClawGateError('baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) {
      throw new ClawGateError(
        'No fetch implementation available. Upgrade to Node >= 18 or pass opts.fetch.',
      );
    }
    // Bind to avoid "Illegal invocation" when grabbing global fetch.
    this.fetchImpl = f.bind(globalThis);
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  private buildHeaders(extra?: Record<string, string>, requireApiKey = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (requireApiKey) {
      if (!this.apiKey) {
        throw new ClawGateAuthError('This method requires an apiKey (team mode).');
      }
      headers['X-API-Key'] = this.apiKey;
    } else if (this.apiKey) {
      // Still forward API key even for endpoints that are dual-mode; server
      // may use it to scope results to the team.
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  /** JSON request returning parsed body of type T. */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const res = await this.rawRequest(method, path, body, options);
    const text = await res.body.text();
    const parsed = text ? safeParse(text) : null;

    if (!res.body.ok) {
      throw toSdkError(res.status, parsed, text);
    }
    return parsed as T;
  }

  /** Raw request — caller handles the body (used for SSE streaming). */
  async rawRequest(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<RawResponse> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = this.buildHeaders(options.headers, options.requireApiKey);

    const controller = options.noTimeout ? null : new AbortController();
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    const signal = options.signal
      ? chainSignals(options.signal, controller?.signal)
      : controller?.signal;

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? undefined,
      });
      return { status: res.status, body: res };
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') {
        throw new ClawGateError(`Request to ${path} timed out after ${this.timeoutMs}ms`, { cause: err });
      }
      throw new ClawGateError(`Network error calling ${path}: ${(err as Error).message}`, { cause: err });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toSdkError(status: number, parsed: unknown, rawText: string): ClawGateError {
  const body = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : null;
  const message = typeof body?.error === 'string' ? body.error
    : typeof body?.message === 'string' ? body.message
    : rawText || `HTTP ${status}`;

  if (status === 401 || status === 403) {
    return new ClawGateAuthError(message, { status, body: parsed });
  }
  if (status === 429 && body?.error === 'daily_budget_exceeded') {
    return new ClawGateBudgetError(message, {
      status,
      body: parsed,
      spentUsd: typeof body.spent_usd === 'number' ? body.spent_usd : undefined,
      limitUsd: typeof body.limit_usd === 'number' ? body.limit_usd : undefined,
    });
  }
  return new ClawGateError(message, { status, body: parsed });
}

function chainSignals(userSignal: AbortSignal, timeoutSignal?: AbortSignal): AbortSignal {
  if (!timeoutSignal) return userSignal;
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  if (userSignal.aborted) controller.abort(userSignal.reason);
  else userSignal.addEventListener('abort', () => onAbort(userSignal.reason), { once: true });
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason);
  else timeoutSignal.addEventListener('abort', () => onAbort(timeoutSignal.reason), { once: true });
  return controller.signal;
}
