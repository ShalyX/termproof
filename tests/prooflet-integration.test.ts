import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrchestrator } from '../src/core/factory.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { proofletHealthUrl, proofletMilestone, proofletRepository } from './fixtures/prooflet-planner.ts';

function liveOrchestrator() {
  return createOrchestrator();
}

test('Prooflet live production control A verifies complete four-provider acceptance coverage', { skip: !process.env.RUN_PROOFLET_INTEGRATION }, async () => {
  const run = await liveOrchestrator().verify({ milestone: proofletMilestone, githubRepository: proofletRepository });

  assert.equal(run.verdict, 'VERIFIED');
  assert.equal(run.coverage?.length, normalizeAcceptanceTerms(proofletMilestone).length);
  assert.equal(run.coverage?.every((term) => term.disposition === 'PLANNED'), true);
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http', 'base', 'npm']));
  assert.equal(run.evidence.every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(run.evidence.some((evidence) => evidence.source === proofletHealthUrl), true);
  assert.equal(run.provenance.planner.provider === 'gemini' || run.provenance.planner.provider === 'deepseek', true);
  assert.equal(run.evidence.every((evidence) => evidence.provenance?.planner.provider === run.provenance.planner.provider), true);
});

test('Prooflet live production control B changes only expected HTTP status and fails deterministically', { skip: !process.env.RUN_PROOFLET_INTEGRATION }, async () => {
  const run = await liveOrchestrator().verify({ milestone: proofletMilestone.replace('returns 200', 'returns 201'), githubRepository: proofletRepository });

  assert.equal(run.verdict, 'FAILED');
  assert.equal(run.claims.filter((claim) => claim.result === 'FAIL').length, 1);
  assert.match(run.claims.find((claim) => claim.result === 'FAIL')?.statement ?? '', /201/i);
  assert.equal(run.evidence.filter((evidence) => evidence.adapter === 'github').every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(run.evidence.filter((evidence) => evidence.adapter === 'base').every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(run.evidence.filter((evidence) => evidence.adapter === 'npm').every((evidence) => evidence.result === 'PASS'), true);
  const httpSteps = run.claims.flatMap((claim) => claim.steps).filter((step) => step.adapter === 'http');
  const statusStep = httpSteps.find((step) => step.operation === 'status_matches');
  assert.equal(statusStep?.result, 'FAIL');
  assert.equal(httpSteps.filter((step) => step.operation !== 'status_matches').every((step) => step.result === 'PASS'), true);
  assert.equal(run.evidence.some((evidence) => evidence.adapter === 'http' && evidence.extractedFacts.status === 200 && evidence.result === 'FAIL'), true);
  assert.equal(run.coverage?.every((term) => term.disposition === 'PLANNED'), true);
});
