import { ConfigurationError, NetworkError, errorFromResponse } from './errors.js';
import type { RateLimitInfo } from './errors.js';
import { sign } from './signing.js';
import type { Environment, ResponseMeta } from './types.js';

export interface ClientOptions {
  apiKey: string;
  apiSecret: string;
  environment?: Environment;
  baseURL?: string;
  streamBaseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Supply your own fetch (e.g. for tests or a custom agent). */
  fetch?: typeof fetch;
  /** User-Agent string appended to the default. */
  userAgent?: string;
}

const SDK_VERSION = '0.0.4';
const DEFAULT_BASE_URL = 'https://institutional.mintarex.com/v1';
const DEFAULT_STREAM_BASE_URL =
  'https://institutional.mintarex.com/v1/stream';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

const LIVE_KEY_PREFIX = 'mxn_live_';
const TEST_KEY_PREFIX = 'mxn_test_';

export interface RequestOptions<TBody = unknown> {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: TBody;
  signal?: AbortSignal;
  /** Override default retry count for this request. */
  maxRetries?: number;
  /**
   * Override idempotency handling. When true, safe to retry on network errors.
   * Defaults: GET/DELETE = true, POST/PUT/PATCH = false unless body contains
   * an `idempotency_key` field.
   */
  retryOnNetworkError?: boolean;
}

interface NormalizedRequest {
  url: URL;
  method: string;
  /** The exact path+query to sign (no host, no fragment). */
  canonicalPath: string;
  /** Exact string bytes to send as body (or null for empty). */
  bodyBytes: string | null;
}

export class MintarexClient {
  private readonly apiKey: string;
  // Definite-assignment: assigned via Object.defineProperty in the constructor
  // so JSON.stringify / util.inspect / console.log don't leak it.
  private readonly apiSecret!: string;
  public readonly environment: Environment;
  public readonly baseURL: URL;
  public readonly streamBaseURL: URL;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgentExtra: string;

  /** Internal: exposed so the SSE streaming client uses the same fetch
   *  implementation (including any test-injected mock). */
  public get fetch(): typeof fetch {
    return this.fetchImpl;
  }

  /** Safe representation for `JSON.stringify(client)`. apiSecret is omitted. */
  public toJSON(): Record<string, unknown> {
    return {
      apiKey: this.apiKey,
      environment: this.environment,
      baseURL: this.baseURL.href,
      streamBaseURL: this.streamBaseURL.href,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
    };
  }

