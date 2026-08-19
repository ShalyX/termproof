import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClaim, evaluateMilestone } from '../src/core/policy.ts';
import type { ClaimExecution } from '../src/core/types.ts';

const claim = (id: string, required: boolean, results: ClaimExecution['steps'][number]['result'][]): ClaimExecution => ({
  id,
  statement: id,
  required,
  testability: 'OBJECTIVE',
  steps: results.map((result, index) => ({
    id: `${id}-step-${index}`,
    adapter: 'github',
    operation: 'repo_exists',
    result,
    evidenceIds: [`e-${id}-${index}`],
    message: result,
  })),
});

const plannedCoverage = (claims: ClaimExecution[]) => claims.map((item) => ({
  id: `term-${item.id}`,
  text: item.statement,
  required: item.required,
  disposition: 'PLANNED' as const,
  claimIds: [item.id],
  stepIds: item.steps.map((step) => step.id),
  reason: null,
}));

test('claim fails if any deterministic step fails', () => {
  assert.equal(evaluateClaim(claim('c1', true, ['PASS', 'FAIL'])), 'FAIL');
});

test('claim is inconclusive when checks cannot resolve it', () => {
  assert.equal(evaluateClaim(claim('c1', true, ['PASS', 'INCONCLUSIVE'])), 'INCONCLUSIVE');
});

test('claim passes only when every executed step passes', () => {
  assert.equal(evaluateClaim(claim('c1', true, ['PASS', 'PASS'])), 'PASS');
});

test('required failure makes milestone FAILED', () => {
  const claims = [
    { ...claim('c1', true, ['PASS']), result: 'PASS' },
    { ...claim('c2', true, ['FAIL']), result: 'FAIL' },
  ];
  assert.equal(evaluateMilestone(claims, plannedCoverage(claims)), 'FAILED');
});

test('missing required evidence makes milestone NEEDS_EVIDENCE rather than FAILED', () => {
  const claims = [
    { ...claim('c1', true, ['PASS']), result: 'PASS' },
    { ...claim('c2', true, ['INCONCLUSIVE']), result: 'INCONCLUSIVE' },
  ];
  assert.equal(evaluateMilestone(claims, plannedCoverage(claims)), 'NEEDS_EVIDENCE');
});

test('all required claims passing makes milestone VERIFIED', () => {
  const claims = [
    { ...claim('c1', true, ['PASS']), result: 'PASS' },
    { ...claim('c2', true, ['PASS']), result: 'PASS' },
  ];
  assert.equal(evaluateMilestone(claims, plannedCoverage(claims)), 'VERIFIED');
});
