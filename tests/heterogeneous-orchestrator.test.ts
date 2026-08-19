import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseAdapter } from '../src/adapters/base.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { HttpAdapter } from '../src/adapters/http.ts';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import { FixturePlanner } from './fixtures/planner.ts';

test('orchestrator routes one milestone across GitHub, HTTP, and Base adapters', async () => {
  const planner = new FixturePlanner();
  const github = new GitHubAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ license: { spdx_id: 'MIT', name: 'MIT License' }, sha: 'license-sha' }), { status: 200 }),
  });
  const http = new HttpAdapter({
    fetchImpl: async () => new Response('healthy', { status: 200 }),
  });
  const base = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: request.method === 'eth_chainId' ? '0x2105' : '0x6000' }), { status: 200 });
    },
  });
  const orchestrator = new VerificationOrchestrator({ planner, github, http, base });

  const run = await orchestrator.verify({
    milestone: 'Repository uses MIT; HTTP endpoint https://service.example/health returns 200; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed.',
    githubRepository: 'https://github.com/acme/widget',
  });

  assert.equal(run.verdict, 'VERIFIED');
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base']));
  assert.equal(run.claims.every((claim) => claim.result === 'PASS'), true);
  assert.deepEqual(run.claims.flatMap((claim) => claim.steps.map((step) => step.adapter)), ['github', 'github', 'http', 'base', 'base']);
});

test('the same heterogeneous milestone fails only on a deterministic GitHub claim', async () => {
  const orchestrator = new VerificationOrchestrator({
    planner: new FixturePlanner(),
    github: new GitHubAdapter({
      fetchImpl: async () => new Response(JSON.stringify({ license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' }, sha: 'license-sha' }), { status: 200 }),
    }),
    http: new HttpAdapter({ fetchImpl: async () => new Response('healthy', { status: 200 }) }),
    base: new BaseAdapter({
      rpcUrls: { base: 'https://base.example/rpc' },
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { method: string };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: request.method === 'eth_chainId' ? '0x2105' : '0x6000' }), { status: 200 });
      },
    }),
  });

  const run = await orchestrator.verify({
    milestone: 'Repository uses MIT; HTTP endpoint https://service.example/health returns 200; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed.',
    githubRepository: 'https://github.com/acme/widget',
  });

  assert.equal(run.verdict, 'FAILED');
  const licenseClaim = run.claims.find((claim) => /MIT/.test(claim.statement));
  assert.equal(licenseClaim?.result, 'FAIL');
  assert.equal(run.claims.filter((claim) => claim !== licenseClaim).every((claim) => claim.result === 'PASS'), true);
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base']));
});

test('heterogeneous infrastructure inability produces NEEDS_EVIDENCE', async () => {
  const orchestrator = new VerificationOrchestrator({
    planner: new FixturePlanner(),
    github: new GitHubAdapter({
      fetchImpl: async () => new Response(JSON.stringify({ license: { spdx_id: 'MIT', name: 'MIT License' }, sha: 'license-sha' }), { status: 200 }),
    }),
    http: new HttpAdapter({ fetchImpl: async () => new Response('upstream unavailable', { status: 503 }) }),
    base: new BaseAdapter({
      rpcUrls: { base: 'https://base.example/rpc' },
      fetchImpl: async () => new Response('upstream unavailable', { status: 503 }),
    }),
  });

  const run = await orchestrator.verify({
    milestone: 'Repository uses MIT; HTTP endpoint https://service.example/health returns 200; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed.',
    githubRepository: 'https://github.com/acme/widget',
  });

  assert.equal(run.verdict, 'NEEDS_EVIDENCE');
  assert.equal(run.claims.some((claim) => claim.result === 'FAIL'), false);
  assert.equal(run.claims.filter((claim) => /HTTP|base/.test(claim.statement)).every((claim) => claim.result === 'INCONCLUSIVE' || claim.steps.some((step) => step.result === 'INCONCLUSIVE')), true);
});