  /** Safe representation for `util.inspect(client)` / `console.log(client)`.
   *  Some tooling reaches for this symbol over toJSON(); covering both prevents
   *  the secret from leaking into structured logs. */
  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `MintarexClient { apiKey: '${this.apiKey}', environment: '${this.environment}', apiSecret: '[REDACTED]' }`;
  }

  public constructor(options: ClientOptions) {
    if (!options || typeof options !== 'object') {
      throw new ConfigurationError('ClientOptions object is required');
    }
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new ConfigurationError('apiKey is required');
    }
    if (typeof options.apiSecret !== 'string' || options.apiSecret.length === 0) {
      throw new ConfigurationError('apiSecret is required');
    }

    const env: Environment = options.environment ?? inferEnvironment(options.apiKey);
    if (env !== 'live' && env !== 'sandbox') {
      throw new ConfigurationError(`Invalid environment: ${String(env)}`);
    }
    const keyPrefixMatchesEnv =
      (env === 'live' && options.apiKey.startsWith(LIVE_KEY_PREFIX)) ||
      (env === 'sandbox' && options.apiKey.startsWith(TEST_KEY_PREFIX));
    if (!keyPrefixMatchesEnv) {
      throw new ConfigurationError(
        `apiKey prefix does not match environment "${env}". ` +
          'Live keys start with mxn_live_, sandbox keys with mxn_test_.',
      );
    }

    this.apiKey = options.apiKey;
    // Store apiSecret as a non-enumerable property so JSON.stringify(client),
    // util.inspect(client) and console.log(client) cannot leak it into logs.
    Object.defineProperty(this, 'apiSecret', {
      value: options.apiSecret,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    this.environment = env;
    this.baseURL = parseBaseURL(options.baseURL ?? DEFAULT_BASE_URL, 'baseURL');
    this.streamBaseURL = parseBaseURL(
      options.streamBaseURL ?? DEFAULT_STREAM_BASE_URL,
      'streamBaseURL',
    );
    this.timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.maxRetries =
      typeof options.maxRetries === 'number' && options.maxRetries >= 0
        ? Math.min(options.maxRetries, 10)
        : DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new ConfigurationError(
        'No fetch implementation available. Node 18.17+ required, or supply options.fetch.',
      );
    }
    this.userAgentExtra =
      typeof options.userAgent === 'string' ? ` ${options.userAgent}` : '';
  }

  /**
   * Execute a signed request. Returns the parsed JSON body with a
   * non-enumerable `_meta` property for request-id and rate-limit headers.
   */
  public async request<TResponse = unknown, TBody = unknown>(
    options: RequestOptions<TBody>,
  ): Promise<TResponse & { _meta?: ResponseMeta }> {
    const normalized = this.normalizeRequest(options);
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const retryOnNetworkError = resolveRetryOnNetworkError(options, normalized);

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      try {
        const response = await this.executeOnce(normalized, options.signal);

        if (response.ok) {
          return attachMeta<TResponse>(response.body as TResponse, response.meta);
        }

        const apiError = errorFromResponse({
          status: response.meta.status,
          code: response.errorCode,
          message: response.errorMessage,
          requestId: response.meta.requestId,
          retryAfter: response.retryAfter,
          rateLimit: response.meta.rateLimit,
          responseBody: response.body,
        });

        if (shouldRetryOnStatus(response.meta.status) && attempt < maxRetries) {
          await delay(backoffMs(attempt, response.retryAfter));
          attempt += 1;
          continue;
        }
        throw apiError;
      } catch (err) {
        if (isAbortError(err)) {
          throw err;
        }
        if (err instanceof NetworkError) {
          if (retryOnNetworkError && attempt < maxRetries) {
            lastError = err;
            await delay(backoffMs(attempt, null));
            attempt += 1;
            continue;
          }
          throw err;
        }
        throw err;
      }
    }

    throw (lastError as Error) ?? new NetworkError('Retry limit exceeded');
  }

  private normalizeRequest(options: RequestOptions): NormalizedRequest {
    const method = options.method.toUpperCase();
    if (!method.match(/^[A-Z]+$/)) {
      throw new ConfigurationError(`Invalid HTTP method: ${options.method}`);
    }
    if (typeof options.path !== 'string' || !options.path.startsWith('/')) {
      throw new ConfigurationError(
        `path must be a string starting with "/" (got ${typeof options.path})`,
      );
    }

    const url = new URL(this.baseURL.href);
    url.pathname = joinPath(url.pathname, options.path);
    url.hash = '';

    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.append(k, String(v));
      }
    }

    const canonicalPath = url.pathname + (url.search || '');

    let bodyBytes: string | null = null;
    if (options.body != null && method !== 'GET' && method !== 'DELETE') {
      try {
        bodyBytes = JSON.stringify(options.body);
      } catch (err) {
        throw new ConfigurationError(
          `Request body is not JSON-serializable (circular reference?): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (typeof bodyBytes !== 'string') {
        throw new ConfigurationError(
          'Request body serialized to undefined; pass a plain object, array, or primitive',
        );
      }
    }

    return { url, method, canonicalPath, bodyBytes };
  }

  private async executeOnce(
    req: NormalizedRequest,
    externalSignal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    body: unknown;
    errorCode: string;
    errorMessage: string;
    retryAfter: number | null;
    meta: ResponseMeta;
  }> {
    const headers = sign({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      method: req.method,
      path: req.canonicalPath,
      body: req.bodyBytes,
    });

    const finalHeaders: Record<string, string> = {
      ...headers,
      Accept: 'application/json',
      'User-Agent': `mintarex-node/${SDK_VERSION} (node ${process.version})${this.userAgentExtra}`,
    };
    if (req.bodyBytes != null) {
      finalHeaders['Content-Type'] = 'application/json';
    }

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = mergeAbortSignals(timeoutController.signal, externalSignal);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(req.url, {
          method: req.method,
          headers: finalHeaders,
          body: req.bodyBytes ?? undefined,
          redirect: 'error',
          signal,
        });
      } catch (err) {
        if (externalSignal?.aborted === true) {
          throw makeAbortError(externalSignal.reason);
        }
        if (timeoutController.signal.aborted) {
          throw new NetworkError(`Request timed out after ${this.timeoutMs}ms`, {
            cause: err,
          });
        }
        throw new NetworkError(
          err instanceof Error ? err.message : 'Network error',
          { cause: err },
        );
      }

      // Consume body FIRST — aborting the timeout controller before this point
      // would also abort the response body stream (it shares the merged signal),
      // causing response.text() to throw and silently drop the payload.
      const contentType = response.headers.get('content-type') ?? '';
      let body: unknown = null;
      let rawText: string;
      try {
        rawText = await response.text();
      } catch (err) {
        if (externalSignal?.aborted === true) {
          throw makeAbortError(externalSignal.reason);
        }
        if (timeoutController.signal.aborted) {
          throw new NetworkError(
            `Request timed out after ${this.timeoutMs}ms while reading body`,
            { cause: err },
          );
        }
        // Any other body-read failure (stream error, decoding issue,
        // already-consumed body) is a hard error — do NOT silently return a
        // null body on a 2xx response.
        throw new NetworkError(
          `Failed to read response body: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
          { cause: err },
        );
      }

      if (rawText.length > 0) {
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(rawText);
          } catch {
            body = { error: 'invalid_json', message: rawText.slice(0, 500) };
          }
        } else {
          body = { error: 'non_json_response', message: rawText.slice(0, 500) };
        }
      }

      const rateLimit = readRateLimitHeaders(response);
      const meta: ResponseMeta = {
        requestId: response.headers.get('x-request-id'),
        rateLimit,
        status: response.status,
      };

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      let errorCode = 'unknown_error';
      let errorMessage = `HTTP ${response.status}`;
      if (!response.ok && body && typeof body === 'object') {
        const b = body as { error?: unknown; message?: unknown };
        if (typeof b.error === 'string') errorCode = b.error;
        if (typeof b.message === 'string') errorMessage = b.message;
      }

      return {
        ok: response.ok,
        body,
        errorCode,
        errorMessage,
        retryAfter,
        meta,
      };
    } finally {
      clearTimeout(timer);
      // Body fully consumed (or errored) by now — firing the internal abort
      // here is safe and detaches the forwardExternal listener from the
      // caller's long-lived AbortSignal so it doesn't leak across requests.
      if (!timeoutController.signal.aborted) timeoutController.abort();
    }
  }

  /** Produce headers for an externally-managed request (e.g. SSE GET). */
  public signForStreamToken(): {
    method: 'POST';
    url: URL;
    headers: Record<string, string>;
    body: string;
  } {
    const url = new URL(this.baseURL.href);
    url.pathname = joinPath(url.pathname, '/stream/token');
    const bodyBytes = '';
    const headers = sign({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      method: 'POST',
      path: url.pathname,
      body: bodyBytes,
    });
    return {
      method: 'POST',
      url,
      headers: {
        ...headers,
        Accept: 'application/json',
        'User-Agent': `mintarex-node/${SDK_VERSION} (node ${process.version})${this.userAgentExtra}`,
      },
      body: bodyBytes,
    };
  }
}

