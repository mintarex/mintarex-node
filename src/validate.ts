import { ValidationError } from './errors.js';

/**
 * Client-side validators that mirror the server regexes. Failing fast here
 * saves a round-trip and gives a clearer error than a 400 from the API.
 */

const AMOUNT_RE = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const ADDRESS_TAG_RE = /^[\x20-\x7E]{1,100}$/;
// Accepts 2-10 uppercase alphanumeric; digit-leading tickers exist (1INCH, 2Z).
const COIN_RE = /^[A-Z0-9]{2,10}$/;
const CURRENCY_FIAT_RE = /^[A-Z]{3,10}$/;
const CURRENCY_CODE_RE = /^[A-Z0-9]{2,10}$/;
const NETWORK_RE = /^[a-z0-9_-]{1,40}$/;
const ADDRESS_RE = /^[a-zA-Z0-9:._-]{10,255}$/;
const IDEMPOTENCY_RE = /^[\x20-\x7E]{1,64}$/;
const LABEL_RE = /^[\x20-\x7E]{1,100}$/;

function reject(message: string): never {
  throw new ValidationError({
    status: 0,
    code: 'client_validation',
    message,
    requestId: null,
    retryAfter: null,
    rateLimit: null,
    responseBody: null,
  });
}

export function assertAmount(value: unknown, field = 'amount'): string {
  if (typeof value !== 'string') {
    reject(`${field} must be a decimal string (not ${typeof value})`);
  }
  if (!AMOUNT_RE.test(value)) {
    reject(
      `${field} must be a decimal with ≤30 integer digits and ≤18 decimal places, ` +
        `no sign, no scientific notation`,
    );
  }
  return value;
}

export function assertAddressTag(value: unknown, field = 'address_tag'): string {
  if (typeof value !== 'string' || !ADDRESS_TAG_RE.test(value)) {
    reject(`${field} must be 1-100 printable ASCII characters`);
  }
  return value;
}

export function assertCoin(value: unknown, field = 'coin'): string {
  if (typeof value !== 'string' || !COIN_RE.test(value)) {
    reject(`${field} must be 2-10 uppercase letters or digits`);
  }
  return value;
}

export function assertFiatCurrency(value: unknown, field = 'currency'): string {
  if (typeof value !== 'string' || !CURRENCY_FIAT_RE.test(value)) {
    reject(`${field} must be 3-10 uppercase letters`);
  }
  return value;
}

/**
 * Validates any currency code (fiat OR crypto). Used for endpoints where
 * the SDK doesn't need to classify the code — the server handles routing.
 * Supports digit-leading codes like "1INCH" and "2Z".
 */
export function assertCurrencyCode(value: unknown, field = 'currency'): string {
  if (typeof value !== 'string' || !CURRENCY_CODE_RE.test(value)) {
    reject(`${field} must be 2-10 uppercase letters or digits`);
  }
  return value;
}

export function assertNetwork(value: unknown, field = 'network'): string {
  if (typeof value !== 'string' || !NETWORK_RE.test(value)) {
    reject(`${field} must be 1-40 lowercase [a-z0-9_-]`);
  }
  return value;
}

export function assertAddress(value: unknown, field = 'address'): string {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    reject(`${field} must be 10-255 chars, alphanumeric + : . _ -`);
  }
  return value;
}

export function assertIdempotencyKey(value: unknown, field = 'idempotency_key'): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_RE.test(value)) {
    reject(`${field} must be 1-64 printable ASCII characters`);
  }
  return value;
}

export function assertLabel(value: unknown, field = 'label'): string {
  if (typeof value !== 'string' || !LABEL_RE.test(value)) {
    reject(`${field} must be 1-100 printable ASCII characters`);
  }
  return value;
}

export function assertSide(value: unknown, field = 'side'): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') {
    reject(`${field} must be "buy" or "sell"`);
  }
  return value;
}

export function assertAmountType(value: unknown, field = 'amount_type'): 'base' | 'quote' {
  if (value !== 'base' && value !== 'quote') {
    reject(`${field} must be "base" or "quote"`);
  }
  return value;
}

export function assertUuid(value: unknown, field = 'uuid'): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    reject(`${field} must be a valid UUID`);
  }
  return value.toLowerCase();
}

export function assertHttpsUrl(value: unknown, field = 'url'): string {
  if (typeof value !== 'string') reject(`${field} must be a string`);
  if (value.length > 2048) reject(`${field} too long (max 2048)`);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    reject(`${field} is not a valid URL`);
  }
  if (u.protocol !== 'https:') reject(`${field} must use https://`);
  if (u.username || u.password) reject(`${field} must not contain credentials`);
  return value;
}

export function assertEvents(value: unknown, field = 'events'): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    reject(`${field} must be a non-empty array`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ev of value as unknown[]) {
    if (typeof ev !== 'string' || !/^[a-z]+\.[a-z_]+$/.test(ev)) {
      reject(`${field} entries must look like "domain.action" (lowercase)`);
    }
    if (!seen.has(ev)) {
      seen.add(ev);
      out.push(ev);
    }
  }
  return out;
}

export function assertPositiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    reject(`${field} must be a non-negative integer ≤ ${max}`);
  }
  return value;
}
