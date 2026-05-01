import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhook, WebhookSignatureError } from '../dist/index.js';

const SECRET = 'mtxhook_test_fixture_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function signPayload(timestamp, body, secret = SECRET) {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function realHeaders(ts, sig, overrides = {}) {
  return {
    'x-mintarex-signature': sig,
    'x-mintarex-timestamp': ts,
    'x-mintarex-event-type': 'trade.executed',
    'x-mintarex-event-id': 'evt_abc',
    'x-mintarex-delivery-id': 'dlv_xyz',
    ...overrides,
  };
}

test('verifyWebhook accepts valid signature and reads metadata from headers', () => {
  // Real wire format: body is `{...data, timestamp}` — flat, no event_type/id
  const body = JSON.stringify({
    timestamp: '2026-01-01T00:00:00Z',
    trade_id: 't_123',
    base: 'BTC',
    quote: 'USD',
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const event = verifyWebhook({
    body,
    headers: realHeaders(ts, signPayload(ts, body)),
    secret: SECRET,
  });
  assert.equal(event.event_type, 'trade.executed');
  assert.equal(event.event_id, 'evt_abc');
  assert.equal(event.delivery_uuid, 'dlv_xyz');
  assert.equal(event.timestamp, '2026-01-01T00:00:00Z');
  assert.equal(event.sandbox, false);
  assert.deepEqual(event.data, { trade_id: 't_123', base: 'BTC', quote: 'USD' });
});

test('verifyWebhook surfaces sandbox flag when present', () => {
  const body = JSON.stringify({
    timestamp: '2026-01-01T00:00:00Z',
    sandbox: true,
    trade_id: 't_999',
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const event = verifyWebhook({
    body,
    headers: realHeaders(ts, signPayload(ts, body)),
    secret: SECRET,
  });
  assert.equal(event.sandbox, true);
  assert.deepEqual(event.data, { trade_id: 't_999' });
});

test('verifyWebhook rejects tampered body', () => {
  const body = '{"timestamp":"2026-01-01T00:00:00Z","trade_id":"t_1"}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signPayload(ts, body);
  assert.throws(
    () =>
      verifyWebhook({
        body: body.replace('t_1', 't_2'),
        headers: realHeaders(ts, sig),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});

test('verifyWebhook rejects wrong secret', () => {
  const body = '{"timestamp":"t","trade_id":"x"}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signPayload(ts, body, 'mtxhook_test_other_key_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(ts, sig),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});

test('verifyWebhook rejects stale timestamp beyond tolerance', () => {
  const body = '{"timestamp":"t"}';
  const old = Math.floor(Date.now() / 1000) - 600;
  const sig = signPayload(old.toString(), body);
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(old.toString(), sig),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});

test('verifyWebhook rejects future timestamp beyond tolerance', () => {
  const body = '{"timestamp":"t"}';
  const future = Math.floor(Date.now() / 1000) + 600;
  const sig = signPayload(future.toString(), body);
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(future.toString(), sig),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});

test('verifyWebhook respects custom tolerance', () => {
  const body = '{"timestamp":"t"}';
  const old = Math.floor(Date.now() / 1000) - 900;
  const sig = signPayload(old.toString(), body);
  const event = verifyWebhook({
    body,
    headers: realHeaders(old.toString(), sig),
    secret: SECRET,
    toleranceSeconds: 1000,
  });
  assert.equal(event.event_type, 'trade.executed');
});

test('verifyWebhook rejects missing signature header', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const h = realHeaders(ts, 'v1=' + 'a'.repeat(64));
  delete h['x-mintarex-signature'];
  assert.throws(
    () => verifyWebhook({ body, headers: h, secret: SECRET }),
    /Missing X-Mintarex-Signature/,
  );
});

test('verifyWebhook rejects missing timestamp header', () => {
  const body = '{}';
  const h = realHeaders('', 'v1=' + 'a'.repeat(64));
  delete h['x-mintarex-timestamp'];
  assert.throws(
    () => verifyWebhook({ body, headers: h, secret: SECRET }),
    /Missing X-Mintarex-Timestamp/,
  );
});

test('verifyWebhook rejects missing event-type header', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const h = realHeaders(ts, signPayload(ts, body));
  delete h['x-mintarex-event-type'];
  assert.throws(
    () => verifyWebhook({ body, headers: h, secret: SECRET }),
    /Missing X-Mintarex-Event-Type/,
  );
});

test('verifyWebhook rejects missing event-id header', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const h = realHeaders(ts, signPayload(ts, body));
  delete h['x-mintarex-event-id'];
  assert.throws(
    () => verifyWebhook({ body, headers: h, secret: SECRET }),
    /Missing X-Mintarex-Event-Id/,
  );
});

test('verifyWebhook rejects missing delivery-id header', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const h = realHeaders(ts, signPayload(ts, body));
  delete h['x-mintarex-delivery-id'];
  assert.throws(
    () => verifyWebhook({ body, headers: h, secret: SECRET }),
    /Missing X-Mintarex-Delivery-Id/,
  );
});

test('verifyWebhook rejects sig without v1= prefix', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(ts, 'a'.repeat(64)),
        secret: SECRET,
      }),
    /v1=/,
  );
});

