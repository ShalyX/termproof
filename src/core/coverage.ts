import { createHash } from 'node:crypto';
import { getProofObligationForAssertion, validateProofRoute } from './capabilities.ts';
import { auditSupportedPredicates } from './predicate-audit.ts';
import type {
  AcceptanceTermAudit,
  AcceptanceTermCoverage,
  AcceptanceTermDisposition,
  AcceptanceTermExtractionOrigin,
  NormalizedAcceptanceTerm,
  ProofObligation,
  SupportedPredicateFinding,
  SupportedPredicateType,
  VerificationPlan,
} from './types.ts';

interface SourceSegment {
  text: string;
  sourceText: string;
  start: number;
  end: number;
}

interface DraftTerm {
  text: string;
  sourceText: string;
  start: number;
  end: number;
  clause?: string;
  predicate?: string;
  predicateType?: SupportedPredicateType;
  extractionOrigin?: AcceptanceTermExtractionOrigin;
  proofOperation?: string;
  proofObligation?: ProofObligation;
  entities?: Record<string, string>;
  conjunctionGroup?: string;
}

export interface AcceptanceTermLedger {
  sourceText: string;
  sourceHash: string;
  terms: NormalizedAcceptanceTerm[];
  audit: AcceptanceTermAudit;
}

export { auditSupportedPredicates } from './predicate-audit.ts';

/**
 * Convert the original promise into deterministic, independently falsifiable
 * terms. This intentionally recognizes the bounded assertion language the
 * adapters can prove; unknown sentences remain visible as one term instead of
 * being silently discarded.
 */
export function normalizeAcceptanceTerms(milestone: string): NormalizedAcceptanceTerm[] {
  return buildAcceptanceTermLedger(milestone).terms;
}

export function buildAcceptanceTermLedger(milestone: string): AcceptanceTermLedger {
  const findings = auditSupportedPredicates(milestone);
  const { terms, unmatchedFindings } = normalizeAcceptanceTermsInternal(milestone, findings);
  const audit: AcceptanceTermAudit = {
    findings,
    unmatchedFindings,
    complete: unmatchedFindings.length === 0,
    reason: unmatchedFindings.length === 0 ? null : 'LEDGER_INCOMPLETE',
  };
  return {
    sourceText: milestone,
    sourceHash: createHash('sha256').update(milestone).digest('hex'),
    terms,
    audit,
  };
}

