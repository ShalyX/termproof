import { getEvmProfileKeys } from './evm-profiles.ts';
import type { AcceptanceTerm, EvidenceCapability, EvmNetwork, ProofObligation, ProofObligationKind, SupportedPredicateType, VerificationPlanStep } from './types.ts';

export interface EvidenceCapabilityDescriptor {
  id: EvidenceCapability;
  adapter: VerificationPlanStep['adapter'] | 'human';
  supported: boolean;
  establishes: ProofObligationKind[];
  operations: string[];
  predicateTypes?: readonly SupportedPredicateType[];
  profiles?: readonly EvmNetwork[];
}

const EVM_CAPABILITY_IDS = ['evm.chain_identity', 'evm.contract_state', 'evm.transaction', 'evm.event', 'evm.token_transfer'] as const satisfies readonly EvidenceCapability[];
const ALLOWLISTED_EVM_PROFILES = Object.freeze(getEvmProfileKeys());

export const EVIDENCE_CAPABILITY_REGISTRY: Record<EvidenceCapability, EvidenceCapabilityDescriptor> = {
  'github.repository_presence': { id: 'github.repository_presence', adapter: 'github', supported: true, establishes: ['PRESENCE'], operations: ['repo_exists'], predicateTypes: ['repository_exists'] },
  'github.file_presence': { id: 'github.file_presence', adapter: 'github', supported: true, establishes: ['PRESENCE'], operations: ['file_exists'], predicateTypes: ['file_exists'] },
  'github.repository_metadata': { id: 'github.repository_metadata', adapter: 'github', supported: true, establishes: ['CONTENT'], operations: ['license_matches', 'release_exists'] },
  'github.source_content': { id: 'github.source_content', adapter: 'github', supported: true, establishes: ['CONTENT'], operations: ['source_contains', 'file_non_empty'] },
  'github.source_structure': { id: 'github.source_structure', adapter: 'github', supported: true, establishes: ['STRUCTURE'], operations: ['source_symbol_exists', 'source_syntax_valid'] },
  'http.runtime': { id: 'http.runtime', adapter: 'http', supported: true, establishes: ['RUNTIME'], operations: ['status_matches', 'body_contains', 'json_valid', 'json_field_matches'], predicateTypes: ['http_status', 'json_valid', 'json_field_equals'] },
  'npm.package_state': { id: 'npm.package_state', adapter: 'npm', supported: true, establishes: ['PRESENCE', 'CONTENT'], operations: ['package_exists', 'version_matches', 'metadata_matches', 'distribution_metadata'], predicateTypes: ['npm_package_exists', 'npm_version', 'npm_repository', 'npm_distribution_metadata'] },
  'evm.chain_identity': { id: 'evm.chain_identity', adapter: 'base', supported: true, establishes: ['ONCHAIN_STATE'], operations: ['chain_id_matches'], predicateTypes: ['chain_identity'], profiles: ALLOWLISTED_EVM_PROFILES },
  'evm.contract_state': { id: 'evm.contract_state', adapter: 'base', supported: true, establishes: ['ONCHAIN_STATE'], operations: ['contract_deployed', 'contract_code_exists'], predicateTypes: ['contract_code'], profiles: ALLOWLISTED_EVM_PROFILES },
  'evm.transaction': { id: 'evm.transaction', adapter: 'base', supported: true, establishes: ['ONCHAIN_STATE'], operations: ['transaction_exists', 'transaction_from_matches', 'transaction_to_matches'], predicateTypes: ['transaction_existence'], profiles: ALLOWLISTED_EVM_PROFILES },
  'evm.event': { id: 'evm.event', adapter: 'base', supported: true, establishes: ['ONCHAIN_EVENT'], operations: ['receipt_status', 'receipt_status_matches', 'event_matches'], predicateTypes: ['transaction_success'], profiles: ALLOWLISTED_EVM_PROFILES },
  'evm.token_transfer': { id: 'evm.token_transfer', adapter: 'base', supported: true, establishes: ['ONCHAIN_EVENT'], operations: ['token_transfer_matches'], profiles: ALLOWLISTED_EVM_PROFILES },
  'human.review': { id: 'human.review', adapter: 'human', supported: true, establishes: ['SUBJECTIVE_HUMAN'], operations: [] },
};

/** The planner, semantic validator, router, and UI consume this derived inventory. */
export function getSupportedEvmProfiles(): readonly EvmNetwork[] {
  return [...new Set(EVM_CAPABILITY_IDS.flatMap((id) => EVIDENCE_CAPABILITY_REGISTRY[id].profiles ?? []))];
}

export function getSupportedEvmProfilesForCapability(capability: EvidenceCapability): readonly EvmNetwork[] {
  return EVIDENCE_CAPABILITY_REGISTRY[capability].profiles ?? [];
}

