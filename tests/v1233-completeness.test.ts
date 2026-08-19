import assert from 'node:assert/strict';
import test from 'node:test';
import * as coverageModule from '../src/core/coverage.ts';
import { ProviderPlanner } from '../src/agent/provider-planner.ts';
import { PlannerOperationalError } from '../src/agent/planner.ts';
import { parseCanonicalPlannerOutput } from '../src/agent/canonical-planner.ts';
import { BaseAdapter } from '../src/adapters/base.ts';
import { buildAcceptanceCoverage, normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { getProofObligationForAssertion, validateProofRoute } from '../src/core/capabilities.ts';
import { VerificationOrchestrator } from '../src/core/orchestrator.ts';
import { evaluateMilestone } from '../src/core/policy.ts';
import type { BaseStep, NormalizedAcceptanceTerm, VerificationPlan, VerificationPlanStep } from '../src/core/types.ts';

const CONTRACT = '0x1111111111111111111111111111111111111111';
const TX = `0x${'2'.repeat(64)}`;
const COMPOSITE = `A public implementation repository containing contracts/One.sol, contracts/Two.sol, and src/agent.mjs. Its public endpoint at https://example.test/health returns HTTP 200 with valid JSON. On Arc Testnet with chain ID 5042002, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`;

function evmStep(operation: BaseStep['operation'], address: string | null, expected: string | null, id: string, network = 'arc-testnet', claimId = id): BaseStep {
  return { id, claimId, adapter: 'base', operation, params: { network: network as BaseStep['params']['network'], address, expected } };
}

function planForTerms(terms: NormalizedAcceptanceTerm[], omit: RegExp[] = []): VerificationPlan {
  const claims: VerificationPlan['claims'] = [];
  for (const term of terms) {
    if (omit.some((pattern) => pattern.test(term.text))) continue;
    const id = `claim-${term.id}`;
    const step = plannedStep(term, id);
    claims.push({
      id,
      acceptanceTermIds: [term.id],
      statement: term.text,
      required: true,
      testability: 'OBJECTIVE',
      steps: [step],
    });
  }
  return {
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED', reason: null })),
    claims,
    missingEvidence: [],
  };
}

function plannedStep(term: NormalizedAcceptanceTerm, id: string): VerificationPlanStep {
  if (/repository exists/i.test(term.text)) return { id: `${id}-step`, claimId: id, adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } };
  if (/\.sol exists|\.mjs exists/i.test(term.text)) {
    return { id: `${id}-step`, claimId: id, adapter: 'github', operation: 'file_exists', params: { path: term.text.replace(/ exists$/i, ''), expected: null } };
  }
  if (/HTTP 200/i.test(term.text)) return { id: `${id}-step`, claimId: id, adapter: 'http', operation: 'status_matches', params: { url: 'https://example.test/health', expected: '200' } };
  if (/valid JSON/i.test(term.text)) return { id: `${id}-step`, claimId: id, adapter: 'http', operation: 'json_valid', params: { url: 'https://example.test/health', expected: 'true' } };
  const operation = /chain ID/i.test(term.text)
    ? 'chain_id_matches'
    : /contract/i.test(term.text)
      ? 'contract_code_exists'
      : /succeeded|successful|completed/i.test(term.text)
        ? 'receipt_status_matches'
        : 'transaction_exists';
  const address = /contract/i.test(term.text) ? CONTRACT : /transaction/i.test(term.text) ? TX : null;
  const expected = /chain ID/i.test(term.text) ? '5042002' : /succeeded|successful|completed/i.test(term.text) ? 'success' : null;
  return evmStep(operation as BaseStep['operation'], address, expected, `${id}-step`, 'arc-testnet', id);
}