function inferEnvironment(apiKey: string): Environment {
  if (apiKey.startsWith(LIVE_KEY_PREFIX)) return 'live';
  if (apiKey.startsWith(TEST_KEY_PREFIX)) return 'sandbox';
  throw new ConfigurationError(
    'apiKey must start with mxn_live_ or mxn_test_ (or set environment explicitly).',
  );
}

function parseBaseURL(input: string, name: string): URL {
  try {
    const u = new URL(input);
    if (u.protocol === 'https:') return u;
    if (u.protocol === 'http:' && isLoopbackHostname(u.hostname)) return u;
    throw new Error(
      u.protocol === 'http:'
        ? 'http:// is only permitted for loopback (localhost / 127.x / ::1)'
        : `protocol must be https://`,
    );
  } catch (err) {
    throw new ConfigurationError(
      `Invalid ${name}: ${input} (${err instanceof Error ? err.message : 'unknown'})`,
    );
  }
}

function isLoopbackHostname(host: string): boolean {
  if (host === 'localhost') return true;
  if (host === '::1' || host === '[::1]') return true;
  if (/^127\./.test(host)) return true;
  return false;
}

function joinPath(a: string, b: string): string {
  const left = a.endsWith('/') ? a.slice(0, -1) : a;
  const right = b.startsWith('/') ? b : '/' + b;
  return left + right;
}

