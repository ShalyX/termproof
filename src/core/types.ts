export type StepResult = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type ClaimResult = StepResult | 'NOT_TESTABLE';
export type MilestoneVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NEEDS_EVIDENCE' | 'FAILED';
export type Testability = 'OBJECTIVE' | 'PARTIAL' | 'HUMAN';
export type AcceptanceTermDisposition = 'PLANNED' | 'NEEDS_EVIDENCE' | 'NOT_OBJECTIVELY_TESTABLE' | 'UNSUPPORTED';
export interface AcceptanceTermSourceSpan { start: number; end: number; }
export type SupportedPredicateType =
  | 'repository_exists'
  | 'file_exists'
  | 'http_status'
  | 'json_valid'
  | 'json_field_equals'
  | 'chain_identity'
  | 'contract_code'
  | 'transaction_existence'
  | 'transaction_success'
  | 'npm_package_exists'
  | 'npm_version'
  | 'npm_repository'
  | 'npm_distribution_metadata';
export type AcceptanceTermExtractionOrigin = 'semantic' | 'deterministic_guard' | 'both';

export type ProofObligationKind = 'PRESENCE' | 'CONTENT' | 'STRUCTURE' | 'RUNTIME' | 'ONCHAIN_STATE' | 'ONCHAIN_EVENT' | 'BEHAVIORAL_TRACE' | 'PROTOCOL_OBJECT' | 'SUBJECTIVE_HUMAN';
export type EvidenceCapability =
  | 'github.repository_presence'
  | 'github.file_presence'
  | 'github.repository_metadata'
  | 'github.source_content'
  | 'github.source_structure'
  | 'http.runtime'
  | 'npm.package_state'
  | 'evm.chain_identity'
  | 'evm.contract_state'
  | 'evm.transaction'
  | 'evm.event'
  | 'evm.token_transfer'
  | 'human.review';

export interface ProofObligation {
  kind: ProofObligationKind;
  description: string;
  requiredCapabilities: EvidenceCapability[];
  objective: boolean;
  requiredChainProfile?: string | null;
}

export type GitHubOperation = 'repo_exists' | 'file_exists' | 'file_non_empty' | 'source_contains' | 'source_symbol_exists' | 'source_syntax_valid' | 'license_matches' | 'release_exists';
export type HttpOperation = 'status_matches' | 'body_contains' | 'json_valid' | 'json_field_matches';
export type EvmNetwork = 'base' | 'base-sepolia' | 'arc-testnet';
export type BaseNetwork = EvmNetwork;
export type BaseOperation =
  | 'chain_id_matches'
  | 'contract_deployed'
  | 'contract_code_exists'
  | 'transaction_exists'
  | 'receipt_status'
  | 'receipt_status_matches'
  | 'transaction_from_matches'
  | 'transaction_to_matches'
  | 'event_matches'
  | 'token_transfer_matches';
export type NpmOperation = 'package_exists' | 'version_matches' | 'metadata_matches' | 'distribution_metadata';

export interface GitHubStep {
  id: string;
  claimId: string;
  adapter: 'github';
  operation: GitHubOperation;
  requiresEvidence?: boolean;
  params: {
    path: string | null;
    expected: string | null;
  };
}

export interface HttpStep {
  id: string;
  claimId: string;
  adapter: 'http';
  operation: HttpOperation;
  requiresEvidence?: boolean;
  params: {
    url: string;
    expected: string;
    request?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | null;
    };
  };
}

export interface BaseStep {
  id: string;
  claimId: string;
  adapter: 'base';
  operation: BaseOperation;
  requiresEvidence?: boolean;
  params: {
    network: BaseNetwork;
    address: string | null;
    expected: string | null;
  };
}

export interface NpmStep {
  id: string;
  claimId: string;
  adapter: 'npm';
  operation: NpmOperation;
  requiresEvidence?: boolean;
  params: {
    packageName: string;
    expected: string | null;
    repository: string | null;
  };
}

export type VerificationPlanStep = GitHubStep | HttpStep | BaseStep | NpmStep;

export interface PlannedClaim {
  id: string;
  acceptanceTermIds?: string[];
  statement: string;
  required: boolean;
  testability: Testability;
  steps: VerificationPlanStep[];
}

export interface PlannerAcceptanceTerm {
  id: string;
  disposition: AcceptanceTermDisposition;
  reason: string | null;
}

