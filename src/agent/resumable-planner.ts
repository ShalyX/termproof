import { normalizeAcceptanceTerms } from '../core/coverage.ts';
import type { HttpOperation, NormalizedAcceptanceTerm, VerificationPlan } from '../core/types.ts';
import type { MilestonePlanner, PlannerInput, PlannerMetadata } from './planner.ts';

const MATERIALIZER_VERSION = 'resumable-evidence-v1';

interface DeferredHttpRoute {
  operation: HttpOperation;
  expected: string;
}

/**
 * The canonical provider planner intentionally marks a term NEEDS_EVIDENCE when
 * the source URL is absent. The resumable API needs one more deterministic
 * step: when the missing source is an otherwise fully specified HTTP runtime
 * assertion, materialize a deferred HTTP verifier step. No verdict or factual
 * result is introduced here; the supplied URL is still fetched and asserted by
 * the normal HTTP adapter during resume.
 */
export class ResumablePlanner implements MilestonePlanner {
  private readonly inner: MilestonePlanner;

  constructor(inner: MilestonePlanner) {
    this.inner = inner;
  }

  preflight(): void {
    this.inner.preflight?.();
  }

  metadata(): PlannerMetadata {
    const metadata = this.inner.metadata();
    const version = metadata.version?.trim();
    return {
      ...metadata,
      version: version ? `${version}+${MATERIALIZER_VERSION}` : MATERIALIZER_VERSION,
    };
  }

  async plan(input: PlannerInput): Promise<VerificationPlan> {
    const plan = await this.inner.plan(input);
    const terms = input.acceptanceTerms ?? normalizeAcceptanceTerms(input.milestone);
    return materializeResumableEvidence(plan, terms);
  }
}

export function materializeResumableEvidence(
  plan: VerificationPlan,
  terms: readonly NormalizedAcceptanceTerm[],
): VerificationPlan {
  const declarations = plan.acceptanceTerms ?? [];
  const existingTermClaims = new Set(
    plan.claims.flatMap((claim) => claim.acceptanceTermIds ?? []),
  );
  const materialized = new Map<string, DeferredHttpRoute>();

  for (const declaration of declarations) {
    if (declaration.disposition !== 'NEEDS_EVIDENCE') continue;
    if (existingTermClaims.has(declaration.id)) continue;
    const term = terms.find((candidate) => candidate.id === declaration.id);
    if (!term || term.testability !== 'OBJECTIVE') continue;
    if (!term.proofObligation.requiredCapabilities.includes('http.runtime')) continue;
    if (/https:\/\//i.test(term.sourceText) || /https:\/\//i.test(term.text)) continue;
    const route = deferredHttpRoute(term);
    if (route) materialized.set(term.id, route);
  }

  if (materialized.size === 0) return plan;

  const acceptanceTerms = declarations.map((declaration) => materialized.has(declaration.id)
    ? { ...declaration, disposition: 'PLANNED' as const, reason: null }
    : declaration);

  const claims = [...plan.claims];
  for (const term of terms) {
    const route = materialized.get(term.id);
    if (!route) continue;
    const suffix = term.id.replace(/^term-/, '');
    const claimId = `claim-${suffix}-deferred`;
    claims.push({
      id: claimId,
      acceptanceTermIds: [term.id],
      statement: term.text,
      required: term.required,
      testability: term.testability,
      steps: [{
        id: `step-${suffix}-deferred`,
        claimId,
        adapter: 'http',
        operation: route.operation,
        requiresEvidence: true,
        params: { url: '', expected: route.expected },
      }],
    });
  }

  // `missingEvidence` is provider prose, not a stable term-ID list. Rebuild it
  // from the declarations that still genuinely need evidence so a successfully
  // materialized deferred route cannot retain a stale missing-evidence message.
  const missingEvidence = acceptanceTerms
    .filter((declaration) => declaration.disposition === 'NEEDS_EVIDENCE')
    .map((declaration) => declaration.reason ?? declaration.id);

  return {
    ...plan,
    acceptanceTerms,
    claims,
    missingEvidence,
  };
}

function deferredHttpRoute(term: NormalizedAcceptanceTerm): DeferredHttpRoute | null {
  const text = `${term.text} ${term.sourceText}`;

  const status = text.match(/\breturns?\s+(?:HTTP\s*)?(\d{3})\b/i)
    ?? text.match(/\b(?:HTTP\s+)?status\s+(?:equals|is|==)\s*(\d{3})\b/i);
  if (status) return { operation: 'status_matches', expected: status[1] };

  if (/\bvalid\s+JSON\b/i.test(text)) {
    return { operation: 'json_valid', expected: 'true' };
  }

  const field = text.match(/\b(?:JSON\s+field\s+)?([A-Za-z_$][A-Za-z0-9_.-]*)\s*(?:equals|==|is\b)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|true|false|null|-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_-]*)/i);
  if (field && field[1].toLowerCase() !== 'status') {
    return { operation: 'json_field_matches', expected: `${field[1]}=${normalizeFieldValue(field[2])}` };
  }

  const body = text.match(/\bbody\s+(?:contains|includes)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/i);
  if (body) return { operation: 'body_contains', expected: body[1].slice(1, -1) };

  return null;
}

function normalizeFieldValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