function readRateLimitHeaders(response: Response): RateLimitInfo {
  // Server uses IETF standard headers (RFC 9331: `RateLimit-*` with no prefix).
  // We also check the legacy `X-RateLimit-*` form as a fallback for gateways
  // or proxies that rewrite headers. HTTP header names are case-insensitive.
  const getOne = (name: string): number | null =>
    numOrNull(
      response.headers.get(name) ??
        response.headers.get(`x-${name}`) ??
        null,
    );
  return {
    limit: getOne('ratelimit-limit'),
    remaining: getOne('ratelimit-remaining'),
    reset: getOne('ratelimit-reset'),
  };
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MAX_RETRY_AFTER_MS = 60_000;

function parseRetryAfter(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, Math.floor(n * 1000)));
  }
  const ts = Date.parse(v);
  if (!Number.isNaN(ts)) {
    return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, ts - Date.now()));
  }
  return null;
}

function shouldRetryOnStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function resolveRetryOnNetworkError(
  options: RequestOptions,
  normalized: NormalizedRequest,
): boolean {
  if (typeof options.retryOnNetworkError === 'boolean') {
    return options.retryOnNetworkError;
  }
  if (normalized.method === 'GET' || normalized.method === 'DELETE') return true;
  if (
    normalized.bodyBytes &&
    options.body &&
    typeof options.body === 'object' &&
    Object.prototype.hasOwnProperty.call(options.body, 'idempotency_key')
  ) {
    return true;
  }
  return false;
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    // Jitter ±10% (up to 5s each side) to avoid thundering-herd when many
    // clients respect the same Retry-After. Signed jitter around capped value.
    const capped = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
    const maxJitter = Math.min(capped * 0.1, 5000);
    const jitter = Math.floor((Math.random() * 2 - 1) * maxJitter);
    return Math.max(0, capped + jitter);
  }
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 15_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function makeAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const e = new Error('Request aborted');
  e.name = 'AbortError';
  return e;
}

function mergeAbortSignals(
  internal: AbortSignal,
  external?: AbortSignal,
): AbortSignal {
  if (!external) return internal;
  if (external.aborted) return external;
  if (internal.aborted) return internal;
  const controller = new AbortController();
  // Each side's listener removes the other on firing so a long-lived external
  // signal doesn't accumulate listeners across many requests.
  const forwardInternal = (): void => {
    external.removeEventListener('abort', forwardExternal);
    controller.abort(internal.reason);
  };
  const forwardExternal = (): void => {
    internal.removeEventListener('abort', forwardInternal);
    controller.abort(external.reason);
  };
  internal.addEventListener('abort', forwardInternal, { once: true });
  external.addEventListener('abort', forwardExternal, { once: true });
  return controller.signal;
}

function attachMeta<T>(body: T, meta: ResponseMeta): T & { _meta?: ResponseMeta } {
  if (body == null || typeof body !== 'object') {
    return body as T & { _meta?: ResponseMeta };
  }
  try {
    Object.defineProperty(body, '_meta', {
      value: meta,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  } catch {
    /* ignore frozen objects */
  }
  return body as T & { _meta?: ResponseMeta };
}
