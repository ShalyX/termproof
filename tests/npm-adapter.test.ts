import assert from 'node:assert/strict';
import test from 'node:test';
import { NpmAdapter } from '../src/adapters/npm.ts';
import type { NpmStep } from '../src/core/types.ts';

function step(operation: NpmStep['operation'], expected: string | null = null): NpmStep {
  return { id: `npm-${operation}`, claimId: 'npm-claim', adapter: 'npm', operation, params: { packageName: 'demo-package', expected, repository: 'https://github.com/acme/demo-package' } };
}

function adapter(payload: unknown, status = 200, calls: string[] = []) {
  return new NpmAdapter({ fetchImpl: async (url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); }, now: () => new Date('2026-08-15T00:00:00.000Z') });
}

const packageMetadata = {
  name: 'demo-package',
  'dist-tags': { latest: '1.2.3' },
  versions: {
    '1.2.3': { version: '1.2.3', repository: { type: 'git', url: 'git+https://github.com/acme/demo-package.git' }, dist: { tarball: 'https://registry.npmjs.org/demo-package/-/demo-package-1.2.3.tgz', integrity: 'sha512-demo' } },
  },
};

test('npm package existence emits reproducible registry evidence without installing anything', async () => {
  const calls: string[] = [];
  const result = await adapter(packageMetadata, 200, calls).execute(step('package_exists'));
  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.adapter, 'npm');
  assert.equal(result.evidence.source, 'https://registry.npmjs.org/demo-package');
  assert.equal(result.evidence.revision, '1.2.3');
  assert.equal(result.evidence.extractedFacts.packageName, 'demo-package');
  assert.equal(result.evidence.rawHash.length, 64);
  assert.deepEqual(calls, ['GET https://registry.npmjs.org/demo-package']);
});

test('npm exact version and repository metadata checks pass from a selected version', async () => {
  const exact = await adapter(packageMetadata).execute(step('version_matches', '1.2.3'));
  const repository = await adapter(packageMetadata).execute(step('metadata_matches', 'https://github.com/acme/demo-package'));
  const distribution = await adapter(packageMetadata).execute(step('distribution_metadata', '1.2.3'));
  assert.equal(exact.result, 'PASS');
  assert.equal(repository.result, 'PASS');
  assert.equal(distribution.result, 'PASS');
  assert.equal(distribution.evidence.extractedFacts.integrity, 'sha512-demo');
});

test('missing npm package or version is a deterministic FAIL', async () => {
  const missingPackage = await adapter({ error: 'not_found' }, 404).execute(step('package_exists'));
  const missingVersion = await adapter(packageMetadata).execute(step('version_matches', '9.9.9'));
  assert.equal(missingPackage.result, 'FAIL');
  assert.equal(missingVersion.result, 'FAIL');
});

test('npm outage and malformed responses are INCONCLUSIVE', async () => {
  const outage = await adapter({ error: 'busy' }, 503).execute(step('package_exists'));
  const malformed = await adapter('{not-json').execute(step('package_exists'));
  assert.equal(outage.result, 'INCONCLUSIVE');
  assert.equal(malformed.result, 'INCONCLUSIVE');
});

test('npm registry redirects are not followed and remain INCONCLUSIVE', async () => {
  const calls: string[] = [];
  let redirectMode: RequestRedirect | undefined;
  const npm = new NpmAdapter({
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      redirectMode = init?.redirect;
      return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/package' } });
    },
  });

  const result = await npm.execute(step('package_exists'));

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(redirectMode, 'manual');
  assert.deepEqual(calls, ['https://registry.npmjs.org/demo-package']);
  assert.equal(result.evidence.extractedFacts.status, 302);
});

test('npm response-size limits remain bounded and classify oversized metadata as INCONCLUSIVE', async () => {
  const npm = new NpmAdapter({ maxResponseBytes: 32, fetchImpl: async () => new Response(JSON.stringify({ name: 'demo-package', padding: 'x'.repeat(100) }), { status: 200 }) });
  const result = await npm.execute(step('package_exists'));
  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'response_too_large');
});

test('npm adapter rejects package-name traversal and never follows a caller URL', async () => {
  let calls = 0;
  const npm = new NpmAdapter({ fetchImpl: async () => { calls += 1; return new Response('{}'); } });
  const malicious: NpmStep = { ...step('package_exists'), params: { packageName: '../secret', expected: null, repository: null } };
  const result = await npm.execute(malicious);
  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(calls, 0);
  assert.equal(result.evidence.extractedFacts.error, 'invalid_package_name');
});
