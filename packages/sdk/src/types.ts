/**
 * SDK-only supplementary types (request parameter shapes, internal helpers).
 *
 * Public response types live in `@clawgate/shared` to keep the server and SDK
 * aligned on a single source of truth.
 */

export interface ClawGateOptions {
  /** Base URL of the ClawGate API Server, e.g. `http://localhost:3000`. */
  baseUrl: string;
  /** API key for team-mode endpoints. Personal endpoints ignore this. */
  apiKey?: string;
  /** Per-request timeout in ms. Default: 15000. */
  timeoutMs?: number;
  /**
   * Custom fetch implementation (useful for testing or Node < 18 polyfills).
   * Defaults to global `fetch`.
   */
  fetch?: typeof fetch;
}

export interface ChatOptions {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface InstanceListFilter {
  environment?: 'development' | 'staging' | 'production';
  tag?: string;
}

export interface AlertListFilter {
  acknowledged?: boolean;
  severity?: 'critical' | 'warning' | 'info';
  type?: string;
  limit?: number;
}
