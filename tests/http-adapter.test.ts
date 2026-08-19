import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpAdapter } from '../src/adapters/http.ts';

test('HTTP status verification returns PASS with reproducible evidence', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'manual');
      return new Response('healthy', { status: 200, headers: { 'content-type': 'text/plain' } });
    },
    now: () => new Date('2026-08-15T00:00:00Z'),
  });

  const result = await adapter.execute({
    id: 'http-step-1',
    claimId: 'http-claim-1',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://service.example/health', expected: '200' },
  });

  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.adapter, 'http');
  assert.equal(result.evidence.source, 'https://service.example/health');
  assert.equal(result.evidence.extractedFacts.status, 200);
  assert.match(result.evidence.rawHash, /^[a-f0-9]{64}$/);
});

test('HTTP verifier rejects private or credentialed URLs before making a request', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('unexpected', { status: 200 });
    },
  });

  const result = await adapter.execute({
    id: 'http-step-private',
    claimId: 'http-claim-private',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'http://127.0.0.1:8080/health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(calls, 0);
  assert.equal(result.evidence.extractedFacts.error, 'invalid_url');
});

test('HTTP verifier rejects DNS aliases that resolve to private targets before making a request', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({ fetchImpl: async () => { calls += 1; return new Response('', { status: 200 }); } });
  const result = await adapter.execute({ id: 's-dns', claimId: 'c-dns', adapter: 'http', operation: 'status_matches', params: { url: 'https://127.0.0.1.nip.io/health', expected: '200' } });
  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(calls, 0);
});

test('HTTP verifier classifies malformed URLs as invalid input', async () => {
  const adapter = new HttpAdapter({ fetchImpl: async () => new Response('unexpected', { status: 200 }) });
  const result = await adapter.execute({
    id: 'http-step-malformed',
    claimId: 'http-claim-malformed',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'not a url', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_url');
});

test('HTTP verifier rejects IPv6 loopback targets before making a request', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('unexpected', { status: 200 });
    },
  });
  const result = await adapter.execute({
    id: 'http-step-ipv6-loopback',
    claimId: 'http-claim-ipv6-loopback',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://[::1]/health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_url');
  assert.equal(calls, 0);
});

test('HTTP verifier rejects IPv4-mapped IPv6 private targets', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('unexpected', { status: 200 });
    },
  });
  const result = await adapter.execute({
    id: 'http-step-mapped-ip',
    claimId: 'http-claim-mapped-ip',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://[::ffff:127.0.0.1]/health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_url');
  assert.equal(calls, 0);
});

test('HTTP verifier rejects private IPv4 targets written with a trailing dot', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('unexpected', { status: 200 });
    },
  });
  const result = await adapter.execute({
    id: 'http-step-trailing-dot',
    claimId: 'http-claim-trailing-dot',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://127.0.0.1./health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_url');
  assert.equal(calls, 0);
});

test('HTTP upstream failure is INCONCLUSIVE rather than a deterministic FAIL', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response('upstream unavailable', { status: 503 }),
  });

  const result = await adapter.execute({
    id: 'http-step-outage',
    claimId: 'http-claim-outage',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://service.example/health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.status, 503);
});

test('HTTP timeout is recorded as INCONCLUSIVE', async () => {
  const adapter = new HttpAdapter({
    timeoutMs: 1,
    fetchImpl: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  });

  const result = await adapter.execute({
    id: 'http-step-timeout',
    claimId: 'http-claim-timeout',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://service.example/health', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'timeout');
});

test('HTTP body verification records the observed body and passes on an exact claim', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response('release: 2.4.1 ready', { status: 200, headers: { 'content-type': 'text/plain' } }),
  });

  const result = await adapter.execute({
    id: 'http-step-body',
    claimId: 'http-claim-body',
    adapter: 'http',
    operation: 'body_contains',
    params: { url: 'https://service.example/version', expected: '2.4.1' },
  });

  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.extractedFacts.status, 200);
  assert.equal(result.evidence.extractedFacts.bodyContains, true);
  assert.equal((result.evidence.raw as { body: string }).body, 'release: 2.4.1 ready');
});

