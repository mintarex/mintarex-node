import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, Mintarex } from '../dist/index.js';

// We use the resource methods to hit validators without network.
// Since validators throw synchronously before request(), we catch before fetch.

function makeClient() {
  return new Mintarex({
    apiKey: 'mxn_test_abc123',
    apiSecret: 'secret',
    fetch: async () => {
      throw new Error('network should not be reached');
    },
  });
}

test('amount regex rejects sign, scientific, too-many-decimals', async () => {
  const mx = makeClient();
  for (const bad of ['-1', '+1', '1e3', '1.1234567890123456789', 'abc', '', '01']) {
    await assert.rejects(
      mx.rfq.quote({
        base: 'BTC',
        quote: 'USD',
        side: 'buy',
        amount: bad,
        amount_type: 'base',
      }),
      ValidationError,
      `should reject amount=${bad}`,
    );
  }
});

test('amount regex accepts canonical decimals', async () => {
  const mx = makeClient();
  for (const good of ['0', '1', '0.5', '1.123456789012345678', '1000000']) {
    await assert.rejects(
      mx.rfq.quote({
        base: 'BTC',
        quote: 'USD',
        side: 'buy',
        amount: good,
        amount_type: 'base',
      }),
      /network should not be reached/,
      `should accept amount=${good}`,
    );
  }
});

test('coin regex rejects lowercase / short / long / bad chars', async () => {
  const mx = makeClient();
  for (const bad of ['btc', 'B', 'TOOLONGCOIN123', '', 'BT-C', 'BTC_ETH']) {
    await assert.rejects(
      mx.crypto.depositAddress({ coin: bad }),
      ValidationError,
      `should reject coin=${bad}`,
    );
  }
});

test('coin regex accepts digit-leading tickers (1INCH, 2Z)', async () => {
  const mx = makeClient();
  for (const good of ['1INCH', '2Z', 'BTC', 'USDT', 'WBTC']) {
    await assert.rejects(
      mx.crypto.depositAddress({ coin: good }),
      /network should not be reached/,
      `should accept coin=${good}`,
    );
  }
});

test('network regex rejects uppercase/invalid chars', async () => {
  const mx = makeClient();
  for (const bad of ['BTC', 'btc/eth', 'a'.repeat(41), '']) {
    await assert.rejects(
      mx.crypto.depositAddress({ coin: 'BTC', network: bad }),
      ValidationError,
    );
  }
});

test('address regex rejects too-short / too-long / bad chars', async () => {
  const mx = makeClient();
  for (const bad of ['abc', 'a'.repeat(256), 'has space', 'has\n', '']) {
    await assert.rejects(
      mx.crypto.withdraw({
        coin: 'BTC',
        network: 'btc',
        amount: '0.1',
        address: bad,
        idempotency_key: 'k1',
      }),
      ValidationError,
    );
  }
});

test('UUID regex rejects non-UUID', async () => {
  const mx = makeClient();
  for (const bad of [
    'not-a-uuid',
    '12345678-1234-1234-1234-123456789012x',
    '',
    '../../etc/passwd',
  ]) {
    await assert.rejects(mx.rfq.accept(bad), ValidationError);
  }
});

test('idempotency_key: accepts generated UUID when omitted', async () => {
  const mx = makeClient();
  // omitting idempotency_key should auto-generate and proceed to fetch
  await assert.rejects(
    mx.rfq.accept('550e8400-e29b-41d4-a716-446655440000'),
    /network should not be reached/,
  );
});

test('webhook URL rejects http:// and credentials', async () => {
  const mx = makeClient();
  for (const bad of [
    'http://example.com',
    'https://user:pass@example.com/hook',
    'not a url',
    'https://' + 'a'.repeat(3000),
  ]) {
    await assert.rejects(
      mx.webhooks.create({ url: bad, events: ['trade.executed'], label: 'x' }),
      ValidationError,
    );
  }
});

test('webhook events validation', async () => {
  const mx = makeClient();
  await assert.rejects(
    mx.webhooks.create({ url: 'https://example.com', events: [], label: 'x' }),
    ValidationError,
  );
  await assert.rejects(
    mx.webhooks.create({ url: 'https://example.com', events: ['BAD'], label: 'x' }),
    ValidationError,
  );
});

test('Mintarex constructor rejects missing/invalid keys', () => {
  assert.throws(() => new Mintarex({}), /apiKey is required/);
  assert.throws(
    () => new Mintarex({ apiKey: 'k', apiSecret: 's' }),
    /apiKey must start with/,
  );
  assert.throws(
    () =>
      new Mintarex({
        apiKey: 'mxn_live_abc',
        apiSecret: 's',
        environment: 'sandbox',
      }),
    /prefix does not match/,
  );
});