export function isSupportedEvmProfile(profile: string, capability?: EvidenceCapability): boolean {
  const profiles = capability ? getSupportedEvmProfilesForCapability(capability) : getSupportedEvmProfiles();
  return profiles.includes(profile as EvmNetwork);
}

export function getCapabilityForStep(step: Pick<VerificationPlanStep, 'adapter' | 'operation'>): EvidenceCapability | null {
  for (const descriptor of Object.values(EVIDENCE_CAPABILITY_REGISTRY)) {
    if (descriptor.adapter === step.adapter && descriptor.operations.includes(step.operation)) return descriptor.id;
  }
  return null;
}

export function getProofObligationForAssertion(assertion: string): ProofObligation {
  const value = assertion.trim();
  const lower = value.toLocaleLowerCase();

  if (isSubjective(lower)) return {
    kind: 'SUBJECTIVE_HUMAN',
    description: 'The criterion requires human review because it is subjective or evaluative.',
    requiredCapabilities: ['human.review'],
    objective: false,
  };
  if (/\b(?:durably\s+stored|stored|object|blob)\s+on\s+(?:walrus|0g|sui|decentralized storage|a protocol)\b/i.test(value) || /\bprotocol object\b/i.test(value)) return {
    kind: 'PROTOCOL_OBJECT',
    description: 'The criterion requires an attributable object or storage proof on the named protocol.',
    requiredCapabilities: [],
    objective: true,
  };
  if (/\b(?:autonomous|autonomously|behavior|behaviour|functional|implements?|worker|agent executes|settles? without human)\b/i.test(value)) return {
    kind: 'BEHAVIORAL_TRACE',
    description: 'The criterion requires behavioral or execution-trace evidence, not a file or symbol proxy.',
    requiredCapabilities: [],
    objective: true,
  };
  if (/\b(?:successful\s+)?(?:transfer|USDC|token|paid|payment)\b/i.test(value)) return {
    kind: 'ONCHAIN_EVENT',
    description: 'The criterion requires transaction, receipt, log, or token-transfer facts.',
    requiredCapabilities: ['evm.token_transfer', 'evm.event'],
    objective: true,
    requiredChainProfile: extractChainProfile(value),
  };
  if (/\b(?:receipt|event)\b/i.test(value) || /\b(?:transaction|tx)\s+0x[a-f0-9]{64}\b.*\b(?:succeed(?:s|ed)?|successful|confirmed|completed)\b/i.test(value)) return {
    kind: 'ONCHAIN_EVENT',
    description: 'The criterion requires receipt or event facts observed on the specified chain.',
    requiredCapabilities: ['evm.event'],
    objective: true,
    requiredChainProfile: extractChainProfile(value),
  };
  if (/\b(?:transaction|tx\s+(?:hash|lookup)|sender|destination|from|to)\b/i.test(value)) return {
    kind: 'ONCHAIN_STATE',
    description: 'The criterion requires a transaction lookup or sender/destination fact observed on the specified chain.',
    requiredCapabilities: ['evm.transaction'],
    objective: true,
    requiredChainProfile: extractChainProfile(value),
  };
  if (/\bchain\s+ID\b/i.test(value)) return {
    kind: 'ONCHAIN_STATE',
    description: 'The criterion requires chain identity observed from the specified EVM RPC.',
    requiredCapabilities: ['evm.chain_identity'],
    objective: true,
    requiredChainProfile: extractChainProfile(value),
  };
  if (/\b(?:contract\s+code|deployed\s+contract\s+code|bytecode|contract)\b.*\b(?:exists?|deployed|present)\b|\bdeployed\s+contract\s+code\b|\b(?:is\s+)?deployed(?:\s+(?:with\s+)?contract\s+code)?\s+at(?:\s+address)?\s+0x[a-f0-9]{40}\b|\b0x[a-f0-9]{40}\b\s+contains\s+(?:deployed\s+)?(?:contract\s+)?(?:code|bytecode)\b/i.test(value)) return {
    kind: 'ONCHAIN_STATE',
    description: 'The criterion requires deployed contract bytecode observed from the specified EVM RPC.',
    requiredCapabilities: ['evm.contract_state'],
    objective: true,
    requiredChainProfile: extractChainProfile(value),
  };
  if (/\b(?:production\s+health|health\s+endpoint|endpoint|reachable|HTTP\s+\d{3}|valid\s+JSON|JSON\s+field)\b/i.test(value) || /\b(?:ok|service|protocol|status|field)\s*(?:==|equals)\s*(?:true|false|null|["']|[A-Za-z0-9])/i.test(value)) return {
    kind: 'RUNTIME',
    description: 'The criterion requires a bounded runtime observation from the deployed endpoint.',
    requiredCapabilities: ['http.runtime'],
    objective: true,
  };
  if (/\b(?:syntax|source\s+structure|exports?|symbol|non[- ]empty|valid\s+implementation)\b/i.test(value)) return {
    kind: 'STRUCTURE',
    description: 'The criterion requires bounded static source inspection.',
    requiredCapabilities: ['github.source_structure'],
    objective: true,
  };
  if (/\b(?:contains|content|license|release|version|metadata|repository\s+association|associated\s+with)\b/i.test(value)) return {
    kind: 'CONTENT',
    description: 'The criterion requires attributable repository, registry, or source content.',
    requiredCapabilities: ['github.repository_metadata', 'github.source_content', 'npm.package_state'],
    objective: true,
  };
  if (/\b(?:exists|public\s+repository|package)\b/i.test(value)) return {
    kind: 'PRESENCE',
    description: 'The criterion requires an attributable public artifact or registry presence observation.',
    requiredCapabilities: ['github.repository_presence', 'github.file_presence', 'npm.package_state'],
    objective: true,
  };
  return {
    kind: 'CONTENT',
    description: 'The criterion requires an explicit attributable content capability.',
    requiredCapabilities: [],
    objective: true,
  };
}

export function validateProofRoute(term: Pick<AcceptanceTerm, 'proofObligation'>, steps: readonly VerificationPlanStep[]): { ok: boolean; capability: EvidenceCapability | null; reason: string | null; disposition: 'UNSUPPORTED' | 'NEEDS_EVIDENCE' } {
  const obligation = term.proofObligation;
  if (!obligation.objective) return { ok: false, capability: 'human.review', reason: obligation.description, disposition: 'NEEDS_EVIDENCE' };
  if (obligation.requiredChainProfile && !isSupportedEvmProfile(obligation.requiredChainProfile)) {
    return { ok: false, capability: null, reason: `Required chain profile ${obligation.requiredChainProfile} is not allowlisted by the current EVM verifier.`, disposition: 'UNSUPPORTED' };
  }
  const routedSteps = obligation.requiredChainProfile
    ? steps.filter((step) => step.adapter === 'base' && (step.params as { network?: string }).network === obligation.requiredChainProfile)
    : steps;
  const capabilities = [...new Set(routedSteps.map(getCapabilityForStep).filter((value): value is EvidenceCapability => Boolean(value)))];
  const candidate = capabilities.find((capability) => capabilityCanEstablish(capability, obligation));
  if (candidate && EVIDENCE_CAPABILITY_REGISTRY[candidate].supported) return { ok: true, capability: candidate, reason: null, disposition: 'NEEDS_EVIDENCE' };
  const routeNames = capabilities.length > 0 ? capabilities.join(', ') : 'none';
  return { ok: false, capability: candidate ?? null, reason: `Required proof obligation ${obligation.kind} is not established by the selected evidence capability (route: ${routeNames}).`, disposition: 'UNSUPPORTED' };
}

function capabilityCanEstablish(capability: EvidenceCapability, obligation: ProofObligation): boolean {
  if (obligation.requiredCapabilities.length > 0) return obligation.requiredCapabilities.includes(capability);
  return EVIDENCE_CAPABILITY_REGISTRY[capability].establishes.includes(obligation.kind);
}

function extractChainProfile(value: string): string | null {
  const lower = value.toLocaleLowerCase();
  if (/\bbase\s+sepolia\b/.test(lower)) return 'base-sepolia';
  if (/\bbase(?:\s+mainnet)?\b/.test(lower)) return 'base';
  if (/\barc(?:\s+testnet)?\b/.test(lower)) return 'arc-testnet';
  for (const chain of ['ethereum', 'bnb', 'sui', 'solana', 'walrus', '0g']) {
    if (new RegExp(`\\b${chain}\\b`, 'i').test(value)) return chain;
  }
  const namedChain = value.match(/\b(?:on\s+)?([A-Za-z][A-Za-z0-9-]*(?:\s+(?:testnet|mainnet|sepolia))?)\s+(?:with\s+)?chain\s+ID\b/i)?.[1];
  if (namedChain) return namedChain.toLocaleLowerCase().replace(/\s+/g, '-');
  return null;
}

function isSubjective(value: string): boolean {
  return /\b(?:excellent\s+user\s+experience|meaningful\s+use\s+of\s+arc|strong\s+product|innovative\s+implementation|high[- ]quality\s+UX|feels?\s+(?:trustworthy|good)|beautiful|easy\s+to\s+use|user[- ]friendly|satisfied|appropriate|reasonable)\b/i.test(value);
}