test('HTTP redirects are not treated as failed content or followed implicitly', async () => {
  let requestedUrl = '';
  let redirectMode: RequestRedirect | undefined;
  const adapter = new HttpAdapter({
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      redirectMode = init?.redirect;
      return new Response('', { status: 302, headers: { location: 'https://private.example/secret' } });
    },
  });

  const result = await adapter.execute({
    id: 'http-step-redirect',
    claimId: 'http-claim-redirect',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://service.example/redirect', expected: '200' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(redirectMode, 'manual');
  assert.equal(requestedUrl, 'https://service.example/redirect');
  assert.equal(result.evidence.extractedFacts.status, 302);
});

test('HTTP status verifier rejects a non-numeric expected status as inconclusive input', async () => {
  let calls = 0;
  const adapter = new HttpAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('healthy', { status: 200 });
    },
  });
  const result = await adapter.execute({
    id: 'http-step-bad-status',
    claimId: 'http-claim-bad-status',
    adapter: 'http',
    operation: 'status_matches',
    params: { url: 'https://service.example/health', expected: 'two hundred' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_expected_status');
  assert.equal(calls, 0);
});

test('HTTP body verification does not let an error page satisfy a positive body claim', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response('release: 2.4.1 ready', { status: 404 }),
  });
  const result = await adapter.execute({
    id: 'http-step-error-body',
    claimId: 'http-claim-error-body',
    adapter: 'http',
    operation: 'body_contains',
    params: { url: 'https://service.example/version', expected: '2.4.1' },
  });

  assert.equal(result.result, 'FAIL');
});

test('HTTP JSON verification proves valid JSON and exact top-level fields', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ protocol: 'Prooflet', ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  const valid = await adapter.execute({
    id: 'http-step-json-valid',
    claimId: 'http-claim-json-valid',
    adapter: 'http',
    operation: 'json_valid',
    params: { url: 'https://prooflet-api.onrender.com/health', expected: 'true' },
  });
  const field = await adapter.execute({
    id: 'http-step-json-field',
    claimId: 'http-claim-json-field',
    adapter: 'http',
    operation: 'json_field_matches',
    params: { url: 'https://prooflet-api.onrender.com/health', expected: 'protocol=Prooflet' },
  });

  assert.equal(valid.result, 'PASS');
  assert.equal(valid.evidence.extractedFacts.jsonValid, true);
  assert.equal(field.result, 'PASS');
  assert.equal(field.evidence.extractedFacts.jsonField, 'protocol');
  assert.equal(field.evidence.extractedFacts.observedValue, 'Prooflet');
});

test('HTTP JSON verification classifies malformed JSON as a deterministic FAIL, not PASS', async () => {
  const adapter = new HttpAdapter({
    fetchImpl: async () => new Response('{"protocol":', { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  const result = await adapter.execute({
    id: 'http-step-json-malformed',
    claimId: 'http-claim-json-malformed',
    adapter: 'http',
    operation: 'json_valid',
    params: { url: 'https://service.example/health', expected: 'true' },
  });

  assert.equal(result.result, 'FAIL');
  assert.equal(result.evidence.extractedFacts.jsonValid, false);
  assert.equal(result.evidence.extractedFacts.error, 'invalid_json');
});

test('HTTP body truncation is INCONCLUSIVE even when the expected text appears early', async () => {
  const adapter = new HttpAdapter({
    maxBodyBytes: 16,
    fetchImpl: async () => new Response('expected-but-incomplete-' + 'x'.repeat(100), { status: 200 }),
  });

  const result = await adapter.execute({
    id: 'http-step-oversized',
    claimId: 'http-claim-oversized',
    adapter: 'http',
    operation: 'body_contains',
    params: { url: 'https://service.example/health', expected: 'expected' },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.truncated, true);
});
