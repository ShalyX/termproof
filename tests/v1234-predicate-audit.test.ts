import assert from 'node:assert/strict';
import test from 'node:test';
import * as coverageModule from '../src/core/coverage.ts';
import { auditSupportedPredicates, buildAcceptanceTermLedger } from '../src/core/coverage.ts';
import { buildAcceptanceCoverage, normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { evaluateMilestone } from '../src/core/policy.ts';
import { parseCanonicalPlannerOutput } from '../src/agent/canonical-planner.ts';
import { EVIDENCE_CAPABILITY_REGISTRY, getProofObligationForAssertion, validateProofRoute } from '../src/core/capabilities.ts';
import type { BaseStep, NormalizedAcceptanceTerm, VerificationPlan, VerificationPlanStep } from '../src/core/types.ts';

const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TX = `0x${'b'.repeat(64)}`;

function evmStep(operation: BaseStep['operation'], address: string | null, expected: string | null, id: string): BaseStep {
  return { id, claimId: id, adapter: 'base', operation, params: { network: 'arc-testnet', address, expected } };
}

function stepForTerm(term: NormalizedAcceptanceTerm, id: string): VerificationPlanStep {
  if (term.predicateType === 'repository_exists') return { id, claimId: id, adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } };
  if (term.predicateType === 'file_exists') return { id, claimId: id, adapter: 'github', operation: 'file_exists', params: { path: term.entities?.path ?? 'contracts/Synthetic.sol', expected: null } };
  if (term.predicateType === 'http_status') return { id, claimId: id, adapter: 'http', operation: 'status_matches', params: { url: term.entities?.url ?? 'https://example.test/health', expected: term.entities?.expected ?? '200' } };
  if (term.predicateType === 'json_valid') return { id, claimId: id, adapter: 'http', operation: 'json_valid', params: { url: term.entities?.url ?? 'https://example.test/health', expected: 'true' } };
  if (term.predicateType === 'chain_identity') return evmStep('chain_id_matches', null, term.entities?.chainId ?? '5042002', id);
  if (term.predicateType === 'contract_code') return evmStep('contract_code_exists', CONTRACT, null, id);
  if (term.predicateType === 'transaction_existence') return evmStep('transaction_exists', TX, null, id);
  if (term.predicateType === 'transaction_success') return evmStep('receipt_status_matches', TX, 'success', id);
  throw new Error(`No synthetic step for ${term.predicateType ?? term.text}`);
}