function providerResponse(provider: 'gemini' | 'deepseek', plan: VerificationPlan, status = 200): Response {
  if (status !== 200) return new Response(JSON.stringify({ error: { status } }), { status, headers: { 'content-type': 'application/json' } });
  const text = JSON.stringify(plan);
  const body = provider === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { model: 'deepseek-test', choices: [{ message: { content: text } }] };
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('generic EVM conjunctions produce four independent atomic obligations', () => {
  const terms = normalizeAcceptanceTerms(`On EVM Testnet with chain ID 1234, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`);
  assert.equal(terms.length, 4);
  assert.deepEqual(terms.map((term) => term.proofObligation.kind), ['ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_EVENT']);
  assert.match(terms[1]?.text ?? '', /contract/i);
  assert.match(terms[2]?.text ?? '', /exists/i);
  assert.match(terms[3]?.text ?? '', /succeeded/i);
  assert.equal(new Set(terms.map((term) => term.id)).size, 4);
  assert.match(terms[3]?.clause ?? '', /deployed contract code/i);
  assert.equal(terms[2]?.entities?.transactionHash, TX.toLowerCase());
  assert.equal(terms[2]?.conjunctionGroup, terms[3]?.conjunctionGroup);
});

test('conjunction punctuation and equivalent completion language preserve the same four predicates', () => {
  const variants = [
    `On EVM Testnet with chain ID 1234, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`,
    `On EVM Testnet with chain ID 1234; contract ${CONTRACT} is deployed; transaction ${TX} was found and completed successfully.`,
    `On EVM Testnet with chain ID 1234, contract ${CONTRACT} is deployed at ${CONTRACT}, and transaction ${TX} exists, and succeeded.`,
    `On EVM Testnet with chain ID 1234. Contract code exists at ${CONTRACT}; transaction ${TX} was found and was successful.`,
  ];
  for (const variant of variants) {
    const terms = normalizeAcceptanceTerms(variant);
    assert.equal(terms.length, 4, variant);
    assert.deepEqual(terms.map((term) => term.proofObligation.kind), ['ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_EVENT'], variant);
    assert.equal(terms.every((term) => term.sourceSpan.end > term.sourceSpan.start), true, variant);
  }
});

test('incomplete planner routes cannot produce VERIFIED when the ledger retains omitted EVM terms', () => {
  const terms = normalizeAcceptanceTerms(`On EVM Testnet with chain ID 1234, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`);
  const plan = planForTerms(terms, [/contract/i, /succeeded/i]);
  const coverage = buildAcceptanceCoverage(terms, plan);
  const claims = plan.claims.map((claim) => ({ ...claim, steps: claim.steps.map((step) => ({ ...step, result: 'PASS', evidenceIds: ['evidence'], message: 'pass' })), result: 'PASS' }));
  assert.equal(coverage.length, 4);
  assert.equal(coverage.filter((term) => term.disposition === 'NEEDS_EVIDENCE').length, 2);
  assert.equal(evaluateMilestone(claims as never, coverage), 'NEEDS_EVIDENCE');
});

test('the orchestrator cannot issue VERIFIED from a planner that omits EVM predicates', async () => {
  const milestone = `On Arc Testnet with chain ID 5042002, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`;
  const terms = normalizeAcceptanceTerms(milestone);
  const planner = {
    metadata: () => ({ kind: 'synthetic', provider: null, model: null }),
    preflight: () => undefined,
    plan: async () => planForTerms(terms, [/contract/i, /succeeded/i]),
  };
  const base = new BaseAdapter({
    rpcUrls: { base: 'https://rpc.example/base', 'base-sepolia': 'https://rpc.example/base-sepolia', 'arc-testnet': 'https://rpc.example/arc' },
    fetchImpl: async (_input, init) => {
      const method = JSON.parse(String(init?.body ?? '{}')).method;
      const result = method === 'eth_chainId' ? '0x4cef52' : { hash: TX, from: '0x3333333333333333333333333333333333333333', to: CONTRACT };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
    },
  });
  const run = await new VerificationOrchestrator({ planner, base }).verify({ milestone, githubRepository: 'https://github.com/example/synthetic' });
  assert.equal(run.coverage?.length, 4);
  assert.equal(run.verdict, 'NEEDS_EVIDENCE');
  assert.notEqual(run.verdict, 'VERIFIED');
});

test('transaction existence cannot establish transaction success', () => {
  const success = getProofObligationForAssertion(`EVM Testnet transaction ${TX} succeeded`);
  const route = validateProofRoute({ proofObligation: success }, [evmStep('transaction_exists', TX, null, 'tx-exists')]);
  assert.equal(route.ok, false);
});

test('GitHub source existence cannot establish deployed contract code', () => {
  const contract = getProofObligationForAssertion(`EVM Testnet contract ${CONTRACT} has deployed contract code`);
  const route = validateProofRoute({ proofObligation: contract }, [{ id: 'source', claimId: 'source', adapter: 'github', operation: 'file_exists', params: { path: 'contracts/One.sol', expected: null } }]);
  assert.equal(route.ok, false);
  assert.equal(route.disposition, 'UNSUPPORTED');
});

test('chain identity cannot establish deployed contract code', () => {
  const contract = getProofObligationForAssertion(`Arc Testnet contract ${CONTRACT} has deployed contract code`);
  const route = validateProofRoute({ proofObligation: contract }, [evmStep('chain_id_matches', null, '5042002', 'chain')]);
  assert.equal(route.ok, false);
});

test('unknown-chain compound terms remain four explicit unsupported objectives', () => {
  const terms = normalizeAcceptanceTerms(`On Unknown Testnet with chain ID 9999, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`);
  const plan = { ...planForTerms(terms), claims: [], acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'UNSUPPORTED' as const, reason: 'No allowlisted EVM profile.' })) };
  const coverage = buildAcceptanceCoverage(terms, plan);
  assert.equal(terms.length, 4);
  assert.equal(coverage.filter((term) => term.disposition === 'UNSUPPORTED').length, 4);
  assert.equal(coverage.some((term) => term.disposition === 'NOT_OBJECTIVELY_TESTABLE'), false);
});

