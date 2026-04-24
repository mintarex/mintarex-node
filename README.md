<p align="center">
  <a href="https://mintarex.com">
    <img src="https://mintarex.com/mintarex.svg" alt="Mintarex" width="320" />
  </a>
</p>

<h1 align="center">@mintarex-official/node</h1>

<p align="center">
  Official Node.js SDK for the <a href="https://developers.mintarex.com">Mintarex Corporate OTC API</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mintarex-official/node"><img src="https://img.shields.io/npm/v/@mintarex-official/node.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@mintarex-official/node"><img src="https://img.shields.io/npm/dm/@mintarex-official/node.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/mintarex/mintarex-node/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@mintarex-official/node.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@mintarex-official/node.svg?style=flat-square" alt="Node.js version" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/types-TypeScript-blue?style=flat-square" alt="TypeScript" /></a>
</p>

---

- HMAC-SHA256 request signing (automatic)
- Typed errors per API error code
- RFQ trading, crypto deposits/withdrawals, webhooks, real-time SSE streams
- Webhook signature verification helper
- Built for Node.js 18.17+ using native `fetch` — zero runtime dependencies
- TypeScript types included

## Installation

```bash
npm install @mintarex-official/node
```

## Quickstart

```ts
import { Mintarex } from '@mintarex-official/node';

const mx = new Mintarex({
  apiKey: process.env.MINTAREX_API_KEY!,      // mxn_live_... or mxn_test_...
  apiSecret: process.env.MINTAREX_API_SECRET!,
});

// Account
const balances = await mx.account.balances({ currency_type: 'crypto' });

// RFQ — request a quote and accept it
const quote = await mx.rfq.quote({
  base: 'BTC',
  quote: 'USD',
  side: 'buy',
  amount: '0.5',
  amount_type: 'base',
});
const trade = await mx.rfq.accept(quote.quote_id);

// Deposits
const addr = await mx.crypto.depositAddress({ coin: 'BTC' });

// Withdrawals (address must be pre-whitelisted)
await mx.crypto.withdraw({
  coin: 'BTC',
  network: 'btc',
  amount: '0.1',
  address: 'bc1q...',
});
```

The environment (`live` vs `sandbox`) is auto-detected from the key prefix. `mxn_test_*` keys operate against the sandbox where trades settle instantly and withdrawals don't need approval.

## Core concepts

### Request signing

Every authenticated request carries four headers:

- `MX-API-KEY` — public key identifier
- `MX-SIGNATURE` — `hex(HMAC-SHA256(secret, canonical))`
- `MX-TIMESTAMP` — Unix seconds (±30s window)
- `MX-NONCE` — per-request UUID v4

The canonical string is `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256_HEX(body)`.
The SDK handles all of this for you; you don't need to sign manually. If you want to inspect or reuse the primitives, they are exported:

```ts
import { sign, buildCanonicalString } from '@mintarex-official/node';
```

### Retries

The client retries automatically on `429` and `503`, honouring `Retry-After`. For POSTs, retries on network errors only happen when the request body contains an `idempotency_key` — the SDK auto-generates a UUID for `rfq.accept` and `crypto.withdraw` so those calls are safe to retry by default. Override with `maxRetries` on the constructor or per-request.

### Errors

All errors extend `MintarexError`. HTTP errors are `MintarexAPIError` with a `status`, `code`, `message`, `requestId`, `retryAfter`, and `rateLimit`. Specific subclasses let you branch cleanly:

```ts
import {
  AuthenticationError,
  PermissionError,
  ValidationError,
  InsufficientBalanceError,
  QuoteExpiredError,
  RateLimitError,
  ServiceUnavailableError,
  NetworkError,
  ConflictError,
  NotFoundError,
  ServerError,
} from '@mintarex-official/node';

try {
  await mx.rfq.accept(quoteId);
} catch (err) {
  if (err instanceof QuoteExpiredError) {
    // quote older than 30s — request a fresh one
  } else if (err instanceof InsufficientBalanceError) {
    // ...
  } else if (err instanceof RateLimitError) {
    console.log('retry after', err.retryAfter, 'ms');
  } else {
    throw err;
  }
}
```

### Rate limit + request ID

Every successful response has a non-enumerable `_meta` property:

```ts
const trades = await mx.trades.list({ limit: 50 });
console.log(trades._meta?.requestId);
console.log(trades._meta?.rateLimit);  // { limit, remaining, reset }
```