export interface AcceptanceTerm {
  id: string;
  text: string;
  /** Canonical, normalized assertion used for identity and coverage accounting. */
  assertion: string;
  /** Original acceptance-criteria text retained for provenance inspection. */
  sourceText: string;
  sourceSpan: AcceptanceTermSourceSpan;
  required: boolean;
  testability: Testability;
  proofObligation: ProofObligation;
  /** Original clause and extracted entities retained independently of planner output. */
  clause?: string;
  predicate?: string;
  predicateType?: SupportedPredicateType;
  extractionOrigin?: AcceptanceTermExtractionOrigin;
  proofOperation?: string;
  entities?: Record<string, string>;
  conjunctionGroup?: string;
  /** Populated after planning; absent while the term is planner input. */
  disposition?: AcceptanceTermDisposition;
  /** Populated after planning; explicit claim-to-term and step-to-term mapping. */
  mappedClaimIds?: string[];
  mappedVerifierStepIds?: string[];
  selectedCapability?: EvidenceCapability | null;
  evidenceEstablished?: string[];
}

export interface SupportedPredicateFinding {
  canonicalPredicate: SupportedPredicateType;
  sourceText: string;
  sourceSpan: AcceptanceTermSourceSpan;
  predicate: string;
  entities: Record<string, string>;
  proofObligation: ProofObligation;
  capability: EvidenceCapability;
  operation: string;
  signature: string;
}

export interface AcceptanceTermAudit {
  findings: SupportedPredicateFinding[];
  unmatchedFindings: SupportedPredicateFinding[];
  complete: boolean;
  reason: string | null;
}

export interface AcceptanceTermCoverage extends AcceptanceTerm {
  disposition: AcceptanceTermDisposition;
  claimIds: string[];
  stepIds: string[];
  reason: string | null;
  selectedCapability: EvidenceCapability | null;
  evidenceEstablished: string[];
}

export type NormalizedAcceptanceTerm = AcceptanceTerm;

export interface VerificationPlan {
  claims: PlannedClaim[];
  missingEvidence: string[];
  acceptanceTerms?: PlannerAcceptanceTerm[];
  coverage?: AcceptanceTermCoverage[];
}

export interface EvidenceInput {
  claimId: string;
  stepId: string;
  adapter: 'github' | 'http' | 'base' | 'npm';
  source: string;
  revision: string | null;
  raw: unknown;
  extractedFacts: Record<string, unknown>;
  result: StepResult;
  observationId?: string;
  requestFingerprint?: string;
  observationRawHash?: string;
  observationObservedAt?: string;
}

export interface EvidenceProvenance {
  runVersion: string;
  verifier: { name: string; version: string };
  policy: { name: string; version: string };
  planner: {
    kind: string;
    provider?: string | null;
    model: string | null;
    role?: 'primary' | 'fallback' | 'fixture' | string | null;
    failoverReason?: string | null;
    failureCategory?: string | null;
    timestamp?: string | null;
    version?: string | null;
    planHash: string;
  };
  promise: string;
  acceptanceLedgerHash?: string;
  acceptancePredicateAuditHash?: string;
  plan: VerificationPlan;
  coverage?: AcceptanceTermCoverage[];
  milestoneVerdict: MilestoneVerdict;
}

export interface AdapterExecution {
  result: StepResult;
  message: string;
  evidence: EvidenceRecord;
}

export interface EvidenceRecord extends EvidenceInput {
  id: string;
  observedAt: string;
  rawHash: string;
  provenance?: EvidenceProvenance;
}

export interface ExecutedStep {
  id: string;
  adapter: VerificationPlanStep['adapter'];
  operation: VerificationPlanStep['operation'];
  result: StepResult;
  evidenceIds: string[];
  message: string;
}

export interface ClaimExecution {
  id: string;
  acceptanceTermIds?: string[];
  statement: string;
  required: boolean;
  testability: Testability;
  steps: ExecutedStep[];
  result?: ClaimResult;
}

export interface VerificationInput {
  milestone: string;
  githubRepository: string;
}

export interface VerificationRun {
  runId: string;
  milestone: string;
  repository: { owner: string; repo: string };
  startedAt: string;
  finishedAt: string;
  verdict: MilestoneVerdict;
  missingEvidence: string[];
  claims: Required<ClaimExecution>[];
  evidence: EvidenceRecord[];
  plan: VerificationPlan;
  coverage?: AcceptanceTermCoverage[];
  provenance: EvidenceProvenance;
}
