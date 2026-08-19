import type {
  EvidenceCapability,
  ProofObligation,
  SupportedPredicateFinding,
  SupportedPredicateType,
} from './types.ts';

type PredicateDetector = (source: string) => SupportedPredicateFinding[];

interface SupportedPredicateDescriptor {
  canonicalPredicate: SupportedPredicateType;
  capability: EvidenceCapability;
  operation: string;
  detect: PredicateDetector;
}

const ADDRESS = '0x[a-f0-9]{40}';
const TRANSACTION = '0x[a-f0-9]{64}';

function obligation(kind: ProofObligation['kind'], description: string, requiredCapabilities: EvidenceCapability[], requiredChainProfile?: string | null): ProofObligation {
  return { kind, description, requiredCapabilities, objective: true, ...(requiredChainProfile ? { requiredChainProfile } : {}) };
}

function finding(
  canonicalPredicate: SupportedPredicateType,
  source: string,
  start: number,
  end: number,
  predicate: string,
  entities: Record<string, string>,
  capability: EvidenceCapability,
  operation: string,
  proofObligation: ProofObligation,
): SupportedPredicateFinding {
  const normalizedEntities = Object.fromEntries(Object.entries(entities).map(([key, value]) => [key, normalizeEntity(value)]));
  return {
    canonicalPredicate,
    sourceText: source.slice(start, end),
    sourceSpan: { start, end },
    predicate,
    entities: normalizedEntities,
    proofObligation,
    capability,
    operation,
    signature: predicateSignature(canonicalPredicate, normalizedEntities),
  };
}

