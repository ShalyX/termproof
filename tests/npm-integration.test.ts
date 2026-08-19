import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseAdapter } from '../src/adapters/base.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { HttpAdapter } from '../src/adapters/http.ts';
import { NpmAdapter } from '../src/adapters/npm.ts';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import { FixturePlanner } from './fixtures/planner.ts';

function makeOrchestrator(npmPayload: unknown, npmStatus = 200) {
  return new VerificationOrchestrator({
    planner: new FixturePlanner(),
    github: new GitHubAdapter({ fetchImpl: async () => new Response(JSON.stringify({ license: { spdx_id: 'MIT', name: 'MIT License' }, sha: 'license-sha' }), { status: 200 }) }),
    http: new HttpAdapter({ fetchImpl: async () => new Response('healthy', { status: 200 }) }),
    base: new BaseAdapter({ rpcUrls: { base: 'https://base.example/rpc', 'base-sepolia': 'https://base-sepolia.example/rpc' }, fetchImpl: async (url, init) => { const request = JSON.parse(String(init?.body)) as { method: string }; const chainId = String(url).includes('sepolia') ? '0x14a34' : '0x2105'; return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: request.method === 'eth_chainId' ? chainId : '0x6000' }), { status: 200 }); } }),
    npm: new NpmAdapter({ fetchImpl: async () => new Response(JSON.stringify(npmPayload), { status: npmStatus }) }),
  });
}

const metadata = { name: 'demo-package', 'dist-tags': { latest: '1.2.3' }, versions: { '1.2.3': { version: '1.2.3', repository: { url: 'git+https://github.com/acme/demo-package.git' }, dist: { tarball: 'https://registry.npmjs.org/demo-package/-/demo-package-1.2.3.tgz', integrity: 'sha512-demo' } } } };
const goldenMetadata = { name: 'nanoid', 'dist-tags': { latest: '6.0.1' }, versions: { '5.1.5': { version: '5.1.5', repository: { url: 'git+https://github.com/ai/nanoid.git' }, dist: { tarball: 'https://registry.npmjs.org/nanoid/-/nanoid-5.1.5.tgz', integrity: 'sha512-golden' }, }, '6.0.1': { version: '6.0.1', repository: { url: 'git+https://github.com/ai/nanoid.git' }, dist: { tarball: 'https://registry.npmjs.org/nanoid/-/nanoid-6.0.1.tgz', integrity: 'sha512-latest' } } } };
const goldenMilestone = 'Repository uses MIT license; HTTP endpoint https://registry.npmjs.org/nanoid returns 201; Base sepolia contract 0x4200000000000000000000000000000000000006 is deployed; npm package nanoid exists version 5.1.5 repository https://github.com/ai/nanoid and has integrity metadata.';

test('planner and orchestrator autonomously route one milestone across GitHub, HTTP, Base, and npm', async () => {
  const orchestrator = makeOrchestrator(metadata);
  const run = await orchestrator.verify({ milestone: 'Repository uses MIT; HTTP endpoint https://service.example/health returns 200; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed; npm package demo-package exists version 1.2.3 repository https://github.com/acme/demo-package and has integrity metadata.', githubRepository: 'https://github.com/acme/widget' });
  assert.equal(run.verdict, 'VERIFIED');
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base', 'npm']));
  assert.equal(run.claims.some((claim) => claim.statement.startsWith('Release ')), false);
  assert.equal(run.provenance.policy.version, 'deterministic-policy-v2');
  assert.equal(run.provenance.planner.kind, 'test-fixture');
  assert.equal(run.evidence.every((evidence) => evidence.provenance?.verifier.name === 'termproof-verifier'), true);
  assert.equal(run.provenance.promise, run.milestone);
  assert.equal(run.provenance.planner.planHash.length, 64);
  assert.equal(run.evidence.every((evidence) => evidence.provenance?.planner.planHash === run.provenance.planner.planHash && evidence.rawHash.length === 64), true);
  assert.throws(() => { run.evidence[0].result = 'FAIL'; }, TypeError);
});

test('a deterministic npm version failure makes the same heterogeneous milestone FAILED', async () => {
  const run = await makeOrchestrator({ ...metadata, versions: {} }).verify({ milestone: 'Repository uses MIT; HTTP endpoint https://service.example/health returns 200; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed; npm package demo-package exists version 1.2.3 repository https://github.com/acme/demo-package and has integrity metadata.', githubRepository: 'https://github.com/acme/widget' });
  assert.equal(run.verdict, 'FAILED');
  assert.equal(run.claims.some((claim) => /npm|NPM/i.test(claim.statement) && claim.result === 'FAIL'), true);
  assert.equal(run.evidence.filter((evidence) => evidence.adapter !== 'npm').every((evidence) => evidence.result === 'PASS'), true);
});

test('golden judge protocol changes only the contradicted HTTP fact between FAILED and VERIFIED', async () => {
  const orchestrator = makeOrchestrator(goldenMetadata);
  const input = { milestone: goldenMilestone, githubRepository: 'https://github.com/ai/nanoid' };
  const failed = await orchestrator.verify(input);

  assert.equal(failed.verdict, 'FAILED');
  assert.deepEqual(new Set(failed.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base', 'npm']));
  assert.deepEqual(new Set(failed.claims.filter((claim) => claim.result === 'FAIL').flatMap((claim) => claim.steps.map((step) => step.adapter))), new Set(['http']));
  assert.equal(failed.evidence.filter((evidence) => evidence.adapter !== 'http').every((evidence) => evidence.result === 'PASS'), true);

  const passed = await orchestrator.verify({ ...input, milestone: goldenMilestone.replace('returns 201', 'returns 200') });
  assert.equal(passed.verdict, 'VERIFIED');
  assert.equal(passed.evidence.every((evidence) => evidence.result === 'PASS'), true);
  assert.deepEqual(new Set(passed.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base', 'npm']));
});
