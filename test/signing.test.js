import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sign,
  buildCanonicalString,
  sha256Hex,
  hmacSign,
} from '../dist/signing.js';
import { EMPTY_BODY_SHA256 } from '../dist/signing.js';

test('EMPTY_BODY_SHA256 matches SHA-256 of empty string', () => {
  assert.equal(sha256Hex(''), EMPTY_BODY_SHA256);
});

test('canonical string format matches spec (METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nHASH)', () => {
  const s = buildCanonicalString({
    method: 'GET',
    path: '/v1/account/balances',
    timestamp: '1712582345',
    nonce: '550e8400-e29b-41d4-a716-446655440000',
    bodyHash: EMPTY_BODY_SHA256,
  });
  assert.equal(
    s,
    'GET\n/v1/account/balances\n1712582345\n550e8400-e29b-41d4-a716-446655440000\n' +
      EMPTY_BODY_SHA256,
  );
});

test('canonical string uppercases method', () => {
  const s = buildCanonicalString({
    method: 'post',
    path: '/v1/rfq',
    timestamp: '1',
    nonce: 'n',
    bodyHash: 'h',
  });
  assert.ok(s.startsWith('POST\n'));
});

test('hmacSign returns 64-char lowercase hex', () => {
  const sig = hmacSign('secret', 'hello');
  assert.match(sig, /^[0-9a-f]{64}$/);
});

test('sign produces all four required headers with correct shape', () => {
  const h = sign({
    apiKey: 'mxn_live_abc',
    apiSecret: 'deadbeef',
    method: 'GET',
    path: '/v1/account/fees',
    timestamp: '1712582345',
    nonce: '550e8400-e29b-41d4-a716-446655440000',
  });
  assert.equal(h['MX-API-KEY'], 'mxn_live_abc');
  assert.equal(h['MX-TIMESTAMP'], '1712582345');
  assert.equal(h['MX-NONCE'], '550e8400-e29b-41d4-a716-446655440000');
  assert.match(h['MX-SIGNATURE'], /^[0-9a-f]{64}$/);
});

test('sign is deterministic for same inputs', () => {
  const args = {
    apiKey: 'mxn_live_abc',
    apiSecret: 'secret',
    method: 'POST',
    path: '/v1/rfq',
    body: '{"base":"BTC","quote":"USD"}',
    timestamp: '1000',
    nonce: 'nnn',
  };
  assert.equal(sign(args)['MX-SIGNATURE'], sign(args)['MX-SIGNATURE']);
});

test('sign differs when any signed input changes', () => {
  const base = {
    apiKey: 'mxn_live_abc',
    apiSecret: 's',
    method: 'POST',
    path: '/v1/rfq',
    body: 'x',
    timestamp: '1',
    nonce: 'n',
  };
  const a = sign(base);
  const b = sign({ ...base, method: 'GET' });
  const c = sign({ ...base, path: '/v1/other' });
  const d = sign({ ...base, timestamp: '2' });
  const e = sign({ ...base, nonce: 'n2' });
  const f = sign({ ...base, body: 'y' });
  const g = sign({ ...base, apiSecret: 's2' });
  const uniq = new Set([
    a['MX-SIGNATURE'],
    b['MX-SIGNATURE'],
    c['MX-SIGNATURE'],
    d['MX-SIGNATURE'],
    e['MX-SIGNATURE'],
    f['MX-SIGNATURE'],
    g['MX-SIGNATURE'],
  ]);
  assert.equal(uniq.size, 7);
});

test('sign handles Buffer/Uint8Array body', () => {
  const str = sign({
    apiKey: 'k',
    apiSecret: 's',
    method: 'POST',
    path: '/p',
    body: 'hello',
    timestamp: '1',
    nonce: 'n',
  });
  const buf = sign({
    apiKey: 'k',
    apiSecret: 's',
    method: 'POST',
    path: '/p',
    body: Buffer.from('hello'),
    timestamp: '1',
    nonce: 'n',
  });
  assert.equal(str['MX-SIGNATURE'], buf['MX-SIGNATURE']);
});

test('sign with empty body uses EMPTY_BODY_SHA256', () => {
  const canonical = buildCanonicalString({
    method: 'GET',
    path: '/v1/account/fees',
    timestamp: '1',
    nonce: 'n',
    bodyHash: EMPTY_BODY_SHA256,
  });
  const expected = hmacSign('secret', canonical);
  const actual = sign({
    apiKey: 'k',
    apiSecret: 'secret',
    method: 'GET',
    path: '/v1/account/fees',
    timestamp: '1',
    nonce: 'n',
  });
  assert.equal(actual['MX-SIGNATURE'], expected);
});