function normalizeAcceptanceTermsInternal(milestone: string, findings: readonly SupportedPredicateFinding[] = auditSupportedPredicates(milestone)): { terms: NormalizedAcceptanceTerm[]; unmatchedFindings: SupportedPredicateFinding[] } {
  const semanticDrafts = splitAcceptanceSegments(milestone).flatMap(atomizeSegment);
  const matchedFindings = new Set<string>();
  const drafts = semanticDrafts.map((draft) => {
    const match = findMatchingPredicate(draft, findings, matchedFindings);
    if (!match) return draft;
    matchedFindings.add(match.signature);
    return {
      ...draft,
      predicateType: match.canonicalPredicate,
      extractionOrigin: 'both' as const,
      proofOperation: match.operation,
      proofObligation: match.proofObligation,
      entities: { ...match.entities, ...(draft.entities ?? {}) },
      predicate: match.predicate,
      clause: draft.clause ?? match.sourceText,
    };
  });
  const unmatchedFindings = findings.filter((finding) => !matchedFindings.has(finding.signature));
  for (const match of unmatchedFindings) {
    matchedFindings.add(match.signature);
    drafts.push({
      text: match.predicate,
      sourceText: match.sourceText,
      start: match.sourceSpan.start,
      end: match.sourceSpan.end,
      clause: milestone,
      predicate: match.predicate,
      predicateType: match.canonicalPredicate,
      extractionOrigin: 'deterministic_guard',
      proofOperation: match.operation,
      proofObligation: match.proofObligation,
      entities: match.entities,
      conjunctionGroup: `${match.sourceSpan.start}:${match.sourceSpan.end}`,
    });
  }
  drafts.sort((left, right) => left.start - right.start || left.end - right.end);
  const unresolvedFindings = findings.filter((finding) => !matchedFindings.has(finding.signature));
  const occurrences = new Map<string, number>();

  return { terms: drafts.map((draft) => {
    const assertion = normalizeAssertion(draft.text);
    const occurrence = (occurrences.get(assertion) ?? 0) + 1;
    occurrences.set(assertion, occurrence);
    const hash = createHash('sha256').update(`${assertion}#${occurrence}`).digest('hex').slice(0, 10);
    const entities = { ...extractEntities(assertion), ...(draft.entities ?? {}) };
    return {
      id: `term-${hash}`,
      text: draft.text,
      assertion,
      sourceText: draft.sourceText,
      sourceSpan: { start: draft.start, end: draft.end },
      required: true,
      testability: isSubjectiveCriterion(assertion) ? 'HUMAN' : 'OBJECTIVE',
      proofObligation: draft.proofObligation ?? getProofObligationForAssertion(assertion),
      ...(draft.clause ? { clause: draft.clause } : {}),
      ...(draft.predicate ? { predicate: draft.predicate } : {}),
      ...(draft.predicateType ? { predicateType: draft.predicateType } : {}),
      ...(draft.extractionOrigin ? { extractionOrigin: draft.extractionOrigin } : {}),
      ...(draft.proofOperation ? { proofOperation: draft.proofOperation } : {}),
      ...(Object.keys(entities).length > 0 ? { entities } : {}),
      ...(draft.conjunctionGroup ? { conjunctionGroup: draft.conjunctionGroup } : {}),
    };
  }), unmatchedFindings: unresolvedFindings };
}

function findMatchingPredicate(draft: DraftTerm, findings: readonly SupportedPredicateFinding[], matched: Set<string>): SupportedPredicateFinding | null {
  return findings.find((finding) => {
    if (matched.has(finding.signature)) return false;
    if (draft.predicateType && draft.predicateType !== finding.canonicalPredicate) return false;
    const draftEntities = { ...(draft.entities ?? {}), ...extractEntities(normalizeAssertion(draft.text)) };
    for (const [key, value] of Object.entries(finding.entities)) {
      if (draftEntities[key] && normalizeEntity(draftEntities[key]) !== normalizeEntity(value)) return false;
    }
    return spansOverlap(draft.start, draft.end, finding.sourceSpan.start, finding.sourceSpan.end);
  }) ?? null;
}

function spansOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function isAcceptanceCoverageComplete(terms: readonly NormalizedAcceptanceTerm[], coverage: readonly Pick<AcceptanceTermCoverage, 'id' | 'assertion' | 'sourceSpan' | 'required' | 'disposition' | 'predicateType' | 'extractionOrigin' | 'proofOperation' | 'proofObligation'>[]): boolean {
  if (terms.length !== coverage.length) return false;
  const seen = new Set<string>();
  for (const term of terms) {
    const match = coverage.find((candidate) => candidate.id === term.id);
    if (!match || seen.has(match.id) || match.assertion !== term.assertion || match.sourceSpan.start !== term.sourceSpan.start || match.sourceSpan.end !== term.sourceSpan.end || match.required !== term.required || match.predicateType !== term.predicateType || match.extractionOrigin !== term.extractionOrigin || match.proofOperation !== term.proofOperation || match.proofObligation.kind !== term.proofObligation.kind || match.proofObligation.requiredCapabilities.join('|') !== term.proofObligation.requiredCapabilities.join('|')) return false;
    seen.add(match.id);
    if (term.required && !match.disposition) return false;
  }
  return seen.size === terms.length;
}