function planForTerms(terms: NormalizedAcceptanceTerm[], omit: (term: NormalizedAcceptanceTerm) => boolean = () => false): VerificationPlan {
  const claims = terms.filter((term) => !omit(term)).map((term) => {
    const id = `claim-${term.id}`;
    const step = stepForTerm(term, `step-${term.id}`);
    return { id, acceptanceTermIds: [term.id], statement: term.text, required: true, testability: 'OBJECTIVE' as const, steps: [{ ...step, claimId: id }] };
  });
  return { acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED' as const, reason: null })), claims, missingEvidence: [] };
}

test('audits the generic EVM source independently and retains all four obligations', () => {
  const source = `On Arc Testnet with chain ID 5042002, WidgetMandate is deployed with contract code at ${CONTRACT}, and transaction ${TX} exists and succeeded.`;
  const findings = auditSupportedPredicates(source);
  const ledger = buildAcceptanceTermLedger(source);

  assert.deepEqual(findings.map((finding) => finding.canonicalPredicate), [
    'chain_identity',
    'contract_code',
    'transaction_existence',
    'transaction_success',
  ]);
  assert.equal(ledger.terms.length, 4);
  assert.equal(ledger.terms.filter((term) => term.predicateType === 'contract_code').length, 1);
  assert.equal(ledger.audit.unmatchedFindings.length, 0);
  assert.equal(ledger.terms.find((term) => term.predicateType === 'contract_code')?.extractionOrigin, 'deterministic_guard');
});

test('arbitrary contract names do not change the audited obligation set', () => {
  const first = normalizeAcceptanceTerms(`On Arc Testnet with chain ID 5042002, WidgetMandate is deployed at ${CONTRACT}, and transaction ${TX} exists and succeeded.`);
  const second = normalizeAcceptanceTerms(`On Arc Testnet with chain ID 5042002, AnyOtherName is deployed at ${CONTRACT}, and transaction ${TX} exists and succeeded.`);
  assert.deepEqual(first.map((term) => term.predicateType), second.map((term) => term.predicateType));
  assert.equal(first.filter((term) => term.predicateType === 'contract_code').length, 1);
  assert.equal(second.filter((term) => term.predicateType === 'contract_code').length, 1);
});

test('generic EVM deployment language maps to CONTRACT_CODE without requiring the word contract before the name', () => {
  const variants = [
    `On Arc Testnet, WidgetMandate is deployed at ${CONTRACT}.`,
    `On Arc Testnet, WidgetMandate is deployed with contract code at address ${CONTRACT}.`,
    `On Arc Testnet, contract WidgetMandate is deployed at ${CONTRACT}.`,
    `On Arc Testnet, deployed contract code exists at ${CONTRACT}.`,
    `On Arc Testnet, ${CONTRACT} contains deployed bytecode.`,
  ];
  for (const source of variants) {
    const terms = normalizeAcceptanceTerms(source);
    assert.equal(terms.length, 1, source);
    assert.equal(terms[0]?.predicateType, 'contract_code', source);
    assert.equal(terms[0]?.proofOperation, 'contract_code_exists', source);
    assert.equal(terms[0]?.entities?.address, CONTRACT, source);
    assert.equal(getProofObligationForAssertion(source).requiredCapabilities.includes('evm.contract_state'), true, source);
  }
});

test('source audit remains a hard guard when a semantic ledger is intentionally truncated', () => {
  const source = `On Arc Testnet with chain ID 5042002, WidgetMandate is deployed with contract code at ${CONTRACT}, and transaction ${TX} exists and succeeded.`;
  const ledger = buildAcceptanceTermLedger(source);
  const truncated = ledger.terms.filter((term) => term.predicateType !== 'contract_code');
  const plan = planForTerms(truncated);
  const coverage = buildAcceptanceCoverage(truncated, plan);
  const claims = plan.claims.map((claim) => ({ ...claim, steps: claim.steps.map((step) => ({ ...step, result: 'PASS', evidenceIds: ['synthetic'], message: 'pass' })), result: 'PASS' }));
  assert.equal(evaluateMilestone(claims as never, coverage, truncated, ledger.audit), 'NEEDS_EVIDENCE');
});

test('planner omission remains incomplete after the audited ledger contains deployment', () => {
  const source = `On Arc Testnet with chain ID 5042002, WidgetMandate is deployed at ${CONTRACT}, and transaction ${TX} succeeded.`;
  const ledger = buildAcceptanceTermLedger(source);
  const plan = planForTerms(ledger.terms, (term) => term.predicateType === 'contract_code');
  const coverage = buildAcceptanceCoverage(ledger.terms, plan);
  assert.equal(coverage.find((term) => term.predicateType === 'contract_code')?.disposition, 'NEEDS_EVIDENCE');
});

test('chain, transaction existence, and receipt success cannot satisfy CONTRACT_CODE', () => {
  const contract = getProofObligationForAssertion(`On Arc Testnet contract ${CONTRACT} is deployed`);
  for (const step of [
    evmStep('chain_id_matches', null, '5042002', 'chain'),
    evmStep('transaction_exists', TX, null, 'tx'),
    evmStep('receipt_status_matches', TX, 'success', 'receipt'),
  ]) {
    assert.equal(validateProofRoute({ proofObligation: contract }, [step]).ok, false);
  }
});

test('mixed GitHub, HTTP, and EVM source preserves eight atomic terms through canonical planning', () => {
  const source = `A public implementation repository containing contracts/One.sol, contracts/Two.sol, and src/agent.mjs. Its public endpoint at https://example.test/health returns HTTP 200 with valid JSON. On Arc Testnet, WidgetMandate is deployed at ${CONTRACT}, and transaction ${TX} succeeded.`;
  const ledger = buildAcceptanceTermLedger(source);
  assert.equal(ledger.terms.length, 8);
  assert.equal(new Set(ledger.terms.map((term) => term.predicateType)).size, 6);
  const plan = planForTerms(ledger.terms);
  const parsed = parseCanonicalPlannerOutput(plan, ledger.terms);
  const coverage = buildAcceptanceCoverage(ledger.terms, parsed);
  assert.equal(coverage.length, 8);
  assert.equal(coverage.every((term) => term.mappedVerifierStepIds.length === 1), true);
  const omitted = planForTerms(ledger.terms, (term) => term.predicateType === 'contract_code');
  assert.equal(buildAcceptanceCoverage(ledger.terms, omitted).find((term) => term.predicateType === 'contract_code')?.disposition, 'NEEDS_EVIDENCE');
});

test('capability-oriented audit covers every currently supported predicate family', () => {
  const source = `A public repository exists containing package.json and src/agent.mjs. The endpoint at https://example.test/health returns HTTP 200 with valid JSON where ok equals true. On Arc Testnet with chain ID 5042002, WidgetMandate is deployed at ${CONTRACT}, and transaction ${TX} exists and succeeded. npm package @scope/synthetic exists at exact version 1.2.3 with repository association https://github.com/example/synthetic and distribution metadata integrity.`;
  const types = new Set(auditSupportedPredicates(source).map((finding) => finding.canonicalPredicate));
  for (const type of ['repository_exists', 'file_exists', 'http_status', 'json_valid', 'json_field_equals', 'chain_identity', 'contract_code', 'transaction_existence', 'transaction_success', 'npm_package_exists', 'npm_version', 'npm_repository', 'npm_distribution_metadata']) {
    assert.equal(types.has(type as never), true, type);
  }
});

test('predicate detectors are registered against the generic capability descriptors', () => {
  assert.deepEqual(EVIDENCE_CAPABILITY_REGISTRY['evm.contract_state'].predicateTypes, ['contract_code']);
  assert.deepEqual(EVIDENCE_CAPABILITY_REGISTRY['evm.event'].predicateTypes, ['transaction_success']);
  assert.deepEqual(EVIDENCE_CAPABILITY_REGISTRY['npm.package_state'].predicateTypes, ['npm_package_exists', 'npm_version', 'npm_repository', 'npm_distribution_metadata']);
});

test('coverage completeness protects detected predicate and proof-operation provenance', () => {
  const source = `On Arc Testnet, WidgetMandate is deployed at ${CONTRACT}.`;
  const ledger = buildAcceptanceTermLedger(source);
  const plan = planForTerms(ledger.terms);
  const coverage = buildAcceptanceCoverage(ledger.terms, plan);
  assert.equal(coverage.length, 1);
  assert.equal((coverageModule as unknown as { isAcceptanceCoverageComplete: (terms: readonly NormalizedAcceptanceTerm[], coverage: readonly unknown[]) => boolean }).isAcceptanceCoverageComplete(ledger.terms, coverage.map((term) => ({ ...term, predicateType: 'transaction_existence' }))), false);
  assert.equal((coverageModule as unknown as { isAcceptanceCoverageComplete: (terms: readonly NormalizedAcceptanceTerm[], coverage: readonly unknown[]) => boolean }).isAcceptanceCoverageComplete(ledger.terms, coverage.map((term) => ({ ...term, proofOperation: 'transaction_exists' }))), false);
});
