import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Mintarex,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  NetworkError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  QuoteExpiredError,
  InsufficientBalanceError,
} from '../dist/index.js';

function mkFetch(responses) {
  let i = 0;
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: url.toString(), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (typeof r === 'function') return r({ url, init });
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, {
      status: r.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(r.headers ?? {}),
      },
    });
  };
  impl.calls = calls;
  return impl;
}

function mkClient(fetchImpl, opts = {}) {
  return new Mintarex({
    apiKey: 'mxn_test_abc123',
    apiSecret: 'secret',
    fetch: fetchImpl,
    ...opts,
  });
}

test('2xx response body is returned (regression: abort-before-body-read bug)', async () => {
  // This test catches the class of bug where the SDK aborts the response
  // stream via the shared signal before response.text() can read the body.
  // Uses a fetch that honors the signal and reads body via a real Response.
  const payload = { balances: [{ currency: 'BTC', available: '1.5' }], timestamp: 't' };
  const f = async (_url, init) => {
    // Simulate a real fetch that would abort body streaming if signal fires.
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const mx = mkClient(f);
  const result = await mx.account.balances();
  assert.ok(result, 'result should not be null');
  assert.equal(result.balances.length, 1);
  assert.equal(result.balances[0].currency, 'BTC');
  assert.equal(result.timestamp, 't');
});

test('body-read failure throws NetworkError (no silent null body)', async () => {
  // Simulates a server that sends 200 OK headers then the body stream errors.
  // Previously the SDK swallowed this and returned null; now it must throw.
  const { NetworkError } = await import('../dist/index.js');
  const f = async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        controller.error(new Error('connection reset by peer'));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const mx = mkClient(f, { maxRetries: 0 });
  await assert.rejects(mx.account.balances(), NetworkError);
});

test('2xx body with slow stream still delivered (abort must not fire mid-read)', async () => {
  // Simulate a stream that takes a moment to finish. If the SDK aborts the
  // signal before response.text() resolves, the body will be truncated.
  const payload = { data: 'x'.repeat(10_000), ok: true };
  const bodyStr = JSON.stringify(payload);
  const f = async (_url, init) => {
    const stream = new ReadableStream({
      async start(controller) {
        const chunks = [bodyStr.slice(0, 5000), bodyStr.slice(5000)];
        for (const chunk of chunks) {
          if (init?.signal?.aborted) {
            controller.error(new DOMException('aborted', 'AbortError'));
            return;
          }
          controller.enqueue(new TextEncoder().encode(chunk));
          await new Promise((r) => setTimeout(r, 20));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const mx = mkClient(f);
  const result = await mx.client.request({ method: 'GET', path: '/x' });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 10_000);
});

test('GET request signs with empty body hash and correct headers', async () => {
  const f = mkFetch([{ status: 200, body: { balances: [], timestamp: 't' } }]);
  const mx = mkClient(f);
  await mx.account.balances();
  const req = f.calls[0];
  const h = req.init.headers;
  assert.ok(h['MX-API-KEY'], 'missing MX-API-KEY');
  assert.ok(h['MX-SIGNATURE'], 'missing MX-SIGNATURE');
  assert.ok(h['MX-TIMESTAMP'], 'missing MX-TIMESTAMP');
  assert.ok(h['MX-NONCE'], 'missing MX-NONCE');
  assert.equal(req.init.method, 'GET');
  assert.equal(req.init.body, undefined);
  assert.equal(req.init.redirect, 'error');
});

test('POST request signs with body and sets Content-Type', async () => {
  const f = mkFetch([
    {
      status: 200,
      body: {
        quote_id: '550e8400-e29b-41d4-a716-446655440000',
        base: 'BTC',
        quote: 'USD',
        side: 'buy',
        network: 'btc',
        price: '1',
        base_amount: '1',
        quote_amount: '1',
        expires_at: 't',
        expires_in_ms: 30000,
      },
    },
  ]);
  const mx = mkClient(f);
  await mx.rfq.quote({
    base: 'BTC',
    quote: 'USD',
    side: 'buy',
    amount: '0.1',
    amount_type: 'base',
  });
  const req = f.calls[0];
  assert.equal(req.init.method, 'POST');
  assert.equal(req.init.headers['Content-Type'], 'application/json');
  assert.match(req.init.body, /"base":"BTC"/);
});

test('retries on 429 then succeeds', async () => {
  const f = mkFetch([
    { status: 429, body: { error: 'rate_limited', message: 'slow down' }, headers: { 'retry-after': '0' } },
    { status: 200, body: { balances: [], timestamp: 't' } },
  ]);
  const mx = mkClient(f);
  await mx.account.balances();
  assert.equal(f.calls.length, 2);
});

test('retries on 503 then succeeds', async () => {
  const f = mkFetch([
    { status: 503, body: { error: 'service_unavailable', message: 'try again' }, headers: { 'retry-after': '0' } },
    { status: 200, body: { balances: [], timestamp: 't' } },
  ]);
  const mx = mkClient(f, { maxRetries: 2 });
  await mx.account.balances();
  assert.equal(f.calls.length, 2);
});

test('does NOT retry on 400', async () => {
  const f = mkFetch([
    { status: 400, body: { error: 'invalid_parameter', message: 'bad' } },
  ]);
  const mx = mkClient(f);
  await assert.rejects(mx.account.balances(), ValidationError);
  assert.equal(f.calls.length, 1);
});

test('gives up after maxRetries on 429', async () => {
  const f = mkFetch([
    { status: 429, body: { error: 'r', message: 'x' }, headers: { 'retry-after': '0' } },
  ]);
  const mx = mkClient(f, { maxRetries: 2 });
  await assert.rejects(mx.account.balances(), RateLimitError);
  assert.equal(f.calls.length, 3); // initial + 2 retries
});

test('maps each HTTP status to correct error class', async () => {
  const cases = [
    { status: 400, body: { error: 'x', message: 'x' }, err: ValidationError },
    { status: 400, body: { error: 'insufficient_balance', message: 'x' }, err: InsufficientBalanceError },
    { status: 401, body: { error: 'x', message: 'x' }, err: AuthenticationError },
    { status: 403, body: { error: 'x', message: 'x' }, err: PermissionError },
    { status: 404, body: { error: 'x', message: 'x' }, err: NotFoundError },
    { status: 409, body: { error: 'x', message: 'x' }, err: ConflictError },
    { status: 410, body: { error: 'quote_expired_or_not_found', message: 'x' }, err: QuoteExpiredError },
    { status: 429, body: { error: 'x', message: 'x' }, err: RateLimitError },
    { status: 503, body: { error: 'x', message: 'x' }, err: ServiceUnavailableError },
  ];
  for (const c of cases) {
    const f = mkFetch([c]);
    const mx = mkClient(f, { maxRetries: 0 });
    await assert.rejects(mx.account.balances(), c.err, `${c.status} → ${c.err.name}`);
  }
});

test('parses IETF RateLimit-* headers onto success response _meta (server standard)', async () => {
  const f = mkFetch([
    {
      status: 200,
      body: { balances: [], timestamp: 't' },
      headers: {
        'ratelimit-limit': '100',
        'ratelimit-remaining': '99',
        'ratelimit-reset': '60',
        'x-request-id': 'req_abc',
      },
    },
  ]);
  const mx = mkClient(f);
  const r = await mx.account.balances();
  assert.equal(r._meta.rateLimit.limit, 100);
  assert.equal(r._meta.rateLimit.remaining, 99);
  assert.equal(r._meta.rateLimit.reset, 60);
  assert.equal(r._meta.requestId, 'req_abc');
});

test('parses legacy X-RateLimit-* headers as fallback', async () => {
  const f = mkFetch([
    {
      status: 200,
      body: { balances: [], timestamp: 't' },
      headers: {
        'x-ratelimit-limit': '50',
        'x-ratelimit-remaining': '40',
        'x-ratelimit-reset': '30',
      },
    },
  ]);
  const mx = mkClient(f);
  const r = await mx.account.balances();
  assert.equal(r._meta.rateLimit.limit, 50);
  assert.equal(r._meta.rateLimit.remaining, 40);
  assert.equal(r._meta.rateLimit.reset, 30);
});

test('parses rate-limit info into error on 429', async () => {
  const f = mkFetch([
    {
      status: 429,
      body: { error: 'rate_limited', message: 'x' },
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': '10' },
    },
  ]);
  const mx = mkClient(f, { maxRetries: 0 });
  try {
    await mx.account.balances();
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof RateLimitError);
    assert.equal(err.retryAfter, 10_000);
    assert.equal(err.rateLimit.remaining, 0);
  }
});

test('honors Retry-After over default backoff', async () => {
  const start = Date.now();
  const f = mkFetch([
    { status: 429, body: { error: 'r', message: 'x' }, headers: { 'retry-after': '1' } },
    { status: 200, body: { balances: [], timestamp: 't' } },
  ]);
  const mx = mkClient(f, { maxRetries: 1 });
  await mx.account.balances();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 900, `expected ≥1000ms wait, got ${elapsed}ms`);
});

test('network error retry for GET', async () => {
  let calls = 0;
  const f = async () => {
    calls++;
    if (calls < 2) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ balances: [], timestamp: 't' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const mx = mkClient(f, { maxRetries: 1 });
  await mx.account.balances();
  assert.equal(calls, 2);
});

test('network error NO retry for POST without idempotency_key body', async () => {
  let calls = 0;
  const f = async () => {
    calls++;
    throw new TypeError('fetch failed');
  };
  const mx = mkClient(f, { maxRetries: 3 });
  await assert.rejects(
    mx.webhooks.create({
      url: 'https://example.com',
      events: ['trade.executed'],
      label: 'x',
    }),
    NetworkError,
  );
  assert.equal(calls, 1);
});

test('network error DOES retry for POST with idempotency_key', async () => {
  let calls = 0;
  const f = async () => {
    calls++;
    if (calls < 2) throw new TypeError('fetch failed');
    return new Response(
      JSON.stringify({
        trade_id: '550e8400-e29b-41d4-a716-446655440000',
        status: 'filled',
        base: 'BTC',
        quote: 'USD',
        side: 'buy',
        network: 'btc',
        price: '1',
        base_amount: '1',
        quote_amount: '1',
        filled_at: 't',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const mx = mkClient(f, { maxRetries: 2 });
  await mx.rfq.accept('550e8400-e29b-41d4-a716-446655440000', {
    idempotency_key: 'my-key',
  });
  assert.equal(calls, 2);
});

test('timeout throws NetworkError', async () => {
  const f = async (_url, init) => {
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  const mx = mkClient(f, { timeoutMs: 100, maxRetries: 0 });
  await assert.rejects(mx.account.balances(), NetworkError);
});

test('external AbortSignal propagates', async () => {
  const f = async (_url, init) => {
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  const mx = mkClient(f, { maxRetries: 0 });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(
    mx.client.request({ method: 'GET', path: '/account/fees', signal: ac.signal }),
    (err) => err.name === 'AbortError',
  );
});

test('non-JSON response body is handled gracefully', async () => {
  const f = async () =>
    new Response('not json <html>', {
      status: 500,
      headers: { 'content-type': 'text/html' },
    });
  const mx = mkClient(f, { maxRetries: 0 });
  await assert.rejects(mx.account.balances(), (err) => err.status === 500);
});

test('query string is included in signed path', async () => {
  const f = mkFetch([
    { status: 200, body: { balances: [], timestamp: 't' } },
  ]);
  const mx = mkClient(f);
  await mx.account.balances({ currency_type: 'crypto', include_empty: true });
  const urlStr = f.calls[0].url;
  assert.match(urlStr, /currency_type=crypto/);
  assert.match(urlStr, /include_empty=true/);
});

test('inferred environment: mxn_test_ key → sandbox', () => {
  const mx = new Mintarex({ apiKey: 'mxn_test_abc', apiSecret: 's' });
  assert.equal(mx.environment, 'sandbox');
});

test('inferred environment: mxn_live_ key → live', () => {
  const mx = new Mintarex({ apiKey: 'mxn_live_abc', apiSecret: 's' });
  assert.equal(mx.environment, 'live');
});

test('live env + test key → throws', () => {
  assert.throws(
    () =>
      new Mintarex({
        apiKey: 'mxn_test_abc',
        apiSecret: 's',
        environment: 'live',
      }),
    /prefix does not match/,
  );
});

test('path traversal attempts in UUID args rejected before request', async () => {
  const f = mkFetch([{ status: 200, body: {} }]);
  const mx = mkClient(f);
  await assert.rejects(mx.trades.get('../../admin'), ValidationError);
  assert.equal(f.calls.length, 0);
});

test('custom baseURL respected and rejects non-http schemes', () => {
  assert.throws(
    () =>
      new Mintarex({
        apiKey: 'mxn_test_x',
        apiSecret: 's',
        baseURL: 'file:///etc/passwd',
      }),
    /Invalid baseURL/,
  );
});

test('http:// baseURL rejected for public host (prevents key leak over plaintext)', () => {
  assert.throws(
    () =>
      new Mintarex({
        apiKey: 'mxn_test_x',
        apiSecret: 's',
        baseURL: 'http://evil.example.com/v1',
      }),
    /Invalid baseURL/,
  );
});

test('http:// baseURL allowed for localhost (dev/test scenarios)', () => {
  const mx = new Mintarex({
    apiKey: 'mxn_test_x',
    apiSecret: 's',
    baseURL: 'http://localhost:5001/v1',
    fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(mx.client.baseURL.hostname, 'localhost');
});

test('http:// baseURL allowed for 127.0.0.1', () => {
  const mx = new Mintarex({
    apiKey: 'mxn_test_x',
    apiSecret: 's',
    baseURL: 'http://127.0.0.1:5001/v1',
    fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(mx.client.baseURL.hostname, '127.0.0.1');
});

test('Retry-After on 429 error has retryAfter ≤60s (clamped)', async () => {
  const f = mkFetch([
    {
      status: 429,
      body: { error: 'x', message: 'x' },
      headers: { 'retry-after': '3600' }, // 1 hour should be clamped
    },
  ]);
  const mx = mkClient(f, { maxRetries: 0 });
  try {
    await mx.account.balances();
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err.retryAfter <= 60_000, `retryAfter=${err.retryAfter}, expected ≤60000`);
  }
});

test('address_tag must pass validation (not silently truncated)', async () => {
  const mx = mkClient(mkFetch([{ status: 200, body: {} }]));
  await assert.rejects(
    mx.crypto.withdraw({
      coin: 'BTC',
      network: 'btc',
      amount: '0.1',
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      address_tag: 'x'.repeat(200), // over 100, must reject
      idempotency_key: 'k1',
    }),
    ValidationError,
  );
});

test('Stream: close() during token fetch prevents emit("open") after close', async () => {
  let tokenFetchAborted = false;
  const f = async (_url, init) => {
    return await new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        tokenFetchAborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
      // never resolve — simulates slow token endpoint
    });
  };
  const mx = mkClient(f);
  const events = [];
  const stream = mx.streams.account();
  stream.on('open', () => events.push('open'));
  stream.on('close', () => events.push('close'));
  stream.on('error', () => {});
  // Close immediately while fetchToken is hanging
  await new Promise((r) => setTimeout(r, 10));
  stream.close();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!events.includes('open'), `open should not fire after close, got ${events.join(',')}`);
  assert.ok(events.includes('close'), 'close should fire');
  assert.ok(tokenFetchAborted, 'token fetch should be aborted by close()');
});

test('circular-reference body throws ConfigurationError (not unhandled)', async () => {
  const mx = mkClient(mkFetch([{ status: 200, body: {} }]));
  const circular = {};
  circular.self = circular;
  await assert.rejects(
    mx.client.request({ method: 'POST', path: '/x', body: circular }),
    /JSON-serializable/,
  );
});

test('amount regex caps integer digits at 30', async () => {
  const mx = mkClient(mkFetch([{ status: 200, body: {} }]));
  await assert.rejects(
    mx.rfq.quote({
      base: 'BTC',
      quote: 'USD',
      side: 'buy',
      amount: '1' + '0'.repeat(31), // 32 digits
      amount_type: 'base',
    }),
    ValidationError,
  );
});
