import { randomUUID } from 'node:crypto';
import type { MilestonePlanner } from '../agent/planner.ts';
import { BaseAdapter } from '../adapters/base.ts';
import { GitHubAdapter, parseGitHubRepository } from '../adapters/github.ts';
import { HttpAdapter } from '../adapters/http.ts';
import { NpmAdapter } from '../adapters/npm.ts';
import { buildAcceptanceCoverage, buildAcceptanceTermLedger } from './coverage.ts';
import { getCapabilityForStep } from './capabilities.ts';
import { evaluateClaim, evaluateMilestone } from './policy.ts';
import { freezeEvidence, hashEvidence, stableJson } from './evidence.ts';
import type { ClaimExecution, EvidenceRecord, EvidenceProvenance, VerificationInput, VerificationRun } from './types.ts';

export class VerificationOrchestrator {
  private deps: { planner: MilestonePlanner; github: GitHubAdapter; http: HttpAdapter; base: BaseAdapter; npm: NpmAdapter; now?: () => Date };

  constructor(deps: { planner: MilestonePlanner; github: GitHubAdapter; http?: HttpAdapter; base?: BaseAdapter; npm?: NpmAdapter; now?: () => Date }) {
    this.deps = { ...deps, http: deps.http ?? new HttpAdapter(), base: deps.base ?? new BaseAdapter(), npm: deps.npm ?? new NpmAdapter() };
  }

  async verify(input: VerificationInput): Promise<VerificationRun> {
    if (!input.milestone.trim()) throw new Error('Milestone text is required');
    this.deps.planner.preflight?.();
    const repository = parseGitHubRepository(input.githubRepository);
    const now = this.deps.now ?? (() => new Date());
    const startedAt = now();
    const acceptanceLedger = buildAcceptanceTermLedger(input.milestone);
    const acceptanceTerms = acceptanceLedger.terms;
    const planned = await this.deps.planner.plan({ ...input, acceptanceTerms });
    const coverage = buildAcceptanceCoverage(acceptanceTerms, planned);
    const plan = { ...planned, coverage };
    const evidence: EvidenceRecord[] = [];
    const claims: ClaimExecution[] = [];
    const httpSteps = plan.claims.flatMap((claim) => claim.steps).filter((step) => step.adapter === 'http');
    const httpResults = await this.deps.http.executeMany(httpSteps);

    for (const planned of plan.claims) {
      const execution: ClaimExecution = {
        id: planned.id,
        acceptanceTermIds: planned.acceptanceTermIds ?? [],
        statement: planned.statement,
        required: planned.required,
        testability: planned.testability,
        steps: []
      };
      for (const step of planned.steps) {
        const result = step.adapter === 'github'
          ? await this.deps.github.execute(step, repository)
          : step.adapter === 'http'
            ? httpResults.get(step.id) ?? await this.deps.http.execute(step)
            : step.adapter === 'base'
              ? await this.deps.base.execute(step)
              : await this.deps.npm.execute(step);
        evidence.push(result.evidence);
        execution.steps.push({
          id: step.id,
          adapter: step.adapter,
          operation: step.operation,
          result: result.result,
          evidenceIds: [result.evidence.id],
          message: result.message,
        });
      }
      execution.result = evaluateClaim(execution);
      claims.push(execution);
    }

    const completeClaims = claims.map((claim) => ({ ...claim, result: claim.result! }));
    const resolvedCoverage = coverage.map((term) => {
      const mappedStep = plan.claims.flatMap((claim) => claim.steps).find((step) => step.id === term.mappedVerifierStepIds?.[0]);
      return {
        ...term,
        selectedCapability: term.selectedCapability ?? (mappedStep ? getCapabilityForStep(mappedStep) : null),
        evidenceEstablished: evidence.filter((record) => term.stepIds.includes(record.stepId)).map((record) => record.id),
      };
    });
    const resolvedPlan = { ...plan, coverage: resolvedCoverage };
    const verdict = evaluateMilestone(completeClaims, resolvedCoverage, acceptanceTerms, acceptanceLedger.audit);
    const missingEvidence = mergeMissingEvidence(planned.missingEvidence, resolvedCoverage);
    const provenance: EvidenceProvenance = {
      runVersion: 'v12.3.4',
      verifier: { name: 'termproof-verifier', version: '0.3.1' },
      policy: { name: 'deterministic-policy', version: 'deterministic-policy-v2' },
      planner: { ...this.deps.planner.metadata(), planHash: hashEvidence(stableJson(resolvedPlan)) },
      promise: input.milestone,
      acceptanceLedgerHash: acceptanceLedger.sourceHash,
      acceptancePredicateAuditHash: hashEvidence(stableJson(acceptanceLedger.audit)),
      plan: resolvedPlan,
      coverage: resolvedCoverage,
      milestoneVerdict: verdict,
    };
    for (const record of evidence) {
      record.provenance = provenance;
      freezeEvidence(record);
    }
    const finishedAt = now();
    return {
      runId: randomUUID(),
      milestone: input.milestone,
      repository,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      verdict,
      missingEvidence,
      claims: completeClaims,
      evidence,
      plan: resolvedPlan,
      coverage: resolvedCoverage,
      provenance,
    };
  }
}

function mergeMissingEvidence(plannerEvidence: string[], coverage: VerificationRun['coverage']): string[] {
  const messages = [...plannerEvidence];
  for (const term of coverage ?? []) {
    if (term.disposition === 'PLANNED') continue;
    const prefix = term.disposition === 'NOT_OBJECTIVELY_TESTABLE'
      ? 'Human review required'
      : term.disposition === 'UNSUPPORTED'
        ? 'Unsupported criterion'
        : 'Evidence required';
    messages.push(`${prefix}: ${term.text}${term.reason ? ` — ${term.reason}` : ''}`);
  }
  return [...new Set(messages)];
}
