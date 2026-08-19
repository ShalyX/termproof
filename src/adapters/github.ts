import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createEvidence } from '../core/evidence.ts';
import type { AdapterExecution, GitHubStep, StepResult } from '../core/types.ts';

const API_VERSION = '2026-03-10';
const USER_AGENT = 'grant-milestone-verifier/0.1';
const FALLBACK_MAX_BYTES = 512 * 1024;

export interface GitHubRepositoryRef { owner: string; repo: string }

export function parseGitHubRepository(value: string): GitHubRepositoryRef {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('GitHub repository must use https://github.com/<owner>/<repo>');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GitHub repository URL is missing owner or repository');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Invalid GitHub owner or repository');
  }
  return { owner, repo };
}

export class GitHubAdapter {
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private token: string | undefined;

  constructor(options: { fetchImpl?: typeof fetch; now?: () => Date; token?: string } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.token = options.token ?? process.env.GITHUB_TOKEN;
  }

  async execute(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    try {
      switch (step.operation) {
        case 'repo_exists': return await this.repoExists(step, repo);
        case 'file_exists': return await this.fileExists(step, repo);
        case 'file_non_empty': return await this.sourceFile(step, repo, 'file_non_empty');
        case 'source_contains': return await this.sourceFile(step, repo, 'source_contains');
        case 'source_symbol_exists': return await this.sourceFile(step, repo, 'source_symbol_exists');
        case 'source_syntax_valid': return await this.sourceFile(step, repo, 'source_syntax_valid');
        case 'license_matches': return await this.licenseMatches(step, repo);
        case 'release_exists': return await this.releaseExists(step, repo);
      }
    } catch (error) {
      const raw = { error: error instanceof Error ? error.message : String(error) };
      return {
        result: 'INCONCLUSIVE',
        message: raw.error,
        evidence: createEvidence({
          claimId: step.claimId,
          stepId: step.id,
          adapter: 'github',
          source: `github://${repo.owner}/${repo.repo}`,
          revision: null,
          raw,
          extractedFacts: {},
          result: 'INCONCLUSIVE',
        }, this.now()),
      };
    }
  }

