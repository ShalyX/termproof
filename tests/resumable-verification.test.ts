import assert from 'node:assert/strict';
import test from 'node:test';
import type { MilestonePlanner } from '../src/agent/planner.ts';
import type { AdapterExecution, EvidenceRecord, VerificationPlan, VerificationPlanStep } from '../src/core/types.ts';
import { ResumableVerificationService, type EvidenceSubmission } from '../src/core/resumable.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';

const termId = normalizeAcceptanceTerms('Repository exists')[0].id;

function evidence(claimId: string, stepId: string, adapter: 'github' | 'http' | 'base', result: 'PASS' | 'FAIL' | 'INCONCLUSIVE'): EvidenceRecord {
  return { id: `${adapter}-${stepId}-${result}`, claimId, stepId, adapter, source: adapter, revision: null, raw: { result }, extractedFacts: {}, result, observedAt: '2026-08-15T00:00:00.000Z', rawHash: `hash-${stepId}-${result}` };
}

function execution(claimId: string, stepId: string, adapter: 'github' | 'http' | 'base', result: 'PASS' | 'FAIL' | 'INCONCLUSIVE', message: string): AdapterExecution {
  return { result, message, evidence: evidence(claimId, stepId, adapter, result) };
}

const plan: VerificationPlan = {
  acceptanceTerms: [{ id: termId, disposition: 'PLANNED', reason: null }],
  missingEvidence: [],
  claims: [
    { id: 'claim-github', acceptanceTermIds: [termId], statement: 'Repository exists', required: true, testability: 'OBJECTIVE', steps: [{ id: 'step-github', claimId: 'claim-github', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } }] },
    { id: 'claim-http', acceptanceTermIds: [termId], statement: 'HTTP endpoint returns 200', required: true, testability: 'OBJECTIVE', steps: [{ id: 'step-http', claimId: 'claim-http', adapter: 'http', operation: 'status_matches', requiresEvidence: true, params: { url: 'https://example.com/', expected: '200' } }] },
  ],
};

function planner(): MilestonePlanner { return { metadata: () => ({ kind: 'test-fixture', model: null }), plan: async () => plan }; }
function adapters(httpResult: AdapterExecution) {
  const calls: string[] = [];
  return {
    calls,
    github: { execute: async (step: VerificationPlanStep) => { calls.push(`github:${step.id}`); return execution(step.claimId, step.id, 'github', 'PASS', 'verified'); } },
    http: { execute: async (step: VerificationPlanStep) => { if (step.adapter !== 'http') throw new Error('unexpected adapter'); calls.push(`http:${step.params.url}`); return httpResult.evidence.id === 'http-step-http-PASS' ? execution(step.claimId, step.id, 'http', 'PASS', 'verified') : httpResult; } },
    base: { execute: async () => { throw new Error('unexpected base call'); } },
    npm: { execute: async () => { throw new Error('unexpected npm call'); } },
  };
}

test('resumes a missing claim, preserves prior evidence attribution, and changes the deterministic verdict', async () => {
  const deps = adapters(execution('claim-http', 'step-http', 'http', 'PASS', 'verified'));
  const service = new ResumableVerificationService({ planner: planner(), ...deps, now: () => new Date('2026-08-15T00:00:00.000Z') });
  const initial = await service.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });

  assert.equal(initial.verdict, 'NEEDS_EVIDENCE');
  assert.equal(initial.claims.find((claim) => claim.id === 'claim-github')?.result, 'PASS');
  assert.equal(initial.claims.find((claim) => claim.id === 'claim-http')?.result, 'INCONCLUSIVE');
  assert.equal(initial.evidenceLedger.length, 1);
  assert.match(initial.evidenceRequests[0].request, /public HTTPS endpoint/i);
  assert.deepEqual(deps.calls, ['github:step-github']);

  const resumed = await service.supplyEvidence(initial.caseId, { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' });
  assert.equal(resumed.verdict, 'VERIFIED');
  assert.equal(resumed.claims.find((claim) => claim.id === 'claim-http')?.result, 'PASS');
  assert.equal(resumed.evidenceLedger.length, 2);
  assert.equal(resumed.evidenceLedger[0].evidence.id, initial.evidenceLedger[0].evidence.id);
  assert.equal(resumed.evidenceLedger[0].origin, 'initial');
  assert.equal(resumed.evidenceLedger[1].origin, 'supplied');
  assert.deepEqual(deps.calls, ['github:step-github', 'http:https://example.com/']);
});

test('additional evidence cannot override a genuine deterministic failure', async () => {
  const failed = execution('claim-http', 'step-http', 'http', 'FAIL', 'expected 200, received 404');
  const deps = adapters(failed);
  const service = new ResumableVerificationService({ planner: { metadata: () => ({ kind: 'test-fixture', model: null }), plan: async () => ({ ...plan, claims: plan.claims.map((claim) => claim.id === 'claim-http' ? { ...claim, steps: claim.steps.map((step) => ({ ...step, requiresEvidence: false })) } : claim) }) }, ...deps });
  const initial = await service.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });
  assert.equal(initial.verdict, 'FAILED');
  await assert.rejects(() => service.supplyEvidence(initial.caseId, { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' }), /no open evidence request/i);
  const unchanged = service.get(initial.caseId);
  assert.equal(unchanged.verdict, 'FAILED');
  assert.equal(unchanged.evidenceLedger.length, 2);
});

test('rejects forged verdict fields in evidence submissions', async () => {
  const deps = adapters(execution('claim-http', 'step-http', 'http', 'PASS', 'verified'));
  const service = new ResumableVerificationService({ planner: planner(), ...deps });
  const initial = await service.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });
  await assert.rejects(() => service.supplyEvidence(initial.caseId, { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/', result: 'PASS' } as unknown as EvidenceSubmission & Record<string, unknown>), /unsupported evidence fields/i);
});

test('rejects a concurrent resume while the first resume is still executing', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const deps = adapters(execution('claim-http', 'step-http', 'http', 'PASS', 'verified'));
  deps.http = { execute: async (step: VerificationPlanStep) => { await pending; return execution(step.claimId, step.id, 'http', 'PASS', 'verified'); } };
  const service = new ResumableVerificationService({ planner: planner(), ...deps });
  const initial = await service.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });
  const submission = { kind: 'http_source' as const, claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' };
  const first = service.supplyEvidence(initial.caseId, submission);
  await assert.rejects(() => service.supplyEvidence(initial.caseId, submission), /resume already in progress/i);
  release();
  await first;
});
