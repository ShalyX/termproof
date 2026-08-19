import { randomUUID } from 'node:crypto';
import type { MilestonePlanner } from '../agent/planner.ts';
import { parseGitHubRepository } from '../adapters/github.ts';
import { buildAcceptanceCoverage, buildAcceptanceTermLedger } from './coverage.ts';
import { getCapabilityForStep } from './capabilities.ts';
import { evaluateClaim, evaluateMilestone } from './policy.ts';
import { freezeEvidence, hashEvidence, stableJson } from './evidence.ts';
import {
  MemoryPersistenceAdapter,
  hashPersistenceRequest,
  type PersistenceAdapter,
  type PersistenceRequestContext,
} from './persistence.ts';
import type { AcceptanceTermCoverage, AdapterExecution, ClaimExecution, EvidenceProvenance, EvidenceRecord, HttpStep, VerificationPlan, VerificationPlanStep, VerificationInput } from './types.ts';

export type EvidenceSubmission = { kind: 'http_source'; claimId: string; stepId: string; url: string };

export interface EvidenceRequest {
  id: string;
  claimId: string;
  stepId: string;
  request: string;
  status: 'OPEN' | 'SATISFIED';
}

export interface EvidenceLedgerEntry {
  evidence: EvidenceRecord;
  origin: 'initial' | 'supplied';
  claimId: string;
  stepId: string;
}

export interface VerificationCaseSnapshot {
  caseId: string;
  milestone: string;
  verdict: ReturnType<typeof evaluateMilestone>;
  claims: Array<Required<ClaimExecution>>;
  evidenceLedger: EvidenceLedgerEntry[];
  evidenceRequests: EvidenceRequest[];
  plan: VerificationPlan;
  coverage?: AcceptanceTermCoverage[];
  provenance: EvidenceProvenance;
}

type Adapter = { execute: (step: VerificationPlanStep, repository?: { owner: string; repo: string }) => Promise<AdapterExecution> };
type Dependencies = { planner: MilestonePlanner; github: Adapter; http: Adapter; base: Adapter; npm: Adapter; now?: () => Date; persistence?: PersistenceAdapter };

export class ResumableVerificationService {
  private readonly deps: Omit<Dependencies, 'persistence'>;
  readonly persistence: PersistenceAdapter;

  constructor(deps: Dependencies) {
    const { persistence, ...runtimeDeps } = deps;
    this.deps = runtimeDeps;
    this.persistence = persistence ?? new MemoryPersistenceAdapter();
  }

