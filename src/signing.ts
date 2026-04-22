import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Empty-body SHA-256 hash. Used for GET / DELETE requests and POSTs
 * without a body. Computed once and cached.
 */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface SignedHeaders {
  'MX-API-KEY': string;
  'MX-SIGNATURE': string;
  'MX-TIMESTAMP': string;
  'MX-NONCE': string;
}

/**
 * Build the canonical string that goes into the HMAC. The format matches the
 * Mintarex gateway verifier exactly:
 *
 *   METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256_HEX(body)
 *
 * `path` MUST include the query string if any (e.g. /v1/trades?limit=10).
 */
export function buildCanonicalString(params: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return `${params.method.toUpperCase()}\n${params.path}\n${params.timestamp}\n${params.nonce}\n${params.bodyHash}`;
}

/**
 * Compute SHA-256 hex digest of a body. `body` should be exactly the bytes
 * that will be sent on the wire. For JSON, pass the serialized string; for
 * empty requests, use {@link EMPTY_BODY_SHA256}.
 */
export function sha256Hex(body: string | Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Compute the HMAC-SHA256 signature of the canonical string using the API
 * secret, returning lowercase hex.
 */
export function hmacSign(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Produce the four auth headers for a request. Caller is responsible for
 * ensuring `path` includes any query string and `body` matches the exact
 * bytes being sent.
 *
 * `timestamp` and `nonce` are injectable for testing; in production leave
 * them unset and they are generated (Unix seconds, UUID v4).
 */
export function sign(params: {
  apiKey: string;
  apiSecret: string;
  method: string;
  path: string;
  body?: string | Uint8Array | null;
  timestamp?: string;
  nonce?: string;
  now?: () => number;
}): SignedHeaders {
  const now = params.now ?? (() => Date.now());
  const timestamp = params.timestamp ?? Math.floor(now() / 1000).toString();
  const nonce = params.nonce ?? randomUUID();

  const bodyHash =
    params.body == null || params.body === ''
      ? EMPTY_BODY_SHA256
      : sha256Hex(params.body);

  const canonical = buildCanonicalString({
    method: params.method,
    path: params.path,
    timestamp,
    nonce,
    bodyHash,
  });

  const signature = hmacSign(params.apiSecret, canonical);

  return {
    'MX-API-KEY': params.apiKey,
    'MX-SIGNATURE': signature,
    'MX-TIMESTAMP': timestamp,
    'MX-NONCE': nonce,
  };
}