test('coverage completeness is independently checkable against the source ledger', () => {
  const terms = normalizeAcceptanceTerms('Repository exists; package.json exists');
  const plan = planForTerms(terms);
  const coverage = buildAcceptanceCoverage(terms, plan);
  const isComplete = (coverageModule as unknown as { isAcceptanceCoverageComplete?: (source: readonly NormalizedAcceptanceTerm[], value: readonly unknown[]) => boolean }).isAcceptanceCoverageComplete;
  assert.equal(typeof isComplete, 'function');
  assert.equal(isComplete?.(terms, coverage), true);
  assert.equal(isComplete?.(terms, coverage.slice(0, 1)), false);
  assert.equal(isComplete?.(terms, coverage.map((term, index) => index === 0 ? { ...term, sourceSpan: { ...term.sourceSpan, start: term.sourceSpan.start + 1 } } : term)), false);
});

test('canonical EVM aliases preserve explicit contract-code and receipt-success mappings', () => {
  const terms = normalizeAcceptanceTerms(`Arc Testnet contract ${CONTRACT} has deployed contract code; Arc Testnet transaction ${TX} succeeded`);
  const plan = {
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED', reason: null })),
    claims: terms.map((term, index) => ({
      id: `claim-${index}`,
      acceptanceTermIds: [term.id],
      statement: term.text,
      required: true,
      testability: 'OBJECTIVE',
      steps: [{
        id: `step-${index}`,
        claimId: `claim-${index}`,
        adapter: 'base',
        operation: /contract/i.test(term.text) ? 'contract_code_exists' : 'receipt_status_matches',
        params: { network: 'arc-testnet', address: /contract/i.test(term.text) ? CONTRACT : TX, expected: /contract/i.test(term.text) ? null : 'success' },
      }],
    })),
    missingEvidence: [],
  };
  const parsed = parseCanonicalPlannerOutput(plan, terms);
  assert.deepEqual(parsed.claims.map((claim) => claim.steps[0]?.operation), ['contract_code_exists', 'receipt_status_matches']);
});