test('verifyWebhook rejects non-hex signature', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(ts, 'v1=' + 'z'.repeat(64)),
        secret: SECRET,
      }),
    /not a 64-char hex/,
  );
});

test('verifyWebhook works with Headers object', () => {
  const body = '{"timestamp":"t","x":1}';
  const ts = Math.floor(Date.now() / 1000).toString();
  const h = new Headers();
  h.set('X-Mintarex-Signature', signPayload(ts, body));
  h.set('X-Mintarex-Timestamp', ts);
  h.set('X-Mintarex-Event-Type', 'trade.executed');
  h.set('X-Mintarex-Event-Id', 'evt_h');
  h.set('X-Mintarex-Delivery-Id', 'dlv_h');
  const ev = verifyWebhook({ body, headers: h, secret: SECRET });
  assert.equal(ev.event_type, 'trade.executed');
});

test('verifyWebhook works with Buffer body', () => {
  const bodyStr = '{"timestamp":"t","x":1}';
  const body = Buffer.from(bodyStr);
  const ts = Math.floor(Date.now() / 1000).toString();
  const ev = verifyWebhook({
    body,
    headers: realHeaders(ts, signPayload(ts, bodyStr)),
    secret: SECRET,
  });
  assert.equal(ev.event_type, 'trade.executed');
});

test('verifyWebhook rejects invalid JSON body even with valid sig', () => {
  const bodyStr = 'not json';
  const ts = Math.floor(Date.now() / 1000).toString();
  assert.throws(
    () =>
      verifyWebhook({
        body: bodyStr,
        headers: realHeaders(ts, signPayload(ts, bodyStr)),
        secret: SECRET,
      }),
    /not valid JSON/,
  );
});

test('verifyWebhook rejects array body (must be object)', () => {
  const bodyStr = '[1,2,3]';
  const ts = Math.floor(Date.now() / 1000).toString();
  assert.throws(
    () =>
      verifyWebhook({
        body: bodyStr,
        headers: realHeaders(ts, signPayload(ts, bodyStr)),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});

test('verifyWebhook rejects empty secret', () => {
  assert.throws(
    () =>
      verifyWebhook({
        body: '{}',
        headers: {},
        secret: '',
      }),
    /secret is required/,
  );
});

test('verifyWebhook constant-time against signature of different length', () => {
  const body = '{}';
  const ts = Math.floor(Date.now() / 1000).toString();
  assert.throws(
    () =>
      verifyWebhook({
        body,
        headers: realHeaders(ts, 'v1=abc'),
        secret: SECRET,
      }),
    WebhookSignatureError,
  );
});
