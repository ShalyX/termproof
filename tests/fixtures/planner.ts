import type { MilestonePlanner } from '../../src/agent/planner.ts';
import type { BaseNetwork, NpmOperation, NormalizedAcceptanceTerm, PlannedClaim, VerificationPlan } from '../../src/core/types.ts';

export class FixturePlanner implements MilestonePlanner {
  metadata() { return { kind: 'test-fixture', model: null }; }

  async plan(input: { milestone: string; githubRepository: string; acceptanceTerms?: NormalizedAcceptanceTerm[] }): Promise<VerificationPlan> {
    const text = input.milestone;
    const terms = input.acceptanceTerms ?? [];
    const claims: PlannedClaim[] = [];
    let n = 0;
    const termFor = (...patterns: RegExp[]): string => terms.find((term) => patterns.some((pattern) => pattern.test(term.text)))?.id ?? terms[0]?.id ?? 'term-01-fixture';
    const add = (statement: string, operation: 'repo_exists'|'file_exists'|'license_matches'|'release_exists', path: string|null, expected: string|null, termId = termFor(/repository|repo|source|license/i)) => {
      const id = `claim-${++n}`;
      claims.push({ id, acceptanceTermIds: [termId], statement, required: true, testability: 'OBJECTIVE', steps: [{ id: `step-${n}`, claimId: id, adapter: 'github', operation, params: { path, expected } }] });
    };
    if (/repository|repo|source|open[- ]source/i.test(text)) add('Public repository exists', 'repo_exists', null, null);
    const license = text.match(/\b(MIT|Apache(?:-?2\.0)?|GPL(?:-?3\.0)?|BSD(?:-3-Clause)?)\b/i)?.[1];
    if (license) add(`Repository uses ${license} license`, 'license_matches', null, license, termFor(/license/i));
    const release = [...text.matchAll(/(?:release|version|tag)\s+(v?\d+(?:\.\d+){1,2})/gi)].find((match) => !/\bnpm\s+package\s+[a-z0-9._~\/-]+\s+exists\s*$/i.test(text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0)))?.[1];
    if (release) add(`Release ${release} exists`, 'release_exists', null, release, termFor(/release|version|tag/i));
    if (/readme/i.test(text)) add('README exists', 'file_exists', 'README.md', null, termFor(/readme/i));
    const http = text.match(/(?:HTTP\s+(?:endpoint\s+)?|endpoint\s+)(https:\/\/[^\s,;]+)\s+(?:returns?|responds\s+with)\s+(?:HTTP\s*)?(\d{3})/i);
    if (http) {
      const id = `claim-${++n}`;
      claims.push({ id, acceptanceTermIds: [termFor(/HTTP.*returns|status.*\d{3}/i, /endpoint.*HTTP/i)], statement: `HTTP endpoint ${http[1]} returns ${http[2]}`, required: true, testability: 'OBJECTIVE', steps: [{ id: `step-${n}`, claimId: id, adapter: 'http', operation: 'status_matches', params: { url: http[1], expected: http[2] } }] });
    }
    const base = text.match(/\bBase(?:\s+(mainnet|sepolia))?\s+contract\s+(0x[a-f0-9]{40})\s+(?:is\s+)?deployed/i);
    if (base) {
      const network: BaseNetwork = base[1]?.toLowerCase() === 'sepolia' ? 'base-sepolia' : 'base';
      const id = `claim-${++n}`;
      const termId = termFor(/Base/i);
      claims.push({ id, acceptanceTermIds: [termId], statement: `${network} contract ${base[2]} is deployed`, required: true, testability: 'OBJECTIVE', steps: [
        { id: `step-${n}-chain`, claimId: id, adapter: 'base', operation: 'chain_id_matches', params: { network, address: null, expected: null } },
        { id: `step-${n}-code`, claimId: id, adapter: 'base', operation: 'contract_deployed', params: { network, address: base[2], expected: null } },
      ] });
    }
    const npm = text.match(/\bnpm\s+(?:package\s+)?([@a-z0-9._~-]+(?:\/[a-z0-9._~-]+)?)/i);
    if (npm) {
      const packageName = npm[1];
      const addNpm = (operation: NpmOperation, expected: string | null, statement: string, repository: string | null = null) => {
        const id = `claim-${++n}`;
        const termId = operation === 'package_exists'
          ? termFor(/npm package .* exists/i)
          : operation === 'version_matches'
            ? termFor(/npm package .* exact version|npm package .* version/i)
            : operation === 'metadata_matches'
              ? termFor(/repository association|associated with/i)
              : termFor(/distribution metadata|integrity/i);
        claims.push({ id, acceptanceTermIds: [termId], statement, required: true, testability: 'OBJECTIVE', steps: [{ id: `step-${n}`, claimId: id, adapter: 'npm', operation, params: { packageName, expected, repository } }] });
      };
      if (/\bexists\b/i.test(text)) addNpm('package_exists', null, `npm package ${packageName} exists`);
      const npmVersion = text.match(/\bversion\s+(v?\d+(?:\.\d+){1,2})/i)?.[1];
      if (npmVersion) addNpm('version_matches', npmVersion.replace(/^v/i, ''), `npm package ${packageName} has version ${npmVersion}`);
      const npmRepository = text.match(/\brepository\s+(https:\/\/github\.com\/[\w.-]+\/[\w.-]+)/i)?.[1];
      if (npmRepository) addNpm('metadata_matches', npmRepository, `npm package ${packageName} is associated with ${npmRepository}`, npmRepository);
      if (/integrity|distribution metadata/i.test(text)) addNpm('distribution_metadata', npmVersion?.replace(/^v/i, '') ?? null, `npm package ${packageName} has distribution and integrity metadata`);
    }
    if (claims.length === 0) {
      return { acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: 'NOT_OBJECTIVELY_TESTABLE', reason: 'Fixture has no executable route.' })), claims: [{ id: 'claim-1', acceptanceTermIds: [terms[0]?.id ?? 'term-01-fixture'], statement: text, required: true, testability: 'HUMAN', steps: [] }], missingEvidence: ['No supported deterministic criterion was identified.'] };
    }
    const covered = new Set(claims.flatMap((claim) => claim.acceptanceTermIds ?? []));
    return {
      acceptanceTerms: terms.map((term) => ({ id: term.id, disposition: covered.has(term.id) ? 'PLANNED' : 'NEEDS_EVIDENCE', reason: covered.has(term.id) ? null : 'Fixture did not plan an executable route.' })),
      claims,
      missingEvidence: [],
    };
  }
}
