import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAcceptanceCoverage, normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { getCapabilityForStep, getProofObligationForAssertion } from '../src/core/capabilities.ts';
import { evaluateMilestone } from '../src/core/policy.ts';

function claim(id: string, termId: string, operation: 'repo_exists' | 'file_exists', path: string | null = null) {
  return {
    id,
    acceptanceTermIds: [termId],
    statement: id,
    required: true,
    testability: 'OBJECTIVE' as const,
    steps: [{ id: `${id}-step`, claimId: id, adapter: 'github' as const, operation, params: { path, expected: null } }],
  };
}

test('proof obligations distinguish presence from implementation behavior', () => {
  assert.equal(getProofObligationForAssertion('foo.js exists').kind, 'PRESENCE');
  assert.equal(getProofObligationForAssertion('foo.js implements a background worker').kind, 'BEHAVIORAL_TRACE');
  assert.equal(getProofObligationForAssertion('application is functional in production').kind, 'BEHAVIORAL_TRACE');
  assert.equal(getProofObligationForAssertion('dataset is durably stored on Walrus').kind, 'PROTOCOL_OBJECT');
});

test('a broad repository claim cannot satisfy an implementation proof obligation', () => {
  const terms = normalizeAcceptanceTerms('foo.js implements a background worker');
  const plan = {
    claims: [claim('implementation', terms[0].id, 'file_exists', 'foo.js')],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);

  assert.notEqual(coverage[0]?.disposition, 'PLANNED');
  assert.match(coverage[0]?.reason ?? '', /proof|behavior|structure|supported/i);
  assert.equal(evaluateMilestone([plan.claims[0] as never], coverage), 'NEEDS_EVIDENCE');
});

test('unknown protocol evidence is unsupported instead of falling back to repository presence', () => {
  const terms = normalizeAcceptanceTerms('Dataset is durably stored on Walrus');
  const plan = {
    claims: [claim('dataset', terms[0].id, 'repo_exists')],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);

  assert.equal(coverage[0]?.disposition, 'UNSUPPORTED');
  assert.match(coverage[0]?.reason ?? '', /protocol|capability|evidence/i);
});

test('subjective criteria are human review even when a sponsor name is present', () => {
  for (const assertion of [
    'excellent user experience',
    'meaningful use of Arc',
    'strong product',
    'innovative implementation',
    'high-quality UX',
  ]) {
    assert.equal(getProofObligationForAssertion(assertion).kind, 'SUBJECTIVE_HUMAN', assertion);
  }
});

test('capability registry maps a Base chain check to EVM evidence, not a sponsor branch', () => {
  assert.equal(getCapabilityForStep({ adapter: 'base', operation: 'chain_id_matches' } as never), 'evm.chain_identity');
  assert.equal(getCapabilityForStep({ adapter: 'github', operation: 'repo_exists' } as never), 'github.repository_presence');
});

test('a named unsupported chain cannot be silently verified against Base', () => {
  const terms = normalizeAcceptanceTerms('Ethereum contract 0x4200000000000000000000000000000000000006 is deployed');
  const plan = {
    claims: [claim('ethereum', terms[0].id, 'file_exists', 'contract.txt')],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.equal(coverage[0]?.disposition, 'UNSUPPORTED');
  assert.match(coverage[0]?.reason ?? '', /chain profile|allowlisted/i);
});