### Idempotency

`rfq.accept` and `crypto.withdraw` accept an optional `idempotency_key`. If you omit it, the SDK generates a UUID for you so retries after network failures re-deliver the same request instead of executing twice:

```ts
await mx.crypto.withdraw({
  coin: 'BTC',
  network: 'btc',
  amount: '0.1',
  address: 'bc1q...',
  idempotency_key: 'payout-invoice-2026-04-22-001',
});
```

## Streaming (SSE)

Real-time price and account events arrive over Server-Sent Events. The SDK handles token acquisition, auto-reconnect with backoff, and heartbeat watchdogs.

```ts
const stream = mx.streams.account();

stream.on('open', () => console.log('connected'));
stream.on('trade.executed', (msg) => console.log('trade', msg.data));
stream.on('deposit.confirmed', (msg) => console.log('deposit', msg.data));
stream.on('error', (err) => console.error(err));
stream.on('close', () => console.log('closed'));

// Shut it down later:
stream.close();
```

Prices stream:

```ts
const prices = mx.streams.prices();
prices.on('message', (msg) => console.log(msg.event, msg.data));
```

Pass `{ signal: AbortSignal }` or `{ autoReconnect: false }` via the second argument to either method for manual control.

## Webhooks

Register an endpoint and Mintarex will POST signed events to it. In production a confirmation email is sent before the webhook goes live; in sandbox the endpoint is active immediately.

```ts
const created = await mx.webhooks.create({
  url: 'https://api.yourcompany.com/webhooks/mintarex',
  events: ['trade.executed', 'deposit.confirmed', 'withdrawal.completed'],
  label: 'Production webhook',
});
// Save created.signing_secret securely — it is returned only once.
```

### Verifying webhook signatures

Every delivery carries `X-Mintarex-Signature: v1=<hex>` and `X-Mintarex-Timestamp`. Use `verifyWebhook` with the **raw request body** (not the parsed JSON):

```ts
import express from 'express';
import { verifyWebhook, WebhookSignatureError } from '@mintarex-official/node';

const app = express();

app.post(
  '/webhooks/mintarex',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      const event = verifyWebhook({
        body: req.body,                     // Buffer from express.raw
        headers: req.headers,
        secret: process.env.MINTAREX_WEBHOOK_SECRET!,
      });
      switch (event.event_type) {
        case 'trade.executed': /* ... */ break;
        case 'deposit.confirmed': /* ... */ break;
      }
      res.status(200).send('ok');
    } catch (err) {
      if (err instanceof WebhookSignatureError) return res.status(400).end();
      throw err;
    }
  },
);
```

The verifier uses constant-time comparison and rejects any delivery more than 5 minutes old by default (configurable via `toleranceSeconds`).

## API surface

| Resource | Methods |
|---|---|
| `mx.account` | `balances`, `balance`, `limits` |
| `mx.rfq` | `quote`, `accept` |
| `mx.trades` | `list`, `get` |
| `mx.crypto` | `depositAddress`, `deposits`, `withdraw`, `withdrawals`, `getWithdrawal` |
| `mx.crypto.addresses` | `list`, `add`, `remove` |
| `mx.webhooks` | `create`, `list`, `remove` |
| `mx.streams` | `prices`, `account` |
| `mx.public` | `instruments`, `networks`, `fees` |

See [developers.mintarex.com](https://developers.mintarex.com) for request/response details per endpoint.

## Configuration

```ts
new Mintarex({
  apiKey: string,                // required
  apiSecret: string,             // required
  environment?: 'live' | 'sandbox',  // inferred from key prefix if omitted
  baseURL?: string,              // default: https://institutional.mintarex.com/v1
  streamBaseURL?: string,        // default: https://institutional.mintarex.com/v1/stream
  timeoutMs?: number,            // default: 30000
  maxRetries?: number,           // default: 3 (max 10)
  fetch?: typeof fetch,          // inject a custom fetch (e.g. for a proxy)
  userAgent?: string,            // suffix appended to the default UA
});
```

## Support

- **API Docs**: https://developers.mintarex.com
- **Issues**: https://github.com/mintarex/mintarex-node/issues
- **Contact**: support@mintarex.com

## License

MIT © [Mintarex](https://mintarex.com)

<p align="center">
  <img src="https://mintarex.com/ICON-512X512.png" alt="Mintarex" width="64" />
</p>