export function buildAcceptanceCoverage(terms: NormalizedAcceptanceTerm[], plan: VerificationPlan): AcceptanceTermCoverage[] {
  const termIds = new Set(terms.map((term) => term.id));
  const declarations = new Map<string, { disposition: AcceptanceTermDisposition; reason: string | null }>();
  for (const declaration of plan.acceptanceTerms ?? []) {
    if (!termIds.has(declaration.id)) throw new Error(`Planner returned an unknown acceptance term: ${declaration.id}`);
    if (declarations.has(declaration.id)) throw new Error(`Planner returned a duplicate acceptance term: ${declaration.id}`);
    declarations.set(declaration.id, { disposition: declaration.disposition, reason: declaration.reason });
  }

  const claimIds = new Set<string>();
  for (const claim of plan.claims) {
    if (claimIds.has(claim.id)) throw new Error(`Planner returned a duplicate claim: ${claim.id}`);
    claimIds.add(claim.id);
    const linkedTerms = claim.acceptanceTermIds ?? [];
    if (linkedTerms.length > 1) throw new Error(`Claim ${claim.id} must link to one acceptance term`);
    for (const termId of linkedTerms) {
      if (!termIds.has(termId)) throw new Error(`Claim ${claim.id} linked to an unknown acceptance term`);
    }
  }

  return terms.map((term) => {
    const declaration = declarations.get(term.id);
    const linkedClaims = plan.claims.filter((claim) => (claim.acceptanceTermIds ?? []).includes(term.id));
    const linkedClaimIds = [...new Set(linkedClaims.map((claim) => claim.id))];
    const linkedStepIds = [...new Set(linkedClaims.flatMap((claim) => claim.steps.map((step) => step.id)))];
    let disposition: AcceptanceTermDisposition = declaration?.disposition ?? 'NEEDS_EVIDENCE';
    let reason = declaration ? declaration.reason : 'Planner did not account for this acceptance term.';

    if (disposition === 'PLANNED' && (term.testability === 'HUMAN' || isSubjectiveCriterion(term.assertion))) {
      disposition = 'NOT_OBJECTIVELY_TESTABLE';
      reason = 'This criterion is subjective and requires human review.';
    }
    if (disposition === 'PLANNED' && linkedClaims.length === 0) {
      disposition = 'NEEDS_EVIDENCE';
      reason = 'No executable claim was linked to this acceptance term.';
    } else if (disposition === 'PLANNED' && linkedStepIds.length === 0) {
      disposition = 'NEEDS_EVIDENCE';
      reason = 'The linked claim has no executable verifier step.';
    }

    const route = validateProofRoute(term, linkedClaims.flatMap((claim) => claim.steps));
    if (disposition === 'PLANNED' && !route.ok) {
      disposition = route.disposition;
      reason = route.reason;
    }

    return {
      ...term,
      disposition,
      mappedClaimIds: linkedClaimIds,
      mappedVerifierStepIds: linkedStepIds,
      claimIds: linkedClaimIds,
      stepIds: linkedStepIds,
      reason,
      selectedCapability: route.capability,
      evidenceEstablished: [],
    };
  });
}

function splitAcceptanceSegments(source: string): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let segmentStart = 0;
  let quote: '"' | "'" | null = null;

  const push = (rawStart: number, rawEnd: number) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(source[start] ?? '')) start += 1;
    while (end > start && /\s/.test(source[end - 1] ?? '')) end -= 1;
    const bullet = source.slice(start, end).match(/^(?:[-*•]|\d+[.)])\s+/);
    if (bullet) start += bullet[0].length;
    while (start < end && /\s/.test(source[start] ?? '')) start += 1;
    if (start >= end) return;
    const sourceText = source.slice(start, end).replace(/[!?]\s*$/, '').replace(/\.\s*$/, '').trim();
    if (!sourceText) return;
    segments.push({ text: sourceText.replace(/\s+/g, ' '), sourceText, start, end: start + sourceText.length });
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ';' || character === '\n' || (character === '.' && isSentenceBoundary(source, index))) {
      if (character === ';' && isInsideUrl(source, index) && !/\s/.test(source[index + 1] ?? '')) continue;
      push(segmentStart, index);
      segmentStart = index + 1;
    }
  }
  push(segmentStart, source.length);
  return segments;
}

