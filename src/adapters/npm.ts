import { createEvidence } from '../core/evidence.ts';
import type { AdapterExecution, EvidenceRecord, NpmStep, StepResult } from '../core/types.ts';

const REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class NpmAdapter {
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;
  private maxResponseBytes: number;

  constructor(options: { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; maxResponseBytes?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async execute(step: NpmStep): Promise<AdapterExecution> {
    if (!isPackageName(step.params.packageName)) return this.make(step, 'INCONCLUSIVE', 'npm package name is invalid', { error: 'invalid_package_name' }, null, { error: 'invalid_package_name' });
    if (!['package_exists', 'version_matches', 'metadata_matches', 'distribution_metadata'].includes(step.operation)) return this.make(step, 'INCONCLUSIVE', 'Unsupported npm operation', { error: 'invalid_operation' }, null, { error: 'invalid_operation' });
    const encoded = step.params.packageName.split('/').map(encodeURIComponent).join('/');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let rawText: string;
    try {
      response = await this.fetchImpl(`${REGISTRY}/${encoded}`, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' }, signal: controller.signal });
      rawText = await response.text();
    } catch {
      const error = controller.signal.aborted ? 'timeout' : 'transport_error';
      return this.make(step, 'INCONCLUSIVE', 'npm registry request could not be completed', { error }, null, { error });
    } finally {
      clearTimeout(timeout);
    }
    if (new TextEncoder().encode(rawText).byteLength > this.maxResponseBytes) return this.make(step, 'INCONCLUSIVE', 'npm registry response exceeded the evidence limit', { error: 'response_too_large' }, null, { error: 'response_too_large' });
    const parsed = parseJson(rawText);
    if (response.status === 404) return this.make(step, 'FAIL', 'npm package was not found', parsed ?? { status: 404 }, null, { status: 404, packageName: step.params.packageName });
    if (response.status === 429 || response.status >= 500) return this.make(step, 'INCONCLUSIVE', `npm registry HTTP ${response.status}`, parsed ?? { status: response.status }, null, { status: response.status });
    if (response.status !== 200 || !parsed || typeof parsed !== 'object') return this.make(step, 'INCONCLUSIVE', 'npm registry response was malformed', parsed ?? { error: 'malformed_json' }, null, { error: 'malformed_json', status: response.status });
    const metadata = parsed as Record<string, unknown>;
    const latest = stringAt(metadata, ['dist-tags', 'latest']);
    const version = step.operation === 'package_exists' ? null : step.operation === 'metadata_matches' ? latest : step.params.expected ?? latest;
    const versionMetadata = version ? objectAt(metadata, ['versions', version]) : null;
    const repository = versionMetadata ? repositoryUrl(versionMetadata) : null;
    const dist = versionMetadata ? objectAt(versionMetadata, ['dist']) : null;
    const facts = { packageName: stringAt(metadata, ['name']), latest, selectedVersion: version, repository, tarball: stringAt(dist, ['tarball']), integrity: stringAt(dist, ['integrity']) };
    let result: StepResult = 'PASS';
    let message = `npm package ${step.params.packageName} exists`;
    if (step.operation === 'version_matches') {
      result = versionMetadata ? 'PASS' : 'FAIL';
      message = result === 'PASS' ? `npm version ${version} exists` : `npm version ${step.params.expected} was not found`;
    } else if (step.operation === 'metadata_matches') {
      const expected = normalizeRepository(step.params.expected);
      result = versionMetadata && repository && expected && normalizeRepository(repository) === expected ? 'PASS' : 'FAIL';
      message = result === 'PASS' ? 'npm repository association matches' : 'npm repository association did not match';
    } else if (step.operation === 'distribution_metadata') {
      result = versionMetadata && facts.tarball && facts.integrity ? 'PASS' : 'FAIL';
      message = result === 'PASS' ? 'npm distribution and integrity metadata is present' : 'npm distribution metadata is incomplete';
    }
    const observedVersion = versionMetadata ? { version: stringAt(versionMetadata, ['version']), repository: versionMetadata.repository ?? null, dist: versionMetadata.dist ?? null } : null;
    return this.make(step, result, message, { status: response.status, packageName: metadata.name ?? null, distTags: metadata['dist-tags'] ?? null, selectedVersion: version, version: observedVersion }, version ?? latest, facts);
  }

  private make(step: NpmStep, result: StepResult, message: string, raw: unknown, revision: string | null, extractedFacts: Record<string, unknown>): AdapterExecution {
    const evidence: EvidenceRecord = createEvidence({ claimId: step.claimId, stepId: step.id, adapter: 'npm', source: `${REGISTRY}/${step.params.packageName}`, revision, raw, extractedFacts, result }, this.now());
    return { result, message, evidence };
  }
}

function isPackageName(value: string): boolean { return /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/.test(value); }
function parseJson(text: string): unknown { if (!text) return null; try { return JSON.parse(text); } catch { return null; } }
function objectAt(value: unknown, path: string[]): Record<string, unknown> | null { let current: unknown = value; for (const key of path) { if (!current || typeof current !== 'object') return null; current = (current as Record<string, unknown>)[key]; } return current && typeof current === 'object' ? current as Record<string, unknown> : null; }
function stringAt(value: unknown, path: string[]): string | null { let current: unknown = value; for (const key of path) { if (!current || typeof current !== 'object') return null; current = (current as Record<string, unknown>)[key]; } return typeof current === 'string' ? current : null; }
function repositoryUrl(version: Record<string, unknown>): string | null { const repository = version.repository; if (typeof repository === 'string') return repository; if (repository && typeof repository === 'object') return stringAt(repository, ['url']); return null; }
function normalizeRepository(value: string | null): string | null { return value?.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase() ?? null; }
