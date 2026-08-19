import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeResumableEvidence, ResumablePlanner } from '../src/agent/resumable-planner.ts';
import type { MilestonePlanner } from '../src/agent/planner.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import type { VerificationPlan } from '../src/core/types.ts';

const milestone = 'A public HTTPS health endpoint, whose URL must be supplied as evidence, returns HTTP 200.';
const terms = normalizeAcceptanceTerms(milestone);

function missingPlan(): VerificationPlan {
  return {
    acceptanceTerms: terms.map((term) => ({
      id: term.id,
      disposition: 'NEEDS_EVIDENCE',
      reason: 'The endpoint URL must be supplied as evidence.',
    })),
    claims: [],
    missingEvidence: terms.map((term) => term.id),
  };
}

test('materializes an objective missing HTTP source into one deferred verifier step', () => {
  const plan = materializeResumableEvidence(missingPlan(), terms);

  assert.equal(plan.acceptanceTerms?.[0].disposition, 'PLANNED');
  assert.equal(plan.acceptanceTerms?.[0].reason, null);
  assert.equal(plan.missingEvidence.length, 0);
  assert.equal(plan.claims.length, 1);
  assert.deepEqual(plan.claims[0].acceptanceTermIds, [terms[0].id]);
  assert.equal(plan.claims[0].steps.length, 1);

  const step = plan.claims[0].steps[0];
  assert.equal(step.adapter, 'http');
  assert.equal(step.operation, 'status_matches');
  assert.equal(step.requiresEvidence, true);
  if (step.adapter !== 'http') throw new Error('expected HTTP step');
  assert.equal(step.params.url, '');
  assert.equal(step.params.expected, '200');
});

test('does not invent a deferred route when the missing evidence cannot be expressed exactly', () => {
  const vagueMilestone = 'A public HTTPS endpoint must demonstrate the required behavior.';
  const vagueTerms = normalizeAcceptanceTerms(vagueMilestone);
  const original: VerificationPlan = {
    acceptanceTerms: vagueTerms.map((term) => ({ id: term.id, disposition: 'NEEDS_EVIDENCE', reason: 'Missing observation.' })),
    claims: [],
    missingEvidence: vagueTerms.map((term) => term.id),
  };

  assert.deepEqual(materializeResumableEvidence(original, vagueTerms), original);
});

test('does not replace a concrete URL or an existing planner claim', () => {
  const concreteMilestone = 'HTTP endpoint https://example.com/health returns 200.';
  const concreteTerms = normalizeAcceptanceTerms(concreteMilestone);
  const concrete: VerificationPlan = {
    acceptanceTerms: concreteTerms.map((term) => ({ id: term.id, disposition: 'NEEDS_EVIDENCE', reason: 'provider chose missing evidence' })),
    claims: [],
    missingEvidence: concreteTerms.map((term) => term.id),
  };
  assert.deepEqual(materializeResumableEvidence(concrete, concreteTerms), concrete);

  const existing: VerificationPlan = {
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'NEEDS_EVIDENCE', reason: 'source missing' })),
    claims: [{
      id: 'claim-existing',
      acceptanceTermIds: [terms[0].id],
      statement: terms[0].text,
      required: true,
      testability: 'OBJECTIVE',
      steps: [],
    }],
    missingEvidence: [terms[0].id],
  };
  assert.deepEqual(materializeResumableEvidence(existing, terms), existing);
});

test('resumable planner preserves provider provenance and marks the deterministic materializer version', async () => {
  const inner: MilestonePlanner = {
    plan: async () => missingPlan(),
    metadata: () => ({ kind: 'gemini', provider: 'gemini', model: 'gemini-test', role: 'primary', version: 'provider-planner-v1' }),
  };
  const planner = new ResumablePlanner(inner);
  const plan = await planner.plan({ milestone, githubRepository: 'https://github.com/ShalyX/termproof', acceptanceTerms: terms });

  assert.equal(plan.claims[0].steps[0].requiresEvidence, true);
  assert.equal(planner.metadata().provider, 'gemini');
  assert.equal(planner.metadata().version, 'provider-planner-v1+resumable-evidence-v1');
});