function isSentenceBoundary(source: string, index: number): boolean {
  if (isInsideUrl(source, index)) return false;
  if (!/\s/.test(source[index + 1] ?? '')) return false;
  let next = index + 1;
  while (/\s/.test(source[next] ?? '')) next += 1;
  return /[A-Z0-9]/.test(source[next] ?? '');
}

function isInsideUrl(source: string, index: number): boolean {
  let start = index - 1;
  while (start >= 0 && !/\s/.test(source[start] ?? '')) start -= 1;
  return source.slice(start + 1, index).includes('://');
}

function atomizeSegment(segment: SourceSegment): DraftTerm[] {
  const repositoryTerms = atomizeRepository(segment);
  if (repositoryTerms.length > 0) return repositoryTerms;

  const npmTerms = atomizeNpm(segment);
  if (npmTerms.length > 0) return npmTerms;

  const evmTerms = atomizeEvm(segment);
  if (evmTerms.length > 0) return evmTerms;

  const httpTerms = atomizeHttp(segment);
  if (httpTerms.length > 0) return httpTerms;

  return [draft(segment.text, segment)];
}

function atomizeRepository(segment: SourceSegment): DraftTerm[] {
  const match = segment.text.match(/\bpublic\s+(?:implementation\s+)?repository\s+containing\s+(.+)$/i);
  if (!match) return [];
  const items = splitFileList(match[1]);
  if (items.length < 2 || !items.every(isFilePath)) return [];

  const repositoryStart = segment.text.search(/\bpublic\s+(?:implementation\s+)?repository\b/i);
  const containingStart = segment.text.toLowerCase().indexOf('containing', repositoryStart);
  const terms: DraftTerm[] = [draft('Public repository exists', {
    ...segment,
    start: segment.start + Math.max(0, repositoryStart),
    end: segment.start + Math.max(repositoryStart + 1, containingStart),
    sourceText: segment.sourceText.slice(Math.max(0, repositoryStart), Math.max(repositoryStart + 1, containingStart)).trim(),
  })];
  let searchFrom = Math.max(0, containingStart + 'containing'.length);
  for (const item of items) {
    const itemStart = segment.text.indexOf(item, searchFrom);
    const start = itemStart >= 0 ? itemStart : searchFrom;
    terms.push(draft(`${item} exists`, {
      ...segment,
      start: segment.start + start,
      end: segment.start + start + item.length,
      sourceText: item,
    }));
    searchFrom = start + item.length;
  }
  return terms;
}

function splitFileList(value: string): string[] {
  const commaSeparated = value.replace(/,\s*(?:and|&)\s+/gi, ', ')
    .split(',')
    .map((item) => item.trim().replace(/^and\s+/i, '').replace(/[.!?]+$/, '').trim())
    .filter(Boolean);
  if (commaSeparated.length > 1) return commaSeparated;
  const andSeparated = value.split(/\s+and\s+/i).map((item) => item.trim().replace(/[.!?]+$/, '').trim()).filter(Boolean);
  return andSeparated.length > 1 ? andSeparated : commaSeparated;
}

function isFilePath(value: string): boolean {
  return /^[A-Za-z0-9._~/-]+$/.test(value) && /[/.]/.test(value);
}

function atomizeHttp(segment: SourceSegment): DraftTerm[] {
  const text = segment.text;
  const hasUrl = /https?:\/\//i.test(text);
  const hasHttpLanguage = /\b(?:HTTP|endpoint|JSON)\b/i.test(text);
  if (!hasHttpLanguage) return [];

  const status = text.match(/\breturns?\s+(?:HTTP\s*)?(\d{3})\b/i)
    ?? text.match(/\b(?:HTTP\s+)?status\s+(?:equals|is|==)\s+(\d{3})\b/i);
  const validJson = /\bvalid\s+JSON\b/i.test(text);
  const fields = [...text.matchAll(/\b([A-Za-z_$][A-Za-z0-9_.-]*)\s*(?:equals|==|is\b)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|true|false|null|-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_-]*)/gi)]
    .filter((match) => match[1].toLowerCase() !== 'status');

  if (!hasUrl) return [];
  if (!status && !validJson && fields.length === 0) return [];

  const label = /\bhealth\b/i.test(text) ? 'Health endpoint' : /\bendpoint\b/i.test(text) ? 'Endpoint' : 'HTTP';
  const terms: DraftTerm[] = [];
  if (status) terms.push(draft(`${label} returns HTTP ${status[1]}`, segment));
  if (validJson) terms.push(draft(`${label.replace(/ endpoint$/, '')} response is valid JSON`, segment));
  for (const field of fields) {
    const key = field[1];
    const value = normalizeFieldValue(field[2]);
    terms.push(draft(`${label.replace(/ endpoint$/, '')} JSON field ${key} equals ${value}`, segment));
  }
  return terms;
}

