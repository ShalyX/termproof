import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpAdapter } from '../src/adapters/http.ts';
import type { HttpStep } from '../src/core/types.ts';

function step(id: string, operation: HttpStep['operation'], expected: string, url = 'https://service.example/health'): HttpStep {
  return {
    id,
    claimId: `${id}-claim`,
    adapter: 'http',
    operation,
    params: { url, expected },
  };
}

test('identical HTTP requests share one retried observation across all assertions', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient timeout');
      return new Response(JSON.stringify({ ok: true, service: 'mandate' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const results = await adapter.executeMany([
    step('status', 'status_matches', '200'),
    step('json', 'json_valid', 'true'),
    step('ok', 'json_field_matches', 'ok=true'),
    step('service', 'json_field_matches', 'service="mandate"'),
  ]);

  assert.equal(calls, 2);
  assert.equal(results.size, 4);
  assert.deepEqual([...results.values()].map((result) => result.result), ['PASS', 'PASS', 'PASS', 'PASS']);
  const evidence = [...results.values()].map((result) => result.evidence);
  assert.equal(new Set(evidence.map((item) => item.observationId)).size, 1);
  assert.equal(new Set(evidence.map((item) => item.requestFingerprint)).size, 1);
  assert.equal(new Set(evidence.map((item) => item.observationRawHash)).size, 1);
});

test('a terminal observation outage makes every dependent assertion INCONCLUSIVE', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('upstream unavailable');
    },
  });

  const results = await adapter.executeMany([
    step('status', 'status_matches', '200'),
    step('json', 'json_valid', 'true'),
    step('field', 'json_field_matches', 'ok=true'),
  ]);

  assert.equal(calls, 2);
  assert.deepEqual([...results.values()].map((result) => result.result), ['INCONCLUSIVE', 'INCONCLUSIVE', 'INCONCLUSIVE']);
  assert.equal(new Set([...results.values()].map((result) => result.evidence.observationId)).size, 1);
});

test('materially different HTTP requests do not share an observation', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async (url) => {
      calls += 1;
      return new Response(JSON.stringify({ url: String(url) }), { status: 200 });
    },
  });

  const results = await adapter.executeMany([
    step('same-url-status', 'status_matches', '200'),
    step('different-url-status', 'status_matches', '200', 'https://service.example/other'),
  ]);

  assert.equal(calls, 2);
  assert.equal(new Set([...results.values()].map((result) => result.evidence.observationId)).size, 2);
});

test('method, headers, and body changes produce distinct request fingerprints', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('ok', { status: 200 });
    },
  });
  const first = step('get', 'status_matches', '200');
  const second = { ...step('post', 'status_matches', '200'), params: { ...step('post', 'status_matches', '200').params, request: { method: 'POST', headers: { 'X-Test': 'two' }, body: '{"mode":"write"}' } } };
  const results = await adapter.executeMany([first, second]);

  assert.equal(calls, 2);
  assert.notEqual(results.get('get')?.evidence.requestFingerprint, results.get('post')?.evidence.requestFingerprint);
});

test('resumed HTTP evidence is a fresh immutable point-in-time observation', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  const first = await adapter.execute(step('first', 'json_field_matches', 'ok=true'));
  const second = await adapter.execute(step('second', 'json_field_matches', 'ok=true'));

  assert.notEqual(first.evidence.observationId, second.evidence.observationId);
  assert.equal(first.evidence.requestFingerprint, second.evidence.requestFingerprint);
  assert.notEqual(first.evidence.observedAt, undefined);
});
