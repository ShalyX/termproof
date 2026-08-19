import assert from 'node:assert/strict';
import test from 'node:test';
import type { MilestonePlanner } from '../src/agent/planner.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import {
  MemoryPersistenceAdapter,
  PersistenceError,
  type PersistedVerificationCase,
  type PersistenceAdapter,
  type PersistenceRequestContext,
  type RateLimitDecision,
} from '../src/core/persistence.ts';
import { ResumableVerificationService } from '../src/core/resumable.ts';
import type { AdapterExecution, EvidenceRecord, VerificationPlan, VerificationPlanStep } from '../src/core/types.ts';

const termId = normalizeAcceptanceTerms('Repository exists')[0].id;
const plan: VerificationPlan = {
  acceptanceTerms: [{ id: termId, disposition: 'PLANNED', reason: null }],
  missingEvidence: [],
  claims: [
    { id: 'claim-github', acceptanceTermIds: [termId], statement: 'Repository exists', required: true, testability: 'OBJECTIVE', steps: [{ id: 'step-github', claimId: 'claim-github', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } }] },
    { id: 'claim-http', acceptanceTermIds: [termId], statement: 'HTTP endpoint returns 200', required: true, testability: 'OBJECTIVE', steps: [{ id: 'step-http', claimId: 'claim-http', adapter: 'http', operation: 'status_matches', requiresEvidence: true, params: { url: 'https://example.com/', expected: '200' } }] },
  ],
};

function planner(): MilestonePlanner {
  return { metadata: () => ({ kind: 'test-fixture', model: null }), plan: async () => plan };
}

function evidence(step: VerificationPlanStep, result: 'PASS' | 'FAIL' | 'INCONCLUSIVE' = 'PASS'): EvidenceRecord {
  return {
    id: `${step.adapter}-${step.id}-${result}`,
    claimId: step.claimId,
    stepId: step.id,
    adapter: step.adapter,
    source: step.adapter,
    revision: null,
    raw: { result },
    extractedFacts: {},
    result,
    observedAt: '2026-08-19T00:00:00.000Z',
    rawHash: `hash-${step.id}-${result}`,
  };
}

function execution(step: VerificationPlanStep, result: 'PASS' | 'FAIL' | 'INCONCLUSIVE' = 'PASS'): AdapterExecution {
  return { result, message: result === 'PASS' ? 'verified' : 'not verified', evidence: evidence(step, result) };
}

function service(persistence: PersistenceAdapter, httpCalls: string[] = []): ResumableVerificationService {
  return new ResumableVerificationService({
    planner: planner(),
    persistence,
    github: { execute: async (step) => execution(step) },
    http: { execute: async (step) => { httpCalls.push(step.adapter === 'http' ? step.params.url : 'unexpected'); return execution(step); } },
    base: { execute: async (step) => execution(step) },
    npm: { execute: async (step) => execution(step) },
  });
}

class MutationGuardPersistenceAdapter implements PersistenceAdapter {
  readonly kind = 'memory' as const;
  private readonly inner = new MemoryPersistenceAdapter();

  createCase(record: PersistedVerificationCase, context?: PersistenceRequestContext): Promise<void> {
    return this.inner.createCase(record, context);
  }

  getCase(caseId: string): Promise<PersistedVerificationCase> {
    return this.inner.getCase(caseId);
  }

  mutateCase(
    caseId: string,
    context: PersistenceRequestContext,
    mutate: (current: PersistedVerificationCase) => Promise<PersistedVerificationCase>,
  ): Promise<PersistedVerificationCase> {
    return this.inner.mutateCase(caseId, context, async (current) => {
      const before = structuredClone(current);
      const updated = await mutate(current);
      assert.deepEqual(current, before, 'resume mutator changed the persisted pre-mutation snapshot');
      return updated;
    });
  }

  consumeRateLimit(scopeKey: string, max: number, windowMs: number, now?: Date): Promise<RateLimitDecision> {
    return this.inner.consumeRateLimit(scopeKey, max, windowMs, now);
  }
}

test('case state survives service instance replacement when persistence is shared', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const first = service(persistence);
  const started = await first.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });

  const second = service(persistence);
  const recovered = await second.get(started.caseId);

  assert.equal(recovered.caseId, started.caseId);
  assert.equal(recovered.verdict, started.verdict);
  assert.deepEqual(recovered.evidenceLedger, started.evidenceLedger);
});

test('resume advances durable version exactly once and idempotent replay does not execute evidence again', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const httpCalls: string[] = [];
  const verifier = service(persistence, httpCalls);
  const started = await verifier.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });
  const submission = { kind: 'http_source' as const, claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' };
  const context = { requestId: 'resume-request-1', idempotencyKey: 'resume-key-1' };

  const resumed = await verifier.supplyEvidence(started.caseId, submission, context);
  const persistedAfterFirst = await persistence.getCase(started.caseId);
  const replayed = await verifier.supplyEvidence(started.caseId, submission, context);
  const persistedAfterReplay = await persistence.getCase(started.caseId);

  assert.equal(persistedAfterFirst.version, 1);
  assert.equal(persistedAfterReplay.version, 1);
  assert.equal(resumed.verdict, 'VERIFIED');
  assert.equal(resumed.evidenceRequests[0].status, 'SATISFIED');
  assert.deepEqual(replayed, resumed);
  assert.deepEqual(httpCalls, ['https://example.com/']);
});

test('resume mutator preserves the pre-resume snapshot for transactional diffing', async () => {
  const persistence = new MutationGuardPersistenceAdapter();
  const verifier = service(persistence);
  const started = await verifier.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });

  const resumed = await verifier.supplyEvidence(
    started.caseId,
    { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' },
    { requestId: 'resume-request-immutable', idempotencyKey: 'resume-key-immutable' },
  );

  assert.equal(started.evidenceRequests[0].status, 'OPEN');
  assert.equal(resumed.evidenceRequests[0].status, 'SATISFIED');
});

test('same idempotency key with different evidence is rejected', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const verifier = service(persistence);
  const started = await verifier.start({ milestone: 'Repository exists', githubRepository: 'https://github.com/acme/project' });
  const context = { requestId: 'resume-request-2', idempotencyKey: 'resume-key-2' };

  await verifier.supplyEvidence(started.caseId, { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.com/' }, context);

  await assert.rejects(
    () => verifier.supplyEvidence(started.caseId, { kind: 'http_source', claimId: 'claim-http', stepId: 'step-http', url: 'https://example.org/' }, context),
    (error: unknown) => error instanceof PersistenceError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('durable rate limiter rejects the first request above the configured maximum', async () => {
  const persistence = new MemoryPersistenceAdapter();
  const now = new Date('2026-08-19T20:00:00.000Z');

  const first = await persistence.consumeRateLimit('verify:test', 2, 60_000, now);
  const second = await persistence.consumeRateLimit('verify:test', 2, 60_000, now);
  const third = await persistence.consumeRateLimit('verify:test', 2, 60_000, now);

  assert.equal(first.allowed, true);
  assert.equal(first.currentCount, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.currentCount, 2);
  assert.equal(third.allowed, false);
  assert.equal(third.currentCount, 3);
});
