import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAcceptanceCoverage, normalizeAcceptanceTerms } from '../src/core/coverage.ts';
import { evaluateMilestone } from '../src/core/policy.ts';

const proofletMilestone = [
  'Public repository exists',
  'package.json exists',
  'contracts/EscrowV2.sol exists',
  '/health is reachable',
  'HTTP status equals 200',
  'response is valid JSON',
  'protocol == Prooflet',
  'ok == true',
].join('; ');

const mandateMilestone = 'Mandate has a public implementation repository containing contracts/MandateVault.sol, contracts/MandateFactory.sol, src/agent/planner.mjs, and api/health.mjs. Its production health endpoint at https://mandate-closeout.vercel.app/api/health returns HTTP 200 with valid JSON where ok equals true and service equals mandate.';

function passClaim(id: string, termId: string, termText = '') {
  const route = /HTTP status|health is reachable/i.test(termText)
    ? { adapter: 'http' as const, operation: 'status_matches' as const, params: { url: 'https://example.com/health', expected: '200' } }
    : /valid JSON/i.test(termText)
      ? { adapter: 'http' as const, operation: 'json_valid' as const, params: { url: 'https://example.com/health', expected: 'true' } }
      : /JSON field|protocol ==|ok ==/i.test(termText)
        ? { adapter: 'http' as const, operation: 'json_field_matches' as const, params: { url: 'https://example.com/health', expected: 'ok=true' } }
        : /\.json exists|\.sol exists|\.mjs exists/i.test(termText)
          ? { adapter: 'github' as const, operation: 'file_exists' as const, params: { path: termText.replace(/ exists$/i, ''), expected: null } }
          : { adapter: 'github' as const, operation: 'repo_exists' as const, params: { path: null, expected: null } };
  return {
    id,
    acceptanceTermIds: [termId],
    statement: id,
    required: true,
    testability: 'OBJECTIVE',
    steps: [{ id: `${id}-step`, claimId: id, ...route, result: 'PASS', evidenceIds: [`${id}-evidence`], message: 'pass' }],
    result: 'PASS',
  };
}

test('normalizes every Prooflet acceptance clause into a stable term ID', () => {
  const first = normalizeAcceptanceTerms(proofletMilestone);
  const second = normalizeAcceptanceTerms(`  ${proofletMilestone.replaceAll('; ', ';\n')}  `);
  assert.equal(first.length, 8);
  assert.deepEqual(first.map((term) => term.id), second.map((term) => term.id));
  assert.deepEqual(first.map((term) => term.text), [
    'Public repository exists',
    'package.json exists',
    'contracts/EscrowV2.sol exists',
    '/health is reachable',
    'HTTP status equals 200',
    'response is valid JSON',
    'protocol == Prooflet',
    'ok == true',
  ]);
});

