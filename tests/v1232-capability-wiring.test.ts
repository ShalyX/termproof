import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_PLAN_SCHEMA, parseCanonicalPlannerOutput, plannerPrompt } from '../src/agent/canonical-planner.ts';
import { buildAcceptanceCoverage, normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { EVIDENCE_CAPABILITY_REGISTRY, getSupportedEvmProfiles, getSupportedEvmProfilesForCapability, validateProofRoute } from '../src/core/capabilities.ts';
import { EVM_CHAIN_PROFILES } from '../src/core/evm-profiles.ts';
import type { AcceptanceTerm, BaseStep, VerificationPlanStep } from '../src/core/types.ts';

const CONTRACT = '0x4200000000000000000000000000000000000006';
const TX = `0x${'b'.repeat(64)}`;
type SchemaVariant = { properties?: { network?: { enum?: string[] } } };

function arcStep(operation: BaseStep['operation'], address: string | null, expected: string | null, id = `step-${operation}`): BaseStep {
  return { id, claimId: id, adapter: 'base', operation, params: { network: 'arc-testnet', address, expected } };
}

test('the capability registry is the authoritative source for planner EVM profiles', () => {
  const profiles = [...getSupportedEvmProfiles()];
  assert.deepEqual([...profiles].sort(), Object.keys(EVM_CHAIN_PROFILES).sort());
  assert.deepEqual([...getSupportedEvmProfilesForCapability('evm.transaction')].sort(), [...profiles].sort());
  assert.equal(EVIDENCE_CAPABILITY_REGISTRY['evm.transaction'].supported, true);

  const schema = CANONICAL_PLAN_SCHEMA as unknown as { properties: { claims: { items: { properties: { steps: { items: { properties: { params: { anyOf: SchemaVariant[] } } } } } } } } };
  const networkEnum = schema.properties.claims.items.properties.steps.items.properties.params.anyOf.find((variant) => variant.properties?.network)?.properties?.network?.enum ?? [];
  assert.deepEqual([...networkEnum].sort(), [...profiles].sort());
  assert.match(plannerPrompt({ milestone: 'Arc Testnet chain ID equals 5042002', githubRepository: 'https://github.com/acme/repo' }, [] as never), /arc-testnet/i);
});

test('Arc semantic routing and verifier steps use the shared generic EVM capability', () => {
  const terms = normalizeAcceptanceTerms(`Arc Testnet contract ${CONTRACT} is deployed`);
  const route = validateProofRoute(terms[0] as AcceptanceTerm, [arcStep('contract_deployed', CONTRACT, null)]);
  assert.equal(route.ok, true);
  assert.equal(route.capability, 'evm.contract_state');
  assert.equal(route.disposition, 'NEEDS_EVIDENCE');
});

test('Arc compound on-chain wording atomizes before capability resolution', () => {
  const terms = normalizeAcceptanceTerms(`On Arc Testnet with chain ID 5042002, contract ${CONTRACT} has deployed code, transaction ${TX} exists, and transaction ${TX} succeeded.`);
  assert.equal(terms.length, 4);
  assert.deepEqual(terms.map((term) => term.proofObligation.kind), ['ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_STATE', 'ONCHAIN_EVENT']);
  assert.equal(terms.every((term) => term.testability === 'OBJECTIVE'), true);
  assert.equal(terms.every((term) => term.sourceSpan.end > term.sourceSpan.start), true);
});

test('an unsupported compound chain keeps every objective term independently visible', () => {
  const terms = normalizeAcceptanceTerms(`On UnknownNet with chain ID 999999, contract ${CONTRACT} has deployed code, transaction ${TX} exists, and transaction ${TX} succeeded.`);
  const plan = { acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'UNSUPPORTED' as const, reason: 'No allowlisted verifier profile is available.' })), claims: [], missingEvidence: [] };
  const coverage = buildAcceptanceCoverage(terms, plan);
  assert.equal(terms.length, 4);
  assert.equal(coverage.length, 4);
  assert.equal(coverage.every((term) => term.testability === 'OBJECTIVE'), true);
  assert.equal(coverage.every((term) => term.disposition === 'UNSUPPORTED'), true);
  assert.equal(coverage.some((term) => term.disposition === 'NOT_OBJECTIVELY_TESTABLE'), false);
});

test('subjective criteria remain human review rather than unsupported objective terms', () => {
  const terms = normalizeAcceptanceTerms('The interface feels trustworthy');
  const plan = { acceptanceTerms: [{ id: terms[0]?.id, disposition: 'NOT_OBJECTIVELY_TESTABLE' as const, reason: 'Subjective criterion requires human review.' }], claims: [], missingEvidence: [] };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.equal(coverage[0]?.disposition, 'NOT_OBJECTIVELY_TESTABLE');
  assert.equal(coverage[0]?.testability, 'HUMAN');
});

test('mixed GitHub, HTTP, and Arc terms pass one canonical validation path', () => {
  const terms = normalizeAcceptanceTerms(`Public repository exists; endpoint at https://service.example/health returns HTTP 200 with valid JSON; Arc Testnet chain ID equals 5042002; Arc Testnet contract ${CONTRACT} is deployed.`);
  const repoTerm = terms.find((term) => /repository exists/i.test(term.text));
  const statusTerm = terms.find((term) => /HTTP 200/i.test(term.text));
  const jsonTerm = terms.find((term) => /valid JSON/i.test(term.text));
  const chainTerm = terms.find((term) => /chain ID/i.test(term.text));
  const contractTerm = terms.find((term) => /contract 0x/i.test(term.text));
  const steps: VerificationPlanStep[] = [
    { id: 'repo', claimId: 'claim-0', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } },
    { id: 'status', claimId: 'claim-1', adapter: 'http', operation: 'status_matches', params: { url: 'https://service.example/health', expected: '200' } },
    { id: 'json', claimId: 'claim-2', adapter: 'http', operation: 'json_valid', params: { url: 'https://service.example/health', expected: 'true' } },
    arcStep('chain_id_matches', null, '5042002', 'claim-3'),
    arcStep('contract_deployed', CONTRACT, null, 'claim-4'),
  ];
  const claims = [repoTerm, statusTerm, jsonTerm, chainTerm, contractTerm].map((term, index) => ({
    id: `claim-${index}`,
    acceptanceTermIds: [term?.id ?? 'missing'],
    statement: term?.text ?? 'missing',
    required: true,
    testability: 'OBJECTIVE' as const,
    steps: [steps[index] as VerificationPlanStep],
  }));
  const plan = parseCanonicalPlannerOutput({
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED' as const, reason: null })),
    claims,
    missingEvidence: [],
  }, terms);
  assert.equal(plan.claims.length, terms.length);
  assert.equal(plan.claims.filter((claim) => claim.steps.some((step) => step.adapter === 'base')).length, 2);
});
