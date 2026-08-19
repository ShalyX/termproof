import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderPlanner } from '../src/agent/provider-planner.ts';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { HttpAdapter } from '../src/adapters/http.ts';
import { normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import type { NormalizedAcceptanceTerm, VerificationPlan } from '../src/core/types.ts';
import { mandateHealthUrl, mandateMilestone, mandateContradictionMilestone, mandateRepository } from './fixtures/mandate.ts';

function mandatePlan(milestone: string, terms: NormalizedAcceptanceTerm[]): VerificationPlan {
  if (terms.length !== 9) throw new Error(`Mandate regression expects nine atomic terms, received ${terms.length}`);
  const termFor = (pattern: RegExp): string => terms.find((term) => pattern.test(term.text))?.id ?? (() => { throw new Error(`Mandate term missing: ${pattern}`); })();
  const status = milestone.match(/returns HTTP (\d{3})/i)?.[1] ?? '200';
  const service = milestone.match(/service equals ([a-z0-9-]+)/i)?.[1] ?? 'mandate';
  let sequence = 0;
  const claims: VerificationPlan['claims'] = [];
  const addGitHub = (statement: string, path: string | null, termId: string) => {
    const id = `mandate-claim-${++sequence}`;
    claims.push({
      id,
      acceptanceTermIds: [termId],
      statement,
      required: true,
      testability: 'OBJECTIVE',
      steps: [{ id: `${id}-step`, claimId: id, adapter: 'github', operation: path ? 'file_exists' : 'repo_exists', params: { path, expected: null } }],
    });
  };
  const addHttp = (statement: string, operation: 'status_matches' | 'json_valid' | 'json_field_matches', expected: string, termId: string) => {
    const id = `mandate-claim-${++sequence}`;
    claims.push({
      id,
      acceptanceTermIds: [termId],
      statement,
      required: true,
      testability: 'OBJECTIVE',
      steps: [{ id: `${id}-step`, claimId: id, adapter: 'http', operation, params: { url: mandateHealthUrl, expected } }],
    });
  };

  addGitHub('Public Mandate implementation repository exists', null, termFor(/public repository/i));
  for (const path of ['contracts/MandateVault.sol', 'contracts/MandateFactory.sol', 'src/agent/planner.mjs', 'api/health.mjs']) {
    addGitHub(`${path} exists`, path, termFor(new RegExp(path.replaceAll('.', '\\.'), 'i')));
  }
  addHttp(`HTTP endpoint returns ${status}`, 'status_matches', status, termFor(/returns HTTP/i));
  addHttp('HTTP response is valid JSON', 'json_valid', 'true', termFor(/valid JSON/i));
  addHttp('HTTP JSON field ok equals true', 'json_field_matches', 'ok=true', termFor(/JSON field ok/i));
  addHttp(`HTTP JSON field service equals ${service}`, 'json_field_matches', `service=${service}`, termFor(/JSON field service/i));

  return {
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED', reason: null })),
    claims,
    missingEvidence: [],
  };
}

function geminiEnvelope(plan: VerificationPlan): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function testAdapters() {
  const github = new GitHubAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ full_name: 'ShalyX/mandate-closeout-agent', default_branch: 'main', sha: 'mandate-test-revision' }), { status: 200 }),
  });
  const http = new HttpAdapter({
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, service: 'mandate' }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  return { github, http };
}

function testProvider(expectedPlan: VerificationPlan, calls: string[]) {
  return new ProviderPlanner({
    geminiApiKey: 'gemini-test-secret',
    deepseekApiKey: 'deepseek-test-secret',
    maxRetries: 0,
    retryDelayMs: 0,
    now: () => new Date('2026-08-18T00:00:00.000Z'),
    fetchImpl: async (input) => {
      calls.push(String(input));
      assert.match(String(input), /generativelanguage\.googleapis\.com/);
      return geminiEnvelope(expectedPlan);
    },
  });
}

