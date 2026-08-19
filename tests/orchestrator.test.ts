import test from 'node:test';
import assert from 'node:assert/strict';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import type { MilestonePlanner } from '../src/agent/planner.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';

const planner: MilestonePlanner = {
  metadata() { return { kind: 'test-fixture', model: null }; },
  async plan() {
    return {
      claims: [
        {
          id: 'claim-license',
          statement: 'Repository is released under MIT',
          required: true,
          testability: 'OBJECTIVE',
          steps: [{
            id: 'step-license', claimId: 'claim-license', adapter: 'github', operation: 'license_matches',
            params: { path: null, expected: 'MIT' }
          }]
        }
      ],
      missingEvidence: []
    };
  }
};

test('orchestrator keeps model planning separate from deterministic verdict', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' }, sha: 'sha-1'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const orchestrator = new VerificationOrchestrator({
    planner,
    github: new GitHubAdapter({ fetchImpl: fakeFetch })
  });
  const run = await orchestrator.verify({
    milestone: 'Release source under MIT',
    githubRepository: 'https://github.com/openai/openai-node'
  });
  assert.equal(run.verdict, 'FAILED');
  assert.equal(run.claims[0].result, 'FAIL');
  assert.equal(run.evidence.length, 1);
});