export function predicateSignature(type: SupportedPredicateType, entities: Record<string, string> = {}): string {
  const values = Object.entries(entities)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${normalizeEntity(value)}`)
    .join('|');
  return `${type}|${values}`;
}

export const SUPPORTED_PREDICATE_REGISTRY: readonly SupportedPredicateDescriptor[] = [
  {
    canonicalPredicate: 'repository_exists',
    capability: 'github.repository_presence',
    operation: 'repo_exists',
    detect: detectRepositoryExistence,
  },
  {
    canonicalPredicate: 'file_exists',
    capability: 'github.file_presence',
    operation: 'file_exists',
    detect: detectFileExistence,
  },
  {
    canonicalPredicate: 'http_status',
    capability: 'http.runtime',
    operation: 'status_matches',
    detect: detectHttpStatus,
  },
  {
    canonicalPredicate: 'json_valid',
    capability: 'http.runtime',
    operation: 'json_valid',
    detect: detectJsonValidity,
  },
  {
    canonicalPredicate: 'json_field_equals',
    capability: 'http.runtime',
    operation: 'json_field_matches',
    detect: detectJsonField,
  },
  {
    canonicalPredicate: 'chain_identity',
    capability: 'evm.chain_identity',
    operation: 'chain_id_matches',
    detect: detectChainIdentity,
  },
  {
    canonicalPredicate: 'contract_code',
    capability: 'evm.contract_state',
    operation: 'contract_code_exists',
    detect: detectContractCode,
  },
  {
    canonicalPredicate: 'transaction_existence',
    capability: 'evm.transaction',
    operation: 'transaction_exists',
    detect: detectTransactionExistence,
  },
  {
    canonicalPredicate: 'transaction_success',
    capability: 'evm.event',
    operation: 'receipt_status_matches',
    detect: detectTransactionSuccess,
  },
  {
    canonicalPredicate: 'npm_package_exists',
    capability: 'npm.package_state',
    operation: 'package_exists',
    detect: detectNpmPackageExistence,
  },
  {
    canonicalPredicate: 'npm_version',
    capability: 'npm.package_state',
    operation: 'version_matches',
    detect: detectNpmVersion,
  },
  {
    canonicalPredicate: 'npm_repository',
    capability: 'npm.package_state',
    operation: 'metadata_matches',
    detect: detectNpmRepository,
  },
  {
    canonicalPredicate: 'npm_distribution_metadata',
    capability: 'npm.package_state',
    operation: 'distribution_metadata',
    detect: detectNpmDistributionMetadata,
  },
] as const;

export function auditSupportedPredicates(source: string): SupportedPredicateFinding[] {
  const findings = SUPPORTED_PREDICATE_REGISTRY.flatMap((descriptor) => descriptor.detect(source));
  const unique = new Map<string, SupportedPredicateFinding>();
  for (const item of findings) {
    if (!unique.has(item.signature)) unique.set(item.signature, item);
  }
  const order = new Map(SUPPORTED_PREDICATE_REGISTRY.map((item, index) => [item.canonicalPredicate, index]));
  return [...unique.values()].sort((left, right) => left.sourceSpan.start - right.sourceSpan.start || (order.get(left.canonicalPredicate) ?? 0) - (order.get(right.canonicalPredicate) ?? 0));
}

function detectRepositoryExistence(source: string): SupportedPredicateFinding[] {
  const pattern = /\b(?:public\s+(?:implementation\s+)?repository|repository)\s+(?:exists|is\s+public|is\s+available|containing|includes|contains)\b/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const start = match.index ?? 0;
    return finding('repository_exists', source, start, start + match[0].length, 'public repository exists', {}, 'github.repository_presence', 'repo_exists', obligation('PRESENCE', 'The criterion requires an attributable public repository.', ['github.repository_presence']));
  });
}

function detectFileExistence(source: string): SupportedPredicateFinding[] {
  if (!/\b(?:repository|repo)\b/i.test(source)) return [];
  const pattern = /(?:^|[\s,])([A-Za-z0-9._~/-]+\.(?:sol|mjs|json|ts|tsx|js))\b/gi;
  const findings: SupportedPredicateFinding[] = [];
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + (match[0].length - (match[1]?.length ?? 0));
    if (isInsideUrl(source, start)) continue;
    const path = match[1];
    findings.push(finding('file_exists', source, start, start + path.length, `${path} exists`, { path }, 'github.file_presence', 'file_exists', obligation('PRESENCE', 'The criterion requires an attributable repository file.', ['github.file_presence'])));
  }
  return findings;
}

function detectHttpStatus(source: string): SupportedPredicateFinding[] {
  if (!hasHttpContext(source)) return [];
  const patterns = [
    /\breturns?\s+(?:HTTP\s*)?(\d{3})\b/gi,
    /\bHTTP\s+(\d{3})\b/gi,
    /\bstatus\s+(?:equals|is|==)\s+(\d{3})\b/gi,
  ];
  const url = extractUrl(source);
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => {
    const start = match.index ?? 0;
    const status = match[1];
    return finding('http_status', source, start, start + match[0].length, `HTTP status equals ${status}`, { ...(url ? { url } : {}), expected: status }, 'http.runtime', 'status_matches', obligation('RUNTIME', 'The criterion requires an HTTP status observation.', ['http.runtime']));
  }));
}

function detectJsonValidity(source: string): SupportedPredicateFinding[] {
  if (!hasHttpContext(source)) return [];
  const pattern = /\bvalid\s+JSON\b/gi;
  const url = extractUrl(source);
  return [...source.matchAll(pattern)].map((match) => {
    const start = match.index ?? 0;
    return finding('json_valid', source, start, start + match[0].length, 'HTTP response is valid JSON', { ...(url ? { url } : {}), expected: 'true' }, 'http.runtime', 'json_valid', obligation('RUNTIME', 'The criterion requires a valid JSON response observation.', ['http.runtime']));
  });
}

function detectJsonField(source: string): SupportedPredicateFinding[] {
  if (!hasHttpContext(source)) return [];
  const pattern = /\b([A-Za-z_$][A-Za-z0-9_.-]*)\s*(?:equals|==|is\b)\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|true|false|null|-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_-]*)/gi;
  const url = extractUrl(source);
  return [...source.matchAll(pattern)].flatMap((match) => {
    if (!isWithinHttpClause(source, match.index ?? 0)) return [];
    const field = match[1];
    if (!field || /^(?:status|chain|id)$/i.test(field)) return [];
    const expected = normalizeExpected(match[2] ?? '');
    const start = match.index ?? 0;
    return [finding('json_field_equals', source, start, start + match[0].length, `JSON field ${field} equals ${expected}`, { ...(url ? { url } : {}), field, expected }, 'http.runtime', 'json_field_matches', obligation('RUNTIME', 'The criterion requires an attributable JSON field observation.', ['http.runtime']))];
  });
}

function detectChainIdentity(source: string): SupportedPredicateFinding[] {
  const pattern = /\b(?:on\s+)?([A-Za-z][A-Za-z0-9-]*(?:\s+(?:testnet|mainnet|sepolia))?)\s+(?:with\s+)?chain\s+ID\s+(?:equals|is|==)?\s*(\d+)\b/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const start = match.index ?? 0;
    const label = match[1].trim();
    const chainId = match[2];
    const profile = profileFor(label);
    return finding('chain_identity', source, start, start + match[0].length, `${label} chain ID equals ${chainId}`, { ...(profile ? { chainProfile: profile } : {}), chainId }, 'evm.chain_identity', 'chain_id_matches', obligation('ONCHAIN_STATE', 'The criterion requires EVM chain identity from the selected RPC.', ['evm.chain_identity'], profile));
  });
}

function detectContractCode(source: string): SupportedPredicateFinding[] {
  if (!isEvmScoped(source)) return [];
  const patterns: Array<{ pattern: RegExp; addressGroup: string; nameGroup?: string }> = [
    { pattern: new RegExp(`\\b(?<name>[A-Za-z][A-Za-z0-9_-]*)\\s+is\\s+deployed\\s+(?:with\\s+)?contract\\s+code\\s+at(?:\\s+address)?\\s+(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address', nameGroup: 'name' },
    { pattern: new RegExp(`\\b(?:contract\\s+)?(?<name>[A-Za-z][A-Za-z0-9_-]*)\\s+is\\s+deployed\\s+at(?:\\s+address)?\\s+(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address', nameGroup: 'name' },
    { pattern: new RegExp(`\\bcontract\\s+(?<name>[A-Za-z][A-Za-z0-9_-]*)\\s+has\\s+deployed\\s+(?:contract\\s+)?code\\s+at(?:\\s+address)?\\s+(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address', nameGroup: 'name' },
    { pattern: new RegExp(`\\bcontract\\s+(?<address>${ADDRESS})\\s+is\\s+deployed\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\bdeployed\\s+contract\\s+(?<name>[A-Za-z][A-Za-z0-9_-]*)\\s+at(?:\\s+address)?\\s+(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address', nameGroup: 'name' },
    { pattern: new RegExp(`\\bcontract\\s+(?<address>${ADDRESS})\\s+(?:has\\s+)?(?:deployed\\s+)?(?:contract\\s+)?code\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\bdeployed\\s+contract\\s+code\\s+(?:exists\\s+)?at\\s+(?:address\\s+)?(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\bdeployed\\s+bytecode\\s+exists\\s+at\\s+(?:address\\s+)?(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\bdeployed\\s+code\\s+exists\\s+at\\s+(?:address\\s+)?(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\b(?:contract\\s+)?code\\s+exists\\s+at\\s+(?:address\\s+)?(?<address>${ADDRESS})\\b`, 'gi'), addressGroup: 'address' },
    { pattern: new RegExp(`\\b(?<address>${ADDRESS})\\s+contains\\s+(?:deployed\\s+)?(?:contract\\s+)?(?:code|bytecode)\\b`, 'gi'), addressGroup: 'address' },
  ];
  const findings: SupportedPredicateFinding[] = [];
  for (const item of patterns) {
    for (const match of source.matchAll(item.pattern)) {
      const groups = match.groups ?? {};
      const address = groups[item.addressGroup]?.toLowerCase();
      if (!address) continue;
      const start = match.index ?? 0;
      const profile = profileFor(source, start);
      const entities = { address, ...(item.nameGroup && groups[item.nameGroup] ? { contractName: groups[item.nameGroup] } : {}), ...(profile ? { chainProfile: profile } : {}) };
      findings.push(finding('contract_code', source, start, start + match[0].length, `contract code exists at ${address}`, entities, 'evm.contract_state', 'contract_code_exists', obligation('ONCHAIN_STATE', 'The criterion requires non-empty deployed bytecode from the selected EVM RPC.', ['evm.contract_state'], profile)));
    }
  }
  return findings;
}

function detectTransactionExistence(source: string): SupportedPredicateFinding[] {
  const pattern = new RegExp(`\\b(?:transaction|tx)\\s+(?<hash>${TRANSACTION})\\b[^.;]*?\\b(?:exists|was\\s+found|is\\s+present)\\b`, 'gi');
  return [...source.matchAll(pattern)].map((match) => {
    const hash = match.groups?.hash?.toLowerCase() ?? '';
    const start = match.index ?? 0;
    const profile = profileFor(source, start);
    return finding('transaction_existence', source, start, start + match[0].length, `transaction ${hash} exists`, { transactionHash: hash, ...(profile ? { chainProfile: profile } : {}) }, 'evm.transaction', 'transaction_exists', obligation('ONCHAIN_STATE', 'The criterion requires transaction lookup evidence from the selected EVM RPC.', ['evm.transaction'], profile));
  });
}

function detectTransactionSuccess(source: string): SupportedPredicateFinding[] {
  const pattern = new RegExp(`\\b(?:transaction|tx)\\s+(?<hash>${TRANSACTION})\\b[^.;]*?\\b(?:succeeded|completed\\s+successfully|was\\s+successful|has\\s+a\\s+successful\\s+receipt|successful)\\b`, 'gi');
  return [...source.matchAll(pattern)].map((match) => {
    const hash = match.groups?.hash?.toLowerCase() ?? '';
    const start = match.index ?? 0;
    const profile = profileFor(source, start);
    return finding('transaction_success', source, start, start + match[0].length, `transaction ${hash} receipt succeeded`, { transactionHash: hash, ...(profile ? { chainProfile: profile } : {}) }, 'evm.event', 'receipt_status_matches', obligation('ONCHAIN_EVENT', 'The criterion requires receipt success evidence from the selected EVM RPC.', ['evm.event'], profile));
  });
}

function detectNpmPackageExistence(source: string): SupportedPredicateFinding[] {
  const pattern = /\bnpm\s+(?:package\s+)?(?<package>@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)\b[^.;]*\bexists\b/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const packageName = match.groups?.package ?? '';
    const start = match.index ?? 0;
    return finding('npm_package_exists', source, start, start + match[0].length, `npm package ${packageName} exists`, { packageName }, 'npm.package_state', 'package_exists', obligation('PRESENCE', 'The criterion requires npm registry package presence.', ['npm.package_state']));
  });
}

function detectNpmVersion(source: string): SupportedPredicateFinding[] {
  const pattern = /\bnpm\s+(?:package\s+)?(?<package>@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)\b[^.;]*?\b(?:exact\s+)?version\s+(?<version>v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const packageName = match.groups?.package ?? '';
    const version = (match.groups?.version ?? '').replace(/^v/i, '');
    const start = match.index ?? 0;
    return finding('npm_version', source, start, start + match[0].length, `npm package ${packageName} exact version ${version}`, { packageName, version }, 'npm.package_state', 'version_matches', obligation('CONTENT', 'The criterion requires an exact npm registry version observation.', ['npm.package_state']));
  });
}

function detectNpmRepository(source: string): SupportedPredicateFinding[] {
  const pattern = /\bnpm\s+(?:package\s+)?(?<package>@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)\b[^;]*?\b(?:repository(?:\s+association)?|associated\s+with)\s+(?<repository>https:\/\/[^\s,;]+)/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const packageName = match.groups?.package ?? '';
    const repository = (match.groups?.repository ?? '').replace(/[.!?]+$/, '');
    const start = match.index ?? 0;
    return finding('npm_repository', source, start, start + match[0].length, `npm package ${packageName} repository association equals ${repository}`, { packageName, repository }, 'npm.package_state', 'metadata_matches', obligation('CONTENT', 'The criterion requires npm repository metadata.', ['npm.package_state']));
  });
}

function detectNpmDistributionMetadata(source: string): SupportedPredicateFinding[] {
  const pattern = /\bnpm\s+(?:package\s+)?(?<package>@?[a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)\b[^;]*\b(?:distribution\s+metadata|integrity)\b/gi;
  return [...source.matchAll(pattern)].map((match) => {
    const packageName = match.groups?.package ?? '';
    const start = match.index ?? 0;
    return finding('npm_distribution_metadata', source, start, start + match[0].length, `npm package ${packageName} distribution metadata has integrity`, { packageName }, 'npm.package_state', 'distribution_metadata', obligation('CONTENT', 'The criterion requires npm distribution and integrity metadata.', ['npm.package_state']));
  });
}

function hasHttpContext(source: string): boolean {
  return /https?:\/\//i.test(source) && /\b(?:HTTP|endpoint|health|JSON)\b/i.test(source);
}

function isWithinHttpClause(source: string, index: number): boolean {
  let left = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ((source[cursor] === ';' || source[cursor] === '\n' || source[cursor] === '.') && !isInsideUrl(source, cursor)) {
      left = cursor;
      break;
    }
  }
  let right = source.length;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    if ((source[cursor] === ';' || source[cursor] === '\n' || source[cursor] === '.') && !isInsideUrl(source, cursor)) {
      right = cursor;
      break;
    }
  }
  return hasHttpContext(source.slice(left + 1, right));
}

function extractUrl(source: string): string | null {
  return source.match(/https?:\/\/[^\s,;]+/i)?.[0]?.replace(/[.!?]+$/, '') ?? null;
}

function isEvmScoped(source: string): boolean {
  return new RegExp(ADDRESS, 'i').test(source) && /\b(?:EVM|Arc|Base|testnet|mainnet|chain\s+ID|contract|bytecode|transaction)\b/i.test(source);
}

function profileFor(source: string, index = -1): string | null {
  const value = index >= 0 ? clauseAt(source, index) : source;
  const lower = value.toLocaleLowerCase();
  if (/\barc(?:\s+testnet)?\b/.test(lower)) return 'arc-testnet';
  if (/\bbase\s+sepolia\b/.test(lower)) return 'base-sepolia';
  if (/\bbase(?:\s+mainnet)?\b/.test(lower)) return 'base';
  for (const chain of ['ethereum', 'bnb', 'sui', 'solana', 'walrus', '0g']) {
    if (new RegExp(`\\b${chain}\\b`, 'i').test(value)) return chain;
  }
  const label = value.match(/\b([A-Za-z][A-Za-z0-9-]*(?:\s+(?:testnet|mainnet|sepolia))?)\s+(?:with\s+)?chain\s+ID\b/i)?.[1];
  return label ? label.toLocaleLowerCase().replace(/\s+/g, '-') : null;
}

function clauseAt(source: string, index: number): string {
  let left = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ((source[cursor] === ';' || source[cursor] === '\n' || source[cursor] === '.') && !isInsideUrl(source, cursor)) {
      left = cursor;
      break;
    }
  }
  let right = source.length;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    if ((source[cursor] === ';' || source[cursor] === '\n' || source[cursor] === '.') && !isInsideUrl(source, cursor)) {
      right = cursor;
      break;
    }
  }
  return source.slice(left + 1, right);
}

function normalizeExpected(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return JSON.stringify(trimmed.slice(1, -1));
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/i.test(trimmed)) return trimmed.toLowerCase();
  return JSON.stringify(trimmed);
}

function normalizeEntity(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isInsideUrl(source: string, index: number): boolean {
  let start = index - 1;
  while (start >= 0 && !/\s/.test(source[start] ?? '')) start -= 1;
  return source.slice(start + 1, index).includes('://');
}