test('composite GitHub, HTTP, and EVM scope produces one complete canonical plan', async () => {
  const terms = normalizeAcceptanceTerms(COMPOSITE);
  assert.equal(terms.length, 10);
  const plan = planForTerms(terms);
  assert.doesNotThrow(() => parseCanonicalPlannerOutput(plan, terms));
  const planner = new ProviderPlanner({
    geminiApiKey: 'gemini-test-secret',
    deepseekApiKey: 'deepseek-test-secret',
    maxRetries: 0,
    retryDelayMs: 0,
    fetchImpl: async (input) => String(input).includes('generativelanguage') ? providerResponse('gemini', plan) : providerResponse('deepseek', plan),
  });
  const result = await planner.plan({ milestone: COMPOSITE, githubRepository: 'https://github.com/example/termproof-synthetic', acceptanceTerms: terms });
  assert.equal(result.claims.length, 10);
  assert.equal(new Set(result.claims.flatMap((claim) => claim.acceptanceTermIds ?? [])).size, 10);
  assert.equal(new Set(result.claims.flatMap((claim) => claim.steps.map((step) => step.adapter))).size, 3);
});

test('provider fallback preserves the same independent term ledger', async () => {
  const terms = normalizeAcceptanceTerms(`On Arc Testnet with chain ID 5042002, contract ${CONTRACT} has deployed contract code, and transaction ${TX} exists and succeeded.`);
  assert.equal(terms.length, 4);
  const plan = planForTerms(terms);
  const planner = new ProviderPlanner({
    geminiApiKey: 'gemini-test-secret',
    deepseekApiKey: 'deepseek-test-secret',
    maxRetries: 0,
    retryDelayMs: 0,
    fetchImpl: async (input) => String(input).includes('generativelanguage') ? providerResponse('gemini', plan, 503) : providerResponse('deepseek', plan),
  });
  const result = await planner.plan({ milestone: 'synthetic', githubRepository: 'https://github.com/example/synthetic', acceptanceTerms: terms });
  assert.deepEqual(result.acceptanceTerms?.map((term) => term.id), terms.map((term) => term.id));
  assert.equal(planner.metadata().provider, 'deepseek');
});

test('new EVM receipts use the protocol-neutral provenance namespace', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://rpc.example/base', 'base-sepolia': 'https://rpc.example/base-sepolia', 'arc-testnet': 'https://rpc.example/arc' },
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x4cef52' }), { status: 200 }),
  });
  const arc = await adapter.execute(evmStep('chain_id_matches', null, '5042002', 'arc-chain'));
  const base = await adapter.execute(evmStep('chain_id_matches', null, '8453', 'base-chain', 'base'));
  assert.equal(arc.evidence.source, 'evm://arc-testnet');
  assert.equal(base.evidence.source, 'evm://base');
});

test('semantic planner failures expose a non-secret failure category internally', async () => {
  const terms = normalizeAcceptanceTerms('Repository exists; package.json exists');
  const invalid = { acceptanceTerms: [], claims: [], missingEvidence: [] };
  const planner = new ProviderPlanner({
    geminiApiKey: 'gemini-test-secret',
    maxRetries: 0,
    fetchImpl: async () => providerResponse('gemini', invalid),
  });
  await assert.rejects(
    () => planner.plan({ milestone: 'Repository exists; package.json exists', githubRepository: 'https://github.com/example/synthetic', acceptanceTerms: terms }),
    (error: unknown) => error instanceof PlannerOperationalError && error.code === 'PLANNER_INVALID_OUTPUT' && (error as PlannerOperationalError & { failureCategory?: string }).failureCategory === 'semantic_coverage_rejection',
  );
});
