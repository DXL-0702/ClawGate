/**
 * ClawGate SDK error types.
 *
 * Unlike the core RouterClient which silently degrades on failures (since it is
 * part of the ClawGate server itself), the SDK is consumed by application code
 * and MUST surface real failures so callers can choose their own fallback
 * strategy.
 */

export interface ClawGateErrorOptions {
  status?: number;
  code?: string;
  body?: unknown;
  cause?: unknown;
}

export class ClawGateError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, opts: ClawGateErrorOptions = {}) {
    super(message);
    this.name = 'ClawGateError';
    this.status = opts.status;
    this.code = opts.code;
    this.body = opts.body;
    if (opts.cause !== undefined) {
      (this as unknown as { cause: unknown }).cause = opts.cause;
    }
  }
}

/** 401 — missing/invalid X-API-Key, or a team-scoped method called without apiKey. */
export class ClawGateAuthError extends ClawGateError {
  constructor(message = 'Authentication required', opts: ClawGateErrorOptions = {}) {
    super(message, { ...opts, status: opts.status ?? 401 });
    this.name = 'ClawGateAuthError';
  }
}

/** 429 — daily budget exceeded (from /v1/chat/completions). */
export class ClawGateBudgetError extends ClawGateError {
  readonly spentUsd?: number;
  readonly limitUsd?: number;

  constructor(
    message = 'Daily budget exceeded',
    opts: ClawGateErrorOptions & { spentUsd?: number; limitUsd?: number } = {},
  ) {
    super(message, { ...opts, status: opts.status ?? 429, code: opts.code ?? 'daily_budget_exceeded' });
    this.name = 'ClawGateBudgetError';
    this.spentUsd = opts.spentUsd;
    this.limitUsd = opts.limitUsd;
  }
}