async function deterministicRun(milestone: string) {
  const terms = normalizeAcceptanceTerms(milestone);
  const plan = mandatePlan(milestone, terms);
  const calls: string[] = [];
  const adapters = testAdapters();
  const run = await new VerificationOrchestrator({
    planner: testProvider(plan, calls),
    ...adapters,
  }).verify({ milestone, githubRepository: mandateRepository });
  return { run, calls };
}

test('Mandate truthful control compiles the exact input into complete GitHub and HTTP coverage', async () => {
  const { run, calls } = await deterministicRun(mandateMilestone);

  assert.equal(run.verdict, 'VERIFIED');
  assert.equal(run.coverage?.length, 9);
  assert.equal(run.coverage?.filter((term) => term.disposition === 'PLANNED').length, 9);
  assert.deepEqual(run.coverage?.map((term) => term.text), [
    'Public repository exists',
    'contracts/MandateVault.sol exists',
    'contracts/MandateFactory.sol exists',
    'src/agent/planner.mjs exists',
    'api/health.mjs exists',
    'Health endpoint returns HTTP 200',
    'Health response is valid JSON',
    'Health JSON field ok equals true',
    'Health JSON field service equals "mandate"',
  ]);
  assert.equal(run.coverage?.every((term) => term.claimIds.length === 1 && term.stepIds.length === 1), true);
  assert.equal(calls.length, 1);
  assert.equal(run.coverage?.every((term) => term.required && term.disposition === 'PLANNED'), true);
  assert.deepEqual(new Set(run.evidence.map((evidence) => evidence.adapter)), new Set(['github', 'http']));
  assert.equal(run.evidence.every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(run.provenance.planner.provider, 'gemini');
  assert.equal(run.provenance.planner.role, 'primary');
  assert.equal(run.provenance.planner.failoverReason, null);
  assert.equal(run.claims.flatMap((claim) => claim.steps).some((step) => step.operation === 'file_exists' && step.adapter === 'github'), true);
  assert.equal(run.claims.flatMap((claim) => claim.steps).some((step) => step.operation === 'json_field_matches' && step.adapter === 'http' && step.result === 'PASS'), true);
  assert.equal(run.claims.flatMap((claim) => claim.steps).filter((step) => step.result === 'PASS').length, 9);
});

test('Mandate contradiction control changes only the exact service-field assertion', async () => {
  const { run, calls } = await deterministicRun(mandateContradictionMilestone);

  assert.equal(run.verdict, 'FAILED');
  assert.equal(run.coverage?.length, 9);
  assert.equal(run.coverage?.filter((term) => term.disposition === 'PLANNED').length, 9);
  assert.equal(run.coverage?.every((term) => term.claimIds.length === 1 && term.stepIds.length === 1), true);
  assert.equal(calls.length, 1);
  assert.equal(run.coverage?.every((term) => term.required && term.disposition === 'PLANNED'), true);
  const failedSteps = run.claims.flatMap((claim) => claim.steps).filter((step) => step.result === 'FAIL');
  assert.equal(failedSteps.length, 1);
  assert.equal(failedSteps[0]?.adapter, 'http');
  assert.equal(failedSteps[0]?.operation, 'json_field_matches');
  assert.equal(run.evidence.filter((evidence) => evidence.adapter === 'github').every((evidence) => evidence.result === 'PASS'), true);
  assert.equal(run.evidence.filter((evidence) => evidence.adapter === 'http' && evidence.extractedFacts.jsonField !== 'service').every((evidence) => evidence.result === 'PASS'), true);
  const contradiction = run.evidence.find((evidence) => evidence.extractedFacts.jsonField === 'service');
  assert.equal(contradiction?.result, 'FAIL');
  assert.equal(contradiction?.extractedFacts.expectedValue, 'mandate-agent');
  assert.equal(contradiction?.extractedFacts.observedValue, 'mandate');
  assert.equal(run.provenance.planner.planHash.length, 64);
});