test('atomizes the Mandate promise into nine independently testable acceptance terms', () => {
  const terms = normalizeAcceptanceTerms(mandateMilestone);

  assert.equal(terms.length, 9);
  assert.deepEqual(terms.map((term) => term.text), [
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
  assert.equal(terms.every((term) => term.required), true);
  assert.equal(terms.every((term) => term.testability === 'OBJECTIVE'), true);
  assert.equal(terms.every((term) => term.sourceSpan.end > term.sourceSpan.start), true);
  assert.equal(terms.every((term) => term.sourceText.length > 0), true);
});

test('keeps HTTP status, JSON validity, and independent field predicates separate', () => {
  const terms = normalizeAcceptanceTerms('The endpoint at https://example.com/api?ok=true&service=mandate returns HTTP 200 with valid JSON where ok equals true and service equals "mandate".');
  assert.deepEqual(terms.map((term) => term.text), [
    'Endpoint returns HTTP 200',
    'Endpoint response is valid JSON',
    'Endpoint JSON field ok equals true',
    'Endpoint JSON field service equals "mandate"',
  ]);
});

test('does not split quoted strings, URLs, or ordinary noun phrases containing and', () => {
  const terms = normalizeAcceptanceTerms('The repository contains a command and control module; the endpoint at https://example.com/a?label=rock%20and%20roll returns JSON field message equals "safe and sound".');
  assert.equal(terms.length, 2);
  assert.match(terms[0]?.text ?? '', /command and control/i);
  assert.match(terms[1]?.text ?? '', /safe and sound/i);
  assert.match(terms[1]?.sourceText ?? '', /https:\/\/example\.com\/a\?label=rock%20and%20roll/);
});

test('keeps atomic term IDs and source spans stable for identical input', () => {
  const first = normalizeAcceptanceTerms(mandateMilestone);
  const second = normalizeAcceptanceTerms(mandateMilestone);
  assert.deepEqual(second, first);
  assert.equal(new Set(first.map((term) => term.id)).size, first.length);
});

test('duplicate verifier steps cannot inflate mapped coverage', () => {
  const terms = normalizeAcceptanceTerms('Repository exists');
  const plan = {
    claims: [{
      ...passClaim('claim-repository', terms[0].id),
      steps: [
        { id: 'same-step', claimId: 'claim-repository', adapter: 'github', operation: 'repo_exists', result: 'PASS', evidenceIds: ['evidence-1'], message: 'pass' },
        { id: 'same-step', claimId: 'claim-repository', adapter: 'github', operation: 'repo_exists', result: 'PASS', evidenceIds: ['evidence-2'], message: 'pass' },
      ],
    }],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.deepEqual(coverage[0]?.stepIds, ['same-step']);
});

test('one emitted claim cannot make omitted acceptance terms disappear', () => {
  const terms = normalizeAcceptanceTerms(proofletMilestone);
  const plan = {
    claims: [passClaim('claim-repository', terms[0].id)],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.equal(coverage.length, 8);
  assert.equal(coverage.filter((term) => term.disposition === 'PLANNED').length, 1);
  assert.equal(coverage.filter((term) => term.disposition === 'NEEDS_EVIDENCE').length, 7);
  assert.equal(evaluateMilestone([plan.claims[0]], coverage as never), 'NEEDS_EVIDENCE');
});

test('an omitted awkward middle clause is retained as a coverage gap', () => {
  const terms = normalizeAcceptanceTerms(proofletMilestone);
  const plan = {
    claims: terms.filter((_term, index) => index !== 4).map((term, index) => passClaim(`claim-${index + 1}`, term.id, term.text)),
    acceptanceTerms: terms.filter((_term, index) => index !== 4).map((term) => ({ id: term.id, disposition: 'PLANNED', reason: null })),
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);

  assert.equal(coverage[4].text, 'HTTP status equals 200');
  assert.equal(coverage[4].disposition, 'NEEDS_EVIDENCE');
  assert.match(coverage[4].reason ?? '', /did not account/i);
  assert.equal(coverage.filter((term) => term.disposition === 'PLANNED').length, 7);
  assert.equal(evaluateMilestone(plan.claims as never, coverage), 'NEEDS_EVIDENCE');
});

test('duplicate claims do not inflate term coverage and a claim cannot cover unrelated terms', () => {
  const terms = normalizeAcceptanceTerms('Repository exists; package.json exists');
  const plan = {
    claims: [
      passClaim('claim-one', terms[0].id),
      passClaim('claim-two', terms[0].id),
    ],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.equal(coverage[0].claimIds.length, 2);
  assert.equal(coverage[0].stepIds.length, 2);
  assert.equal(coverage[1].disposition, 'NEEDS_EVIDENCE');

  assert.throws(() => buildAcceptanceCoverage(terms, {
    ...plan,
    claims: [{ ...passClaim('forged', terms[0].id), acceptanceTermIds: [terms[0].id, terms[1].id] }],
  } as never), /one acceptance term/i);
});

test('subjective, unsupported, and missing-evidence terms stay visible as dispositions', () => {
  const terms = normalizeAcceptanceTerms('Repository exists; UI feels trustworthy; proprietary oracle signal is available; endpoint returns 200');
  const plan = {
    claims: [passClaim('claim-repository', terms[0].id)],
    acceptanceTerms: [
      { id: terms[0].id, disposition: 'PLANNED', reason: null },
      { id: terms[1].id, disposition: 'NOT_OBJECTIVELY_TESTABLE', reason: 'Subjective criterion requires human review.' },
      { id: terms[2].id, disposition: 'UNSUPPORTED', reason: 'No supported adapter is available.' },
      { id: terms[3].id, disposition: 'NEEDS_EVIDENCE', reason: 'A recheckable public source is required.' },
    ],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.deepEqual(coverage.map((term) => term.disposition), ['PLANNED', 'NOT_OBJECTIVELY_TESTABLE', 'UNSUPPORTED', 'NEEDS_EVIDENCE']);
  assert.match(coverage[1].reason ?? '', /human review/i);
  assert.match(coverage[2].reason ?? '', /supported adapter/i);
  assert.match(coverage[3].reason ?? '', /public source/i);
});

test('a planner cannot relabel a subjective criterion as objectively planned', () => {
  const terms = normalizeAcceptanceTerms('The interface feels trustworthy');
  const plan = {
    claims: [passClaim('claim-subjective', terms[0].id)],
    acceptanceTerms: [{ id: terms[0].id, disposition: 'PLANNED', reason: null }],
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);

  assert.equal(coverage[0].disposition, 'NOT_OBJECTIVELY_TESTABLE');
  assert.match(coverage[0].reason ?? '', /subjective/i);
  assert.equal(evaluateMilestone(plan.claims as never, coverage), 'NEEDS_EVIDENCE');
});

test('complete coverage plus all PASS verifies, while one objective contradiction fails', () => {
  const terms = normalizeAcceptanceTerms('Repository exists; package.json exists');
  const plan = {
    claims: [passClaim('claim-one', terms[0].id, terms[0].text), passClaim('claim-two', terms[1].id, terms[1].text)],
    acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'PLANNED', reason: null })),
    missingEvidence: [],
  };
  const coverage = buildAcceptanceCoverage(terms, plan as never);
  assert.equal(evaluateMilestone(plan.claims as never, coverage), 'VERIFIED');
  const failed = plan.claims.map((claim, index) => index === 1 ? { ...claim, result: 'FAIL' } : claim);
  assert.equal(evaluateMilestone(failed as never, coverage), 'FAILED');
});
