import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError } from './errors.js';
import type { WebhookEvent } from './types.js';

/**
 * Default tolerance for webhook timestamp skew, in seconds.
 * Matches Stripe's default (300s) and guards against replay.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

const SIGNATURE_PREFIX = 'v1=';
const EXPECTED_SIG_HEX_LEN = 64;

export interface VerifyWebhookParams {
  /** The raw request body (exact bytes; pass Buffer or string — NOT parsed JSON). */
  body: string | Buffer | Uint8Array;
  /**
   * Request headers. Case-insensitive lookup. Accepts plain objects, arrays,
   * or Node http.IncomingHttpHeaders.
   */
  headers:
    | Record<string, string | string[] | undefined>
    | Iterable<[string, string]>
    | Headers;
  /** The endpoint's signing secret (whsec_...). */
  secret: string;
  /** Max allowed clock skew in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** Inject current time for testing. */
  now?: () => number;
}

/**
 * Verify a webhook signature and return the parsed event.
 *
 * Throws {@link WebhookSignatureError} on any failure. Uses constant-time
 * comparison and rejects stale timestamps.
 *
 * @example
 * ```ts
 * app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => {
 *   const event = verifyWebhook({
 *     body: req.body,
 *     headers: req.headers,
 *     secret: process.env.MINTAREX_WEBHOOK_SECRET!,
 *   });
 *   // handle event
 * });
 * ```
 */
export function verifyWebhook<T = Record<string, unknown>>(
  params: VerifyWebhookParams,
): WebhookEvent<T> {
  if (typeof params.secret !== 'string' || params.secret.length === 0) {
    throw new WebhookSignatureError('secret is required');
  }

  const sigHeader = readHeader(params.headers, 'x-mintarex-signature');
  const tsHeader = readHeader(params.headers, 'x-mintarex-timestamp');
  const eventTypeHeader = readHeader(params.headers, 'x-mintarex-event-type');
  const eventIdHeader = readHeader(params.headers, 'x-mintarex-event-id');
  const deliveryIdHeader = readHeader(params.headers, 'x-mintarex-delivery-id');

  if (!sigHeader) throw new WebhookSignatureError('Missing X-Mintarex-Signature header');
  if (!tsHeader) throw new WebhookSignatureError('Missing X-Mintarex-Timestamp header');
  if (!eventTypeHeader) throw new WebhookSignatureError('Missing X-Mintarex-Event-Type header');
  if (!eventIdHeader) throw new WebhookSignatureError('Missing X-Mintarex-Event-Id header');
  if (!deliveryIdHeader) throw new WebhookSignatureError('Missing X-Mintarex-Delivery-Id header');

  const signature = parseSignature(sigHeader);
  const timestamp = parseTimestamp(tsHeader);
  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSec = Math.floor((params.now?.() ?? Date.now()) / 1000);

  if (Math.abs(nowSec - timestamp) > tolerance) {
    throw new WebhookSignatureError(
      `Timestamp outside tolerance window (±${tolerance}s)`,
    );
  }

  const bodyStr = bodyToString(params.body);
  const expected = createHmac('sha256', params.secret)
    .update(`${tsHeader}.${bodyStr}`)
    .digest('hex');

  if (!constantTimeHexEqual(expected, signature)) {
    throw new WebhookSignatureError('Signature mismatch');
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyStr) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Body is not a JSON object');
    }
    payload = parsed as Record<string, unknown>;
  } catch (err) {
    throw new WebhookSignatureError('Body is not valid JSON', { cause: err });
  }

  // Body shape on the wire is `{...eventData, timestamp}`. We lift `timestamp`
  // and `sandbox` into structured fields on WebhookEvent; remaining keys are
  // the event-specific data payload.
  const { timestamp: bodyTimestamp, sandbox, ...data } = payload as {
    timestamp?: unknown;
    sandbox?: unknown;
    [k: string]: unknown;
  };

  return {
    event_type: eventTypeHeader,
    event_id: eventIdHeader,
    delivery_uuid: deliveryIdHeader,
    timestamp: typeof bodyTimestamp === 'string' ? bodyTimestamp : '',
    sandbox: sandbox === true,
    data: data as T,
  };
}

function parseSignature(header: string): string {
  const trimmed = header.trim();
  if (!trimmed.startsWith(SIGNATURE_PREFIX)) {
    throw new WebhookSignatureError('Signature must start with "v1="');
  }
  const hex = trimmed.slice(SIGNATURE_PREFIX.length);
  if (hex.length !== EXPECTED_SIG_HEX_LEN || !/^[0-9a-f]+$/i.test(hex)) {
    throw new WebhookSignatureError('Signature is not a 64-char hex string');
  }
  return hex.toLowerCase();
}

function parseTimestamp(header: string): number {
  const t = Number(header);
  if (!Number.isFinite(t) || !Number.isInteger(t) || t < 0) {
    throw new WebhookSignatureError('Timestamp header is not a valid Unix seconds integer');
  }
  return t;
}

function bodyToString(body: string | Buffer | Uint8Array): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  throw new WebhookSignatureError(
    'body must be a string, Buffer, or Uint8Array (raw request body, NOT parsed JSON)',
  );
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function readHeader(
  headers: VerifyWebhookParams['headers'],
  name: string,
): string | null {
  const lower = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(lower);
  }
  // Map<string,string> — explicit check (replaces a fragile constructor.name
  // sniff that misbehaved on custom classes).
  if (headers instanceof Map) {
    for (const [k, v] of headers) {
      if (typeof k === 'string' && k.toLowerCase() === lower) {
        return typeof v === 'string' ? v : null;
      }
    }
    return null;
  }
  // Array of [name, value] pairs (e.g. fetch's Headers#entries spread).
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' &&
          entry[0].toLowerCase() === lower) {
        return typeof entry[1] === 'string' ? entry[1] : null;
      }
    }
    return null;
  }
  const obj = headers as Record<string, string | string[] | undefined>;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) {
      const v = obj[k];
      if (Array.isArray(v)) return v[0] ?? null;
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}
