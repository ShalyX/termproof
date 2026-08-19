import assert from 'node:assert/strict';
import test from 'node:test';
import * as factory from '../src/core/factory.ts';
import { PlannerOperationalError } from '../src/agent/planner.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import { evaluateMilestone } from '../src/core/policy.ts';

test('production planner construction is explicit and unavailable configuration fails closed', async () => {
  const createProductionPlanner = (factory as typeof factory & {
    createProductionPlanner?: () => { plan: (input: { milestone: string; githubRepository: string }) => Promise<unknown> };
  }).createProductionPlanner;

  assert.equal(typeof createProductionPlanner, 'function');
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const planner = createProductionPlanner!();
    await assert.rejects(
      planner.plan({ milestone: 'Repository exists', githubRepository: 'https://github.com/ShalyX/prooflet-protocol' }),
      (error: unknown) => (error as { code?: string }).code === 'PLANNER_UNAVAILABLE',
    );
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
  }
});

test('a passing emitted claim cannot produce VERIFIED when acceptance coverage is incomplete', () => {
  const claim = {
    id: 'claim-one',
    statement: 'First term passes',
    required: true,
    testability: 'OBJECTIVE' as const,
    steps: [{ id: 'step-one', adapter: 'github' as const, operation: 'repo_exists' as const, result: 'PASS' as const, evidenceIds: ['e1'], message: 'pass' }],
    result: 'PASS' as const,
  };

  const coverage = [{
    id: 'term-01',
    text: 'First term passes',
    required: true,
    disposition: 'NEEDS_EVIDENCE' as const,
    claimIds: [],
    stepIds: [],
    reason: 'Planner omitted the remaining acceptance terms.',
  }];

  assert.equal(evaluateMilestone([claim], coverage as never), 'NEEDS_EVIDENCE');
});

test('planner preflight stops production verification before any adapter can create a verdict', async () => {
  let adapterCalls = 0;
  const planner = {
    preflight() {
      throw new PlannerOperationalError('PLANNER_UNAVAILABLE', 'planner unavailable');
    },
    async plan() {
      throw new Error('A fallback plan must never be requested');
    },
  };
  const orchestrator = new VerificationOrchestrator({
    planner,
    github: new GitHubAdapter({ fetchImpl: async () => { adapterCalls += 1; return new Response('{}', { status: 200 }); } }),
  });

  await assert.rejects(
    () => orchestrator.verify({ milestone: 'Public repository exists', githubRepository: 'https://github.com/ShalyX/prooflet-protocol' }),
    (error: unknown) => (error as { code?: string }).code === 'PLANNER_UNAVAILABLE',
  );
  assert.equal(adapterCalls, 0);
});
