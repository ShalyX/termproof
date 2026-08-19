import type { MilestonePlanner } from '../../src/agent/planner.ts';
import type { BaseNetwork, NormalizedAcceptanceTerm, NpmOperation, PlannedClaim, VerificationPlan } from '../../src/core/types.ts';

export const proofletRepository = 'https://github.com/ShalyX/prooflet-protocol';
export const proofletHealthUrl = 'https://prooflet-api.onrender.com/health';

export const proofletMilestone = `/health is reachable at ${proofletHealthUrl}; public repository exists; package.json exists; contracts/EscrowV2.sol exists; HTTP status equals 200; response is valid JSON; protocol == "Prooflet"; ok == true; Base mainnet chain ID equals 8453; Base mainnet contract 0x4200000000000000000000000000000000000006 is deployed; npm package prooflet exists; npm package prooflet exact version 0.2.0; npm package prooflet distribution metadata has integrity.`;

export class ProofletPlanner implements MilestonePlanner {
  metadata() {
    return { kind: 'test-fixture', model: null };
  }

  async plan(input: { milestone: string; githubRepository: string; acceptanceTerms?: NormalizedAcceptanceTerm[] }): Promise<VerificationPlan> {
    const terms = input.acceptanceTerms ?? [];
    const term = (pattern: RegExp): string => {
      const match = terms.find((candidate) => pattern.test(candidate.text));
      if (!match) throw new Error(`Prooflet fixture term missing: ${pattern}`);
      return match.id;
    };
    const url = input.milestone.match(/https:\/\/[^\s;]+/i)?.[0]?.replace(/[.,]$/, '') ?? proofletHealthUrl;
    const expectedStatus = input.milestone.match(/HTTP\s+status\s+equals\s+(\d{3})/i)?.[1] ?? '200';
    const claims: PlannedClaim[] = [];
    let sequence = 0;
    const add = (statement: string, acceptanceTermId: string, operation: 'repo_exists' | 'file_exists' | 'status_matches' | 'body_contains' | 'json_valid' | 'json_field_matches', params: Record<string, string | null>) => {
      const id = `prooflet-claim-${++sequence}`;
      claims.push({
        id,
        acceptanceTermIds: [acceptanceTermId],
        statement,
        required: true,
        testability: 'OBJECTIVE',
        steps: [{ id: `${id}-step`, claimId: id, adapter: operation === 'repo_exists' || operation === 'file_exists' ? 'github' : 'http', operation, params } as PlannedClaim['steps'][number]],
      });
    };

    add('Public repository exists', term(/public repository/i), 'repo_exists', { path: null, expected: null });
    add('package.json exists', term(/^package\.json exists$/i), 'file_exists', { path: 'package.json', expected: null });
    add('contracts/EscrowV2.sol exists', term(/contracts\/EscrowV2\.sol/i), 'file_exists', { path: 'contracts/EscrowV2.sol', expected: null });
    add('/health is reachable', term(/\/health is reachable/i), 'body_contains', { url, expected: '"protocol"' });
    add(`HTTP status equals ${expectedStatus}`, term(/HTTP status equals/i), 'status_matches', { url, expected: expectedStatus });
    add('HTTP response is valid JSON', term(/valid JSON/i), 'json_valid', { url, expected: 'true' });
    add('HTTP protocol field equals Prooflet', term(/protocol\s*==/i), 'json_field_matches', { url, expected: 'protocol=Prooflet' });
    add('HTTP ok field equals true', term(/ok\s*==/i), 'json_field_matches', { url, expected: 'ok=true' });

    const addBase = (statement: string, acceptanceTermId: string, operation: 'chain_id_matches' | 'contract_deployed', params: { network: BaseNetwork; address: string | null; expected: string | null }) => {
      const id = `prooflet-claim-${++sequence}`;
      claims.push({
        id,
        acceptanceTermIds: [acceptanceTermId],
        statement,
        required: true,
        testability: 'OBJECTIVE',
        steps: [{ id: `${id}-step`, claimId: id, adapter: 'base', operation, params } as PlannedClaim['steps'][number]],
      });
    };
    addBase('Base mainnet chain ID equals 8453', term(/chain ID/i), 'chain_id_matches', { network: 'base', address: null, expected: '8453' });
    const baseAddress = input.milestone.match(/Base\s+mainnet\s+contract\s+(0x[a-f0-9]{40})/i)?.[1] ?? null;
    if (baseAddress) addBase(`Base mainnet contract ${baseAddress} is deployed`, term(/contract 0x/i), 'contract_deployed', { network: 'base', address: baseAddress, expected: null });

    const packageName = input.milestone.match(/\bnpm\s+package\s+([@a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)/i)?.[1] ?? 'prooflet';
    const packageVersion = input.milestone.match(/\bnpm\s+package\s+[^;]+?\bversion\s+(v?\d+\.\d+\.\d+)/i)?.[1]?.replace(/^v/i, '') ?? null;
    const addNpm = (statement: string, acceptanceTermId: string, operation: NpmOperation, expected: string | null) => {
      const id = `prooflet-claim-${++sequence}`;
      claims.push({
        id,
        acceptanceTermIds: [acceptanceTermId],
        statement,
        required: true,
        testability: 'OBJECTIVE',
        steps: [{ id: `${id}-step`, claimId: id, adapter: 'npm', operation, params: { packageName, expected, repository: null } } as PlannedClaim['steps'][number]],
      });
    };
    addNpm(`npm package ${packageName} exists`, term(/npm package .* exists/i), 'package_exists', null);
    if (packageVersion) addNpm(`npm package ${packageName} exact version ${packageVersion}`, term(/exact version/i), 'version_matches', packageVersion);
    addNpm(`npm package ${packageName} distribution metadata has integrity`, term(/distribution metadata|integrity/i), 'distribution_metadata', packageVersion);

    return {
      acceptanceTerms: terms.map((candidate) => ({ id: candidate.id, disposition: 'PLANNED', reason: null })),
      claims,
      missingEvidence: [],
    };
  }
}