  async start(input: VerificationInput, context: PersistenceRequestContext = {}): Promise<VerificationCaseSnapshot> {
    if (!input.milestone.trim()) throw new Error('Milestone text is required');
    this.deps.planner.preflight?.();
    const repository = parseGitHubRepository(input.githubRepository);
    const acceptanceLedger = buildAcceptanceTermLedger(input.milestone);
    const acceptanceTerms = acceptanceLedger.terms;
    const planned = await this.deps.planner.plan({ ...input, acceptanceTerms });
    const coverage = buildAcceptanceCoverage(acceptanceTerms, planned);
    const plan: VerificationPlan = { ...planned, coverage };
    const ledger: EvidenceLedgerEntry[] = [];
    const requests: EvidenceRequest[] = [];
    const httpSteps = plan.claims.flatMap((claim) => claim.steps).filter((step): step is HttpStep => step.adapter === 'http' && !step.requiresEvidence);
    const executeMany = (this.deps.http as Adapter & { executeMany?: (steps: readonly HttpStep[]) => Promise<Map<string, AdapterExecution>> }).executeMany;
    const httpResults = executeMany ? await executeMany.call(this.deps.http, httpSteps) : new Map<string, AdapterExecution>();
    const claims = await Promise.all(plan.claims.map(async (plannedClaim) => {
      const execution: ClaimExecution = { id: plannedClaim.id, acceptanceTermIds: plannedClaim.acceptanceTermIds ?? [], statement: plannedClaim.statement, required: plannedClaim.required, testability: plannedClaim.testability, steps: [] };
      for (const step of plannedClaim.steps) {
        if (step.requiresEvidence) {
          requests.push({ id: randomUUID(), claimId: step.claimId, stepId: step.id, request: this.requestFor(step), status: 'OPEN' });
          continue;
        }
        const result = step.adapter === 'http'
          ? httpResults.get(step.id) ?? await this.adapter(step).execute(step, repository)
          : await this.adapter(step).execute(step, repository);
        ledger.push({ evidence: result.evidence, origin: 'initial', claimId: step.claimId, stepId: step.id });
        execution.steps.push({ id: step.id, adapter: step.adapter, operation: step.operation, result: result.result, evidenceIds: [result.evidence.id], message: result.message });
      }
      return { ...execution, result: evaluateClaim(execution) as Required<ClaimExecution>['result'] } as Required<ClaimExecution>;
    }));
    const resolvedCoverage = coverage.map((term) => {
      const mappedStep = plan.claims.flatMap((claim) => claim.steps).find((step) => step.id === term.mappedVerifierStepIds?.[0]);
      return { ...term, selectedCapability: term.selectedCapability ?? (mappedStep ? getCapabilityForStep(mappedStep) : null), evidenceEstablished: ledger.filter((entry) => term.stepIds.includes(entry.stepId)).map((entry) => entry.evidence.id) };
    });
    const resolvedPlan = { ...plan, coverage: resolvedCoverage };
    const verdict = evaluateMilestone(claims, resolvedCoverage, acceptanceTerms, acceptanceLedger.audit);
    const provenance = this.provenance(input, resolvedPlan, verdict);
    for (const entry of ledger) {
      entry.evidence.provenance = provenance;
      freezeEvidence(entry.evidence);
    }
    const snapshot = this.snapshot(input, resolvedPlan, claims, ledger, requests, resolvedCoverage, provenance, acceptanceLedger);
    const caseId = randomUUID();
    snapshot.caseId = caseId;
    await this.persistence.createCase({ caseId, version: 0, input, plan: resolvedPlan, snapshot, acceptanceLedger }, context);
    return snapshot;
  }

  async get(caseId: string): Promise<VerificationCaseSnapshot> {
    return (await this.persistence.getCase(caseId)).snapshot;
  }

  async supplyEvidence(
    caseId: string,
    submission: EvidenceSubmission & Record<string, unknown>,
    context: PersistenceRequestContext = {},
  ): Promise<VerificationCaseSnapshot> {
    if (Object.keys(submission).some((key) => !['kind', 'claimId', 'stepId', 'url'].includes(key))) throw new Error('Unsupported evidence fields');
    if (submission.kind !== 'http_source' || typeof submission.url !== 'string' || !submission.url.startsWith('https://')) throw new Error('A public HTTPS source is required');

    const mutationContext: PersistenceRequestContext = {
      ...context,
      idempotencyKey: context.idempotencyKey ?? context.requestId ?? null,
      requestHash: context.requestHash ?? hashPersistenceRequest(submission),
    };

    const updated = await this.persistence.mutateCase(caseId, mutationContext, async (current) => {
      const request = current.snapshot.evidenceRequests.find((item) => item.claimId === submission.claimId && item.stepId === submission.stepId && item.status === 'OPEN');
      if (!request) throw new Error('No open evidence request for this claim');
      const planned = current.plan.claims.flatMap((claim) => claim.steps).find((step) => step.id === submission.stepId);
      if (!planned || planned.adapter !== 'http') throw new Error('Evidence source does not match the requested adapter');
      const step: VerificationPlanStep = { ...planned, requiresEvidence: false, params: { ...planned.params, url: submission.url } };
      const result = await this.deps.http.execute(step);
      const ledger = [...current.snapshot.evidenceLedger, { evidence: result.evidence, origin: 'supplied' as const, claimId: step.claimId, stepId: step.id }];
      const claims = current.snapshot.claims.map((claim) => claim.id === step.claimId
        ? { ...claim, steps: [...claim.steps, { id: step.id, adapter: step.adapter, operation: step.operation, result: result.result, evidenceIds: [result.evidence.id], message: result.message }], result: undefined }
        : claim);
      const recalculated = claims.map((claim) => ({ ...claim, result: evaluateClaim(claim) as Required<ClaimExecution>['result'] })) as Array<Required<ClaimExecution>>;
      request.status = 'SATISFIED';
      const recalculatedCoverage = (current.snapshot.coverage ?? []).map((term) => term.stepIds.includes(step.id)
        ? { ...term, evidenceEstablished: [...new Set([...term.evidenceEstablished, result.evidence.id])] }
        : term);
      const resolvedPlan = { ...current.plan, coverage: recalculatedCoverage };
      const acceptanceLedger = buildAcceptanceTermLedger(current.input.milestone);
      const acceptanceTerms = acceptanceLedger.terms;
      const verdict = evaluateMilestone(recalculated, recalculatedCoverage, acceptanceTerms, acceptanceLedger.audit);
      const provenance = this.provenance(current.input, resolvedPlan, verdict);
      result.evidence.provenance = provenance;
      freezeEvidence(result.evidence);
      const snapshot = this.snapshot(current.input, resolvedPlan, recalculated, ledger, current.snapshot.evidenceRequests, recalculatedCoverage, provenance, acceptanceLedger);
      snapshot.caseId = caseId;
      return { ...current, version: current.version + 1, plan: resolvedPlan, snapshot, acceptanceLedger };
    });

    return updated.snapshot;
  }