  private headers(): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await this.fetchImpl(`https://api.github.com${path}`, {
        headers: this.headers(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async repoExists(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    const response = await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`);
    const raw = await safeJson(response);
    if (response.status === 403) return await this.repoExistsFromPublicPage(step, repo);
    const result: StepResult = response.status === 200 && isJsonObject(raw) ? 'PASS' : response.status === 404 ? 'FAIL' : 'INCONCLUSIVE';
    const revision = result === 'PASS' && raw && typeof raw === 'object' ? stringField(raw, 'default_branch') : null;
    return this.make(step, repo, result, `Repository HTTP ${response.status}`, raw, revision, { status: response.status });
  }

  private async fileExists(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    if (!step.params.path) return this.invalidStep(step, repo, 'file_exists requires params.path');
    const path = step.params.path.split('/').map(encodeURIComponent).join('/');
    const response = await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${path}`);
    const raw = await safeJson(response);
    if (response.status === 403) return await this.fileExistsFromPublicRaw(step, repo);
    const result: StepResult = response.status === 200 && isJsonObject(raw) ? 'PASS' : response.status === 404 ? 'FAIL' : 'INCONCLUSIVE';
    const sha = raw && typeof raw === 'object' ? stringField(raw, 'sha') : null;
    return this.make(step, repo, result, result === 'PASS' ? `${step.params.path} exists` : `${step.params.path} was not verified`, raw, sha, { path: step.params.path, status: response.status, sha });
  }

  private async sourceFile(step: GitHubStep, repo: GitHubRepositoryRef, operation: 'file_non_empty' | 'source_contains' | 'source_symbol_exists' | 'source_syntax_valid'): Promise<AdapterExecution> {
    if (!step.params.path) return this.invalidStep(step, repo, `${operation} requires params.path`);
    if ((operation === 'source_contains' || operation === 'source_symbol_exists') && !step.params.expected) return this.invalidStep(step, repo, `${operation} requires params.expected`);
    const source = await this.fetchSource(step.params.path, repo);
    // A missing, malformed, oversized, or upstream-error source observation
    // must not be reinterpreted as empty-but-valid source by a static check.
    if (source.result !== 'PASS') return this.make(step, repo, source.result, source.message, source.raw, source.revision, source.facts);
    const content = source.content ?? '';
    const contentHash = createHash('sha256').update(content).digest('hex');
    const baseFacts = { path: step.params.path, status: source.status, revision: source.revision, bytes: new TextEncoder().encode(content).byteLength, contentHash, executed: false };
    const raw = { status: source.status, path: step.params.path, revision: source.revision, bytes: baseFacts.bytes, contentHash };
    if (operation === 'file_non_empty') {
      const nonEmpty = content.trim().length > 0;
      return this.make(step, repo, nonEmpty ? 'PASS' : 'FAIL', nonEmpty ? `${step.params.path} is non-empty` : `${step.params.path} is empty`, raw, source.revision, { ...baseFacts, nonEmpty });
    }
    if (operation === 'source_contains') {
      const contains = content.includes(step.params.expected ?? '');
      return this.make(step, repo, contains ? 'PASS' : 'FAIL', contains ? `${step.params.path} contains the expected source text` : `${step.params.path} did not contain the expected source text`, raw, source.revision, { ...baseFacts, contains, expected: step.params.expected });
    }
    if (operation === 'source_symbol_exists') {
      const symbol = staticSymbolExists(content, step.params.expected ?? '');
      return this.make(step, repo, symbol ? 'PASS' : 'FAIL', symbol ? `Static declaration ${step.params.expected} was found` : `Static declaration ${step.params.expected} was not found`, raw, source.revision, { ...baseFacts, symbol: step.params.expected, symbolFound: symbol });
    }
    const syntaxValid = staticSyntaxValid(content);
    return this.make(step, repo, syntaxValid ? 'PASS' : 'FAIL', syntaxValid ? 'Bounded static syntax scan passed' : 'Bounded static syntax scan failed', raw, source.revision, { ...baseFacts, syntaxValid, scanner: 'bounded-static-delimiter-scan' });
  }

  private async fetchSource(pathValue: string, repo: GitHubRepositoryRef): Promise<{ content?: string; revision: string | null; status: number; error?: string; result: StepResult; message: string; raw: unknown; facts: Record<string, unknown> }> {
    const path = pathValue.split('/').map(encodeURIComponent).join('/');
    const response = await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${path}`);
    const raw = await safeJson(response);
    if (response.status === 403) {
      const snapshot = await this.publicRepositorySnapshot(repo);
      if (!snapshot) return { revision: null, status: 403, result: 'INCONCLUSIVE', message: 'GitHub source fallback did not provide a verifiable revision', raw: { status: 403, error: 'public_fallback_unverified' }, facts: { path: pathValue, error: 'public_fallback_unverified', executed: false } };
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${snapshot.revision}/${path}`;
      try {
        const fallback = await this.publicRequest(url, 'text/plain, */*');
        const body = await readBoundedText(fallback, FALLBACK_MAX_BYTES);
        if (body.tooLarge) return { revision: null, status: fallback.status, result: 'INCONCLUSIVE', message: 'GitHub source exceeded the evidence limit', raw: { status: fallback.status, error: 'response_too_large', bytes: body.bytes }, facts: { path: pathValue, status: fallback.status, error: 'response_too_large', executed: false } };
        if (fallback.status === 404) return { revision: snapshot.revision, status: 404, result: 'FAIL', message: `${pathValue} was not found`, raw: { status: 404, revision: snapshot.revision }, facts: { path: pathValue, status: 404, revision: snapshot.revision, executed: false } };
        if (fallback.status !== 200) return { revision: snapshot.revision, status: fallback.status, result: 'INCONCLUSIVE', message: `GitHub source returned HTTP ${fallback.status}`, raw: { status: fallback.status, revision: snapshot.revision }, facts: { path: pathValue, status: fallback.status, revision: snapshot.revision, executed: false } };
        return { content: body.text, revision: snapshot.revision, status: fallback.status, result: 'PASS', message: 'Source observation available', raw: { status: fallback.status, revision: snapshot.revision }, facts: { path: pathValue, status: fallback.status, revision: snapshot.revision, bytes: body.bytes, executed: false } };
      } catch {
        return { revision: null, status: 403, result: 'INCONCLUSIVE', message: 'GitHub source fallback could not be completed', raw: { status: 403, error: 'public_fallback_transport_error' }, facts: { path: pathValue, error: 'public_fallback_transport_error', executed: false } };
      }
    }
    if (response.status === 404) return { revision: null, status: 404, result: 'FAIL', message: `${pathValue} was not found`, raw: raw ?? { status: 404 }, facts: { path: pathValue, status: 404, executed: false } };
    if (response.status !== 200 || !raw || typeof raw !== 'object') return { revision: null, status: response.status, error: 'upstream_status', result: 'INCONCLUSIVE', message: `GitHub source lookup returned HTTP ${response.status}`, raw: raw ?? { status: response.status }, facts: { path: pathValue, status: response.status, executed: false } };
    const object = raw as Record<string, unknown>;
    const encoded = typeof object.content === 'string' ? object.content.replace(/\s+/g, '') : null;
    if (!encoded || object.encoding !== 'base64') return { revision: stringField(object, 'sha'), status: response.status, result: 'INCONCLUSIVE', message: 'GitHub source response did not contain bounded base64 content', raw, facts: { path: pathValue, status: response.status, error: 'missing_source_content', executed: false } };
    let content: string;
    try { content = Buffer.from(encoded, 'base64').toString('utf8'); } catch { return { revision: stringField(object, 'sha'), status: response.status, result: 'INCONCLUSIVE', message: 'GitHub source content was not valid base64', raw: { status: response.status, error: 'invalid_base64' }, facts: { path: pathValue, status: response.status, error: 'invalid_base64', executed: false } }; }
    if (new TextEncoder().encode(content).byteLength > FALLBACK_MAX_BYTES) return { revision: stringField(object, 'sha'), status: response.status, result: 'INCONCLUSIVE', message: 'GitHub source exceeded the evidence limit', raw: { status: response.status, error: 'response_too_large' }, facts: { path: pathValue, status: response.status, error: 'response_too_large', executed: false } };
    return { content, revision: stringField(object, 'sha'), status: response.status, result: 'PASS', message: 'Source observation available', raw, facts: { path: pathValue, status: response.status, revision: stringField(object, 'sha'), executed: false } };
  }

  private async repoExistsFromPublicPage(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    const snapshot = await this.publicRepositorySnapshot(repo);
    if (!snapshot) {
      return this.make(step, repo, 'INCONCLUSIVE', 'GitHub API and public repository page did not provide a verifiable observation', { status: 403, error: 'public_fallback_unverified' }, null, { status: 403, error: 'public_fallback_unverified' });
    }
    return this.make(step, repo, 'PASS', 'Public GitHub repository page verified', { status: 200, fallback: 'public_page', public: true, defaultBranch: snapshot.defaultBranch }, snapshot.revision, { status: 200, fallback: 'public_page', public: true, defaultBranch: snapshot.defaultBranch });
  }

  private async fileExistsFromPublicRaw(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    const snapshot = await this.publicRepositorySnapshot(repo);
    if (!snapshot || !step.params.path) {
      return this.make(step, repo, 'INCONCLUSIVE', 'GitHub API and public repository page did not provide a verifiable revision', { status: 403, error: 'public_fallback_unverified' }, null, { path: step.params.path, status: 403, error: 'public_fallback_unverified' });
    }
    const path = step.params.path.split('/').map(encodeURIComponent).join('/');
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${snapshot.revision}/${path}`;
    let response: Response;
    try {
      response = await this.publicRequest(url, '*/*');
    } catch {
      return this.make(step, repo, 'INCONCLUSIVE', 'GitHub raw file fallback could not be completed', { error: 'public_fallback_transport_error' }, null, { path: step.params.path, error: 'public_fallback_transport_error' });
    }
    const body = await readBoundedText(response, FALLBACK_MAX_BYTES);
    if (body.tooLarge) {
      return this.make(step, repo, 'INCONCLUSIVE', 'GitHub raw file fallback exceeded the evidence limit', { status: response.status, error: 'response_too_large', bytes: body.bytes }, null, { path: step.params.path, status: response.status, error: 'response_too_large' });
    }
    const contentHash = createHash('sha256').update(body.text).digest('hex');
    const result: StepResult = response.status === 200 ? 'PASS' : response.status === 404 ? 'FAIL' : 'INCONCLUSIVE';
    return this.make(step, repo, result, result === 'PASS' ? `${step.params.path} exists` : `${step.params.path} was not verified`, { status: response.status, fallback: 'raw_file', path: step.params.path, revision: snapshot.revision, bytes: body.bytes, contentHash }, snapshot.revision, { path: step.params.path, status: response.status, revision: snapshot.revision, bytes: body.bytes, contentHash, fallback: 'raw_file' });
  }

  private async publicRepositorySnapshot(repo: GitHubRepositoryRef): Promise<{ revision: string; defaultBranch: string } | null> {
    const url = `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    let response: Response;
    try {
      response = await this.publicRequest(url, 'application/json, text/html;q=0.9');
    } catch {
      return null;
    }
    if (response.status !== 200) return null;
    const body = await readBoundedText(response, FALLBACK_MAX_BYTES);
    if (body.tooLarge) return null;
    const expectedTitle = `GitHub - ${repo.owner}/${repo.repo}`;
    if (!body.text.includes(expectedTitle) || !/\"public\"\s*:\s*true/.test(body.text)) return null;
    const revision = body.text.match(/\"currentOid\"\s*:\s*\"([0-9a-f]{40})\"/i)?.[1] ?? null;
    const defaultBranch = body.text.match(/\"defaultBranch\"\s*:\s*\"([^\"]+)\"/)?.[1] ?? null;
    if (!revision || !defaultBranch) return null;
    return { revision, defaultBranch };
  }

  private async publicRequest(url: string, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      return await this.fetchImpl(url, { headers: { Accept: accept, 'User-Agent': USER_AGENT }, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async licenseMatches(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    if (!step.params.expected) return this.invalidStep(step, repo, 'license_matches requires params.expected');
    const response = await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/license`);
    const raw = await safeJson(response);
    if (response.status === 404) {
      return this.make(step, repo, 'FAIL', 'No repository license was found', raw, null, { expected: step.params.expected, actual: null });
    }
    if (response.status !== 200 || !isJsonObject(raw)) {
      return this.make(step, repo, 'INCONCLUSIVE', `GitHub license lookup returned HTTP ${response.status}`, raw, null, { expected: step.params.expected });
    }
    const license = (raw as Record<string, unknown>).license;
    const spdx = license && typeof license === 'object' ? stringField(license, 'spdx_id') : null;
    const name = license && typeof license === 'object' ? stringField(license, 'name') : null;
    const expected = normalizeLicense(step.params.expected);
    const actualCandidates = [spdx, name].filter((v): v is string => Boolean(v)).map(normalizeLicense);
    const matches = actualCandidates.includes(expected) || actualCandidates.some((candidate) => candidate.includes(expected) || expected.includes(candidate));
    const result: StepResult = matches ? 'PASS' : 'FAIL';
    return this.make(step, repo, result, matches ? `License matches ${step.params.expected}` : `Expected ${step.params.expected}; GitHub reports ${spdx ?? name ?? 'unknown'}`, raw, stringField(raw, 'sha'), { expected: step.params.expected, spdx, name });
  }

  private async releaseExists(step: GitHubStep, repo: GitHubRepositoryRef): Promise<AdapterExecution> {
    if (!step.params.expected) return this.invalidStep(step, repo, 'release_exists requires params.expected');
    const tag = encodeURIComponent(step.params.expected);
    const response = await this.request(`/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/tags/${tag}`);
    const raw = await safeJson(response);
    const result: StepResult = response.status === 200 && isJsonObject(raw) ? 'PASS' : response.status === 404 ? 'FAIL' : 'INCONCLUSIVE';
    const target = raw && typeof raw === 'object' ? stringField(raw, 'target_commitish') : null;
    return this.make(step, repo, result, result === 'PASS' ? `Release ${step.params.expected} exists` : `Release ${step.params.expected} was not verified`, raw, target, { tag: step.params.expected, status: response.status });
  }

  private invalidStep(step: GitHubStep, repo: GitHubRepositoryRef, message: string): AdapterExecution {
    return this.make(step, repo, 'INCONCLUSIVE', message, { error: message }, null, {});
  }

  private make(step: GitHubStep, repo: GitHubRepositoryRef, result: StepResult, message: string, raw: unknown, revision: string | null, extractedFacts: Record<string, unknown>): AdapterExecution {
    return {
      result,
      message,
      evidence: createEvidence({
        claimId: step.claimId,
        stepId: step.id,
        adapter: 'github',
        source: `https://github.com/${repo.owner}/${repo.repo}`,
        revision,
        raw,
        extractedFacts,
        result,
      }, this.now()),
    };
  }
}

function stringField(value: object, key: string): string | null {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !('body' in value) && !('error' in value));
}

function normalizeLicense(value: string): string {
  return value.trim().toLowerCase().replace(/license/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function safeJson(response: Response): Promise<unknown> {
  const body = await readBoundedText(response, FALLBACK_MAX_BYTES);
  if (body.tooLarge) return { error: 'response_too_large', bytes: body.bytes };
  const text = body.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { body: text.slice(0, 20_000) }; }
}

function staticSymbolExists(source: string, symbol: string): boolean {
  if (!symbol || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) return false;
  const clean = stripCommentsAndStrings(source);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+|function\\s+|class\\s+|contract\\s+|(?:module\\.)?exports\\s*\\.\\s*)${escaped}\\b`).test(clean);
}

function staticSyntaxValid(source: string): boolean {
  const stack: string[] = [];
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) { if (character === '\n') lineComment = false; continue; }
    if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) { if (character === '\\') { index += 1; continue; } if (character === quote) quote = null; continue; }
    if (character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (character === '#' && (index === 0 || /\s/.test(source[index - 1] ?? ''))) { lineComment = true; continue; }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{' || character === '(' || character === '[') stack.push(character);
    if (character === '}' || character === ')' || character === ']') {
      const opening = stack.pop();
      if ((character === '}' && opening !== '{') || (character === ')' && opening !== '(') || (character === ']' && opening !== '[')) return false;
    }
  }
  return !quote && !lineComment && !blockComment && stack.length === 0;
}

function stripCommentsAndStrings(source: string): string {
  let result = '';
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) { result += character === '\n' ? '\n' : ' '; if (character === '\n') lineComment = false; continue; }
    if (blockComment) { result += character === '\n' ? '\n' : ' '; if (character === '*' && next === '/') { result += ' '; blockComment = false; index += 1; } continue; }
    if (quote) { result += character === '\n' ? '\n' : ' '; if (character === '\\') { result += ' '; index += 1; continue; } if (character === quote) quote = null; continue; }
    if (character === '/' && next === '/') { result += '  '; lineComment = true; index += 1; continue; }
    if (character === '/' && next === '*') { result += '  '; blockComment = true; index += 1; continue; }
    if (character === '#' && (index === 0 || /\s/.test(source[index - 1] ?? ''))) { result += ' '; lineComment = true; continue; }
    if (character === '"' || character === "'" || character === '`') { result += ' '; quote = character; continue; }
    result += character;
  }
  return result;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; bytes: number; tooLarge: boolean }> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    return { text: bytes > maxBytes ? text.slice(0, maxBytes) : text, bytes, tooLarge: bytes > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (bytes + value.byteLength > maxBytes) {
        await reader.cancel();
        return { text: '', bytes: bytes + value.byteLength, tooLarge: true };
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder().decode(joined), bytes, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}
