/**
 * Base error class for all Mintarex SDK errors. Instances have `name`,
 * `message`, and a `cause` chain when applicable.
 */
export class MintarexError extends Error {
  public override readonly name: string = 'MintarexError';

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the SDK receives a non-2xx HTTP response from the API.
 */
export class MintarexAPIError extends MintarexError {
  public override readonly name: string = 'MintarexAPIError';

  public readonly status: number;
  public readonly code: string;
  public readonly requestId: string | null;
  public readonly retryAfter: number | null;
  public readonly rateLimit: RateLimitInfo | null;
  public readonly responseBody: unknown;

  public constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    retryAfter?: number | null;
    rateLimit?: RateLimitInfo | null;
    responseBody?: unknown;
  }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId ?? null;
    this.retryAfter = params.retryAfter ?? null;
    this.rateLimit = params.rateLimit ?? null;
    this.responseBody = params.responseBody ?? null;
  }
}

/** 401 — API key not recognized or signature invalid. */
export class AuthenticationError extends MintarexAPIError {
  public override readonly name: string = 'AuthenticationError';
}

/** 403 — API key is valid but lacks the required scope or permission. */
export class PermissionError extends MintarexAPIError {
  public override readonly name: string = 'PermissionError';
}

/** 400 — request validation failed (malformed params, bad amount, etc.). */
export class ValidationError extends MintarexAPIError {
  public override readonly name: string = 'ValidationError';
}

/** 400 with code `insufficient_balance` — wallet balance too low. */
export class InsufficientBalanceError extends MintarexAPIError {
  public override readonly name: string = 'InsufficientBalanceError';
}

/** 404 — resource not found. */
export class NotFoundError extends MintarexAPIError {
  public override readonly name: string = 'NotFoundError';
}

/** 409 — idempotency key conflict, quote already consumed, duplicate address, etc. */
export class ConflictError extends MintarexAPIError {
  public override readonly name: string = 'ConflictError';
}

/** 410 — RFQ quote expired (issued more than 30 seconds ago). */
export class QuoteExpiredError extends MintarexAPIError {
  public override readonly name: string = 'QuoteExpiredError';
}

/** 429 — rate limit or concurrency cap exceeded. */
export class RateLimitError extends MintarexAPIError {
  public override readonly name: string = 'RateLimitError';
}

/** 500 — server-side error. */
export class ServerError extends MintarexAPIError {
  public override readonly name: string = 'ServerError';
}

/** 503 — service temporarily unavailable; inspect `retryAfter`. */
export class ServiceUnavailableError extends MintarexAPIError {
  public override readonly name: string = 'ServiceUnavailableError';
}

/** Network-layer failure (DNS, TCP reset, TLS, timeout). No HTTP response received. */
export class NetworkError extends MintarexError {
  public override readonly name: string = 'NetworkError';
}

/** Webhook verification failed — bad signature, missing headers, or stale timestamp. */
export class WebhookSignatureError extends MintarexError {
  public override readonly name: string = 'WebhookSignatureError';
}

/** SDK mis-configuration (missing apiKey/apiSecret, invalid baseURL, etc.). */
export class ConfigurationError extends MintarexError {
  public override readonly name: string = 'ConfigurationError';
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

/**
 * Map an HTTP status + API error code into the most specific typed error class.
 *
 * The mapping prefers the API's `error` code over the HTTP status when the code
 * pinpoints a narrower case (e.g. `insufficient_balance` within a 400).
 */
export function errorFromResponse(params: {
  status: number;
  code: string;
  message: string;
  requestId: string | null;
  retryAfter: number | null;
  rateLimit: RateLimitInfo | null;
  responseBody: unknown;
}): MintarexAPIError {
  const { status, code } = params;

  if (code === 'insufficient_balance') return new InsufficientBalanceError(params);
  if (code === 'quote_expired_or_not_found') return new QuoteExpiredError(params);

  if (status === 400) return new ValidationError(params);
  if (status === 401) return new AuthenticationError(params);
  if (status === 403) return new PermissionError(params);
  if (status === 404) return new NotFoundError(params);
  if (status === 409) return new ConflictError(params);
  if (status === 410) return new QuoteExpiredError(params);
  if (status === 429) return new RateLimitError(params);
  if (status === 503) return new ServiceUnavailableError(params);
  if (status >= 500) return new ServerError(params);

  return new MintarexAPIError(params);
}
