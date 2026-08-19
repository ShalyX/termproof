import { isAcceptanceCoverageComplete } from './coverage.ts';
import { predicateSignature } from './predicate-audit.ts';
import type { AcceptanceTermAudit, AcceptanceTermCoverage, ClaimExecution, ClaimResult, MilestoneVerdict, NormalizedAcceptanceTerm } from './types.ts';

export function evaluateClaim(claim: ClaimExecution): ClaimResult {
  if (claim.testability === 'HUMAN') return 'NOT_TESTABLE';
  if (claim.steps.length === 0) return 'INCONCLUSIVE';
  if (claim.steps.some((step) => step.result === 'FAIL')) return 'FAIL';
  if (claim.steps.some((step) => step.result === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

export function evaluateMilestone(claims: Array<ClaimExecution & { result: ClaimResult }>, coverage: readonly AcceptanceTermCoverage[] = [], ledger: readonly NormalizedAcceptanceTerm[] | null = null, audit: AcceptanceTermAudit | null = null): MilestoneVerdict {
  const required = claims.filter((claim) => claim.required);
  if (required.some((claim) => claim.result === 'FAIL')) return 'FAILED';
  if (coverage.length === 0 || (ledger && !isAcceptanceCoverageComplete(ledger, coverage)) || (ledger && audit && !isSourcePredicateAuditComplete(ledger, audit)) || coverage.some((term) => term.required && term.disposition !== 'PLANNED')) return 'NEEDS_EVIDENCE';
  if (required.some((claim) => claim.result === 'INCONCLUSIVE' || claim.result === 'NOT_TESTABLE')) return 'NEEDS_EVIDENCE';
  if (required.length > 0 && required.every((claim) => claim.result === 'PASS')) return 'VERIFIED';
  if (claims.some((claim) => claim.result === 'PASS')) return 'PARTIALLY_VERIFIED';
  return 'NEEDS_EVIDENCE';
}

export function isSourcePredicateAuditComplete(terms: readonly NormalizedAcceptanceTerm[], audit: AcceptanceTermAudit): boolean {
  if (!audit.complete || audit.unmatchedFindings.length > 0) return false;
  return audit.findings.every((finding) => terms.some((term) => {
    if (term.predicateType !== finding.canonicalPredicate) return false;
    const termSignature = predicateSignature(term.predicateType, term.entities ?? {});
    if (termSignature === finding.signature) return true;
    return Object.entries(finding.entities).every(([key, value]) => term.entities?.[key]?.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  }));
}