function atomizeEvm(segment: SourceSegment): DraftTerm[] {
  const terms: DraftTerm[] = [];
  const chain = segment.text.match(/\b(?:on\s+)?([A-Za-z][A-Za-z0-9-]*(?:\s+(?:testnet|mainnet|sepolia))?)\s+(?:with\s+)?chain\s+ID\s+(?:equals|is|==)?\s*(\d+)\b/i);
  const profileLabel = chain?.[1] ?? segment.text.match(/\b([A-Za-z][A-Za-z0-9-]*(?:\s+(?:testnet|mainnet|sepolia))?)\s+(?=contract|transaction)\b/i)?.[1];
  const prefix = profileLabel ? `${profileLabel} ` : '';
  if (chain) {
    terms.push(draftMatch(`${chain[1]} chain ID equals ${chain[2]}`, segment, chain));
  }

  const contractMatches = [
    /\bcontract\s+(0x[a-f0-9]{40})\b\s+(?:has\s+)?(?:deployed\s+)?(?:contract\s+)?code\b/i,
    /\bcontract\s+(0x[a-f0-9]{40})\b\s+(?:is\s+)?deployed\b/i,
    /\b(?:contract\s+)?code\s+(?:exists?|is\s+deployed)\s+at\s+(0x[a-f0-9]{40})\b/i,
    /\bcontract\s+is\s+deployed\s+at\s+(0x[a-f0-9]{40})\b/i,
    /\bdeployed\s+contract\s+code\s+at\s+(0x[a-f0-9]{40})\b/i,
  ];
  const seenContracts = new Set<string>();
  for (const pattern of contractMatches) {
    const contract = pattern.exec(segment.text);
    if (!contract) continue;
    const address = (contract[1] ?? contract[2])?.toLowerCase();
    if (!address || seenContracts.has(address)) continue;
    seenContracts.add(address);
    terms.push(draftMatch(`${prefix}contract ${address} is deployed`, segment, contract));
  }

  const transactionMatches = [...segment.text.matchAll(/\btransaction\s+(0x[a-f0-9]{64})\b/gi)];
  const seenTransactions = new Set<string>();
  for (const transaction of transactionMatches) {
    const hash = transaction[1]?.toLowerCase();
    const start = transaction.index ?? 0;
    if (!hash) continue;
    const tailStart = start + transaction[0].length;
    const tail = segment.text.slice(tailStart);
    const nextTransaction = tail.search(/\btransaction\s+0x[a-f0-9]{64}\b/i);
    const clause = nextTransaction >= 0 ? tail.slice(0, nextTransaction) : tail.split(/[.;]/, 1)[0] ?? tail;
    const exists = /\b(?:exists|was\s+found|is\s+present)\b/i.exec(clause);
    const succeeded = /\b(?:succeeded|completed\s+successfully|was\s+successful|has\s+a\s+successful\s+receipt|successful)\b/i.exec(clause);
    if (exists && !seenTransactions.has(`${hash}:exists`)) {
      seenTransactions.add(`${hash}:exists`);
      terms.push(draftRange(`${prefix}transaction ${hash} exists`, segment, start, tailStart + exists.index + exists[0].length));
    }
    if (succeeded && !seenTransactions.has(`${hash}:success`)) {
      seenTransactions.add(`${hash}:success`);
      terms.push(draftRange(`${prefix}transaction ${hash} succeeded`, segment, start, tailStart + succeeded.index + succeeded[0].length));
    }
  }
  return terms;
}

