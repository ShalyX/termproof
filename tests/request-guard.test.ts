import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestId, RateLimiter } from '../src/core/request-guard.ts';

test('request IDs accept safe caller values and replace control characters', () => {
  assert.equal(createRequestId('trace-123'), 'trace-123');
  assert.match(createRequestId('bad id\n'), /^[A-Za-z0-9._:-]+$/);
});

test('rate limiter denies excess requests in a bounded window', () => {
  const limiter = new RateLimiter({ max: 2, windowMs: 1_000, now: () => 100 });
  assert.equal(limiter.allow('anonymous'), true);
  assert.equal(limiter.allow('anonymous'), true);
  assert.equal(limiter.allow('anonymous'), false);
});
