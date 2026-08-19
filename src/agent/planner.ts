import type { NormalizedAcceptanceTerm, VerificationPlan } from '../core/types.ts';

export type PlannerErrorCode = 'PLANNER_UNAVAILABLE' | 'PLANNER_TIMEOUT' | 'PLANNER_UPSTREAM_ERROR' | 'PLANNER_INVALID_OUTPUT';
export type PlannerFailureCategory = 'provider_timeout' | 'provider_rate_limit' | 'provider_outage' | 'empty_response' | 'invalid_structured_output' | 'schema_rejection' | 'semantic_coverage_rejection' | 'unsupported_capability' | 'duplicate_route_rejection' | 'proof_strength_mismatch' | 'unknown';

export class PlannerOperationalError extends Error {
  readonly code: PlannerErrorCode;
  readonly reason: string | null;
  readonly failureCategory: PlannerFailureCategory | null;

  constructor(code: PlannerErrorCode, message: string, options?: { cause?: unknown; reason?: string | null; failureCategory?: PlannerFailureCategory | null }) {
    super(message, options);
    this.name = 'PlannerOperationalError';
    this.code = code;
    this.reason = options?.reason ?? null;
    this.failureCategory = options?.failureCategory ?? null;
  }
}

export interface PlannerInput {
  milestone: string;
  githubRepository: string;
  acceptanceTerms?: NormalizedAcceptanceTerm[];
}

export interface PlannerMetadata {
  kind: string;
  provider?: string | null;
  model: string | null;
  role?: 'primary' | 'fallback' | 'fixture' | string | null;
  failoverReason?: string | null;
  failureCategory?: PlannerFailureCategory | null;
  timestamp?: string | null;
  version?: string | null;
}

export interface MilestonePlanner {
  plan(input: PlannerInput): Promise<VerificationPlan>;
  metadata(): PlannerMetadata;
  preflight?(): void;
}