  private adapter(step: VerificationPlanStep): Adapter { return step.adapter === 'github' ? this.deps.github : step.adapter === 'http' ? this.deps.http : step.adapter === 'base' ? this.deps.base : this.deps.npm; }
  private requestFor(step: VerificationPlanStep): string {
    if (step.adapter !== 'http') return `Provide evidence for ${step.adapter} step ${step.id}.`;
    if (step.operation === 'status_matches') return `Provide a public HTTPS endpoint that can be rechecked and is expected to return HTTP ${step.params.expected}.`;
    if (step.operation === 'json_valid') return 'Provide a public HTTPS endpoint that can be rechecked and returns valid JSON.';
    if (step.operation === 'json_field_matches') return `Provide a public HTTPS endpoint that can be rechecked and whose JSON satisfies ${step.params.expected}.`;
    return `Provide a public HTTPS endpoint that can be rechecked and whose body contains ${step.params.expected}.`;
  }
  private provenance(input: VerificationInput, plan: VerificationPlan, verdict: ReturnType<typeof evaluateMilestone>): EvidenceProvenance {
    const acceptanceLedger = buildAcceptanceTermLedger(input.milestone);
    return { runVersion: 'v12.3.4', verifier: { name: 'termproof-verifier', version: '0.3.1' }, policy: { name: 'deterministic-policy', version: 'deterministic-policy-v2' }, planner: { ...this.deps.planner.metadata(), planHash: hashEvidence(stableJson(plan)) }, promise: input.milestone, acceptanceLedgerHash: acceptanceLedger.sourceHash, acceptancePredicateAuditHash: hashEvidence(stableJson(acceptanceLedger.audit)), plan, coverage: plan.coverage, milestoneVerdict: verdict };
  }
  private snapshot(input: VerificationInput, plan: VerificationPlan, claims: Array<Required<ClaimExecution>>, ledger: EvidenceLedgerEntry[], requests: EvidenceRequest[], coverage: AcceptanceTermCoverage[], provenance: EvidenceProvenance, acceptanceLedger = buildAcceptanceTermLedger(input.milestone)): VerificationCaseSnapshot {
    return { caseId: '', milestone: input.milestone, verdict: evaluateMilestone(claims, coverage, acceptanceLedger.terms, acceptanceLedger.audit), claims, evidenceLedger: ledger, evidenceRequests: requests, plan, coverage, provenance };
  }
}
