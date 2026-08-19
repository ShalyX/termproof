import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrchestrator } from '../src/core/factory.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { mandateContradictionMilestone, mandateMilestone, mandateRepository } from './fixtures/mandate.ts';

const enabled = process.env.RUN_MANDATE_INTEGRATION === '1';

function assertCompleteCoverage(run: Awaited<ReturnType<ReturnType<typeof createOrchestrator>['verify']>>) {
  assert.equal(normalizeAcceptanceTerms(run.milestone).length, 9);
  assert.equal(run.coverage?.length, 9);
  assert.equal(run.coverage?.every((term) => term.required && term.disposition === 'PLANNED'), true);
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http']));
  assert.equal(run.provenance.planner.provider === 'gemini' || run.provenance.planner.provider === 'deepseek', true);
  assert.equal(run.evidence.every((evidence) => evidence.provenance?.planner.provider === run.provenance.planner.provider), true);
  assert.equal(run.provenance.planner.planHash.length, 64);
}

test('Mandate live A/B controls prove truthful VERIFIED and exact service contradiction FAILED', { skip: !enabled }, async () => {
  const truthful = await createOrchestrator().verify({ milestone: mandateMilestone, githubRepository: mandateRepository });
  assert.equal(truthful.verdict, 'VERIFIED');
  assertCompleteCoverage(truthful);
  assert.equal(truthful.claims.flatMap((claim) => claim.steps).filter((step) => step.result === 'PASS').length, 9);
  assert.equal(truthful.evidence.every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(truthful.claims.flatMap((claim) => claim.steps).some((step) => step.operation === 'json_field_matches' && step.result === 'PASS'), true);

  const contradiction = await createOrchestrator().verify({ milestone: mandateContradictionMilestone, githubRepository: mandateRepository });
  assert.equal(contradiction.verdict, 'FAILED');
  assertCompleteCoverage(contradiction);
  assert.equal(contradiction.claims.flatMap((claim) => claim.steps).length, 9);
  const failedSteps = contradiction.claims.flatMap((claim) => claim.steps).filter((step) => step.result === 'FAIL');
  assert.equal(failedSteps.length, 1);
  assert.equal(failedSteps[0]?.adapter, 'http');
  assert.equal(failedSteps[0]?.operation, 'json_field_matches');
  assert.equal(contradiction.evidence.filter((evidence) => evidence.adapter === 'github').every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(contradiction.evidence.filter((evidence) => evidence.adapter === 'http' && evidence.extractedFacts.jsonField !== 'service').every((evidence) => evidence.result === 'PASS'), true);
  const serviceEvidence = contradiction.evidence.find((evidence) => evidence.extractedFacts.jsonField === 'service');
  assert.equal(serviceEvidence?.result, 'FAIL');
  assert.equal(serviceEvidence?.extractedFacts.expectedValue, 'mandate-agent');
  assert.equal(serviceEvidence?.extractedFacts.observedValue, 'mandate');
});