function draftMatch(text: string, segment: SourceSegment, match: RegExpMatchArray): DraftTerm {
  const offset = match.index ?? 0;
  const raw = match[0];
  return draftRange(text, segment, offset, offset + raw.length, raw);
}

function draftRange(text: string, segment: SourceSegment, start: number, end: number, sourceText = segment.text.slice(start, end)): DraftTerm {
  const result = draft(text, {
    ...segment,
    sourceText,
    start: segment.start + start,
    end: segment.start + end,
  });
  return { ...result, clause: segment.sourceText, conjunctionGroup: `${segment.start}:${segment.end}` };
}

function atomizeNpm(segment: SourceSegment): DraftTerm[] {
  const match = segment.text.match(/\bnpm\s+(?:package\s+)?(@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)\b/i);
  if (!match) return [];
  const packageName = match[1];
  const terms: DraftTerm[] = [];
  if (/\bexists\b/i.test(segment.text)) terms.push(draft(`npm package ${packageName} exists`, segment));
  const version = segment.text.match(/\b(?:exact\s+)?version\s+(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/i)?.[1];
  if (version) terms.push(draft(`npm package ${packageName} exact version ${version.replace(/^v/i, '')}`, segment));
  const repository = segment.text.match(/\b(?:repository(?:\s+association)?|associated\s+with)\s+(https:\/\/[^\s,;]+)/i)?.[1]?.replace(/[.!?]+$/, '');
  if (repository) terms.push(draft(`npm package ${packageName} repository association equals ${repository}`, segment));
  if (/\b(?:distribution\s+metadata|integrity)\b/i.test(segment.text)) terms.push(draft(`npm package ${packageName} distribution metadata has integrity`, segment));
  return terms;
}

function normalizeFieldValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return JSON.stringify(trimmed.slice(1, -1));
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/i.test(trimmed)) return trimmed.toLowerCase();
  return JSON.stringify(trimmed);
}

function draft(text: string, segment: SourceSegment): DraftTerm {
  const cleaned = text.replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
  return { text: cleaned, sourceText: segment.sourceText, start: segment.start, end: segment.end, clause: segment.sourceText, predicate: cleaned, conjunctionGroup: `${segment.start}:${segment.end}` };
}

function extractEntities(assertion: string): Record<string, string> {
  const entities: Record<string, string> = {};
  const url = assertion.match(/https?:\/\/[^\s,;]+/i)?.[0];
  const address = assertion.match(/0x[a-f0-9]{40}\b/i)?.[0];
  const transactionHash = assertion.match(/transaction\s+(0x[a-f0-9]{64})\b/i)?.[1];
  const chainId = assertion.match(/chain\s+id\s+(?:equals|is|==)?\s*(\d+)/i)?.[1];
  const path = assertion.match(/(?:^|\s)([a-z0-9_./~-]+\.(?:sol|mjs|json|ts|tsx|js))\b/i)?.[1];
  const field = assertion.match(/json\s+field\s+([a-z_$][a-z0-9_.-]*)\s+equals\s+(.+)$/i);
  if (url) entities.url = url;
  if (address) entities.address = address;
  if (transactionHash) entities.transactionHash = transactionHash;
  if (chainId) entities.chainId = chainId;
  if (path) entities.path = path;
  if (field) {
    entities.field = field[1];
    entities.expected = field[2];
  }
  return entities;
}

function normalizeAssertion(text: string): string {
  return text.toLocaleLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

function normalizeEntity(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isSubjectiveCriterion(text: string): boolean {
  return /\b(feels?|beautiful|good\s+(?:ux|experience)|excellent\s+user\s+experience|meaningful\s+use\s+of\s+arc|strong\s+product|innovative\s+implementation|high[- ]quality(?:\s+ux)?|trust(?:worthy|worthy)|easy\s+to\s+use|user[- ]friendly|appropriate|reasonable|satisfied|looks?\s+good)\b/i.test(text);
}
