import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter, parseGitHubRepository } from '../src/adapters/github.ts';

test('parseGitHubRepository accepts canonical public repo URLs', () => {
  assert.deepEqual(parseGitHubRepository('https://github.com/openai/openai-node'), { owner: 'openai', repo: 'openai-node' });
});

test('parseGitHubRepository rejects lookalike hosts', () => {
  assert.throws(() => parseGitHubRepository('https://github.com.evil.example/openai/openai-node'));
});

test('license mismatch is a deterministic FAIL', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
    sha: 'abc123'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const adapter = new GitHubAdapter({ fetchImpl: fakeFetch, now: () => new Date('2026-08-15T00:00:00Z') });
  const result = await adapter.execute({
    id: 's1', claimId: 'c1', adapter: 'github', operation: 'license_matches',
    params: { path: null, expected: 'MIT' }
  }, { owner: 'openai', repo: 'openai-node' });
  assert.equal(result.result, 'FAIL');
  assert.match(result.message, /Apache-2.0/i);
});

test('malformed successful GitHub JSON is INCONCLUSIVE, never PASS', async () => {
  const adapter = new GitHubAdapter({ fetchImpl: async () => new Response('{not-json', { status: 200 }) });
  const result = await adapter.execute({ id: 's-malformed', claimId: 'c-malformed', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } }, { owner: 'acme', repo: 'project' });
  assert.equal(result.result, 'INCONCLUSIVE');
});

test('public GitHub API rate limiting falls back to the canonical public page and raw file source', async () => {
  const revision = 'a'.repeat(40);
  const page = JSON.stringify({ meta: { title: 'GitHub - acme/project' }, codeViewLayoutRoute: { repo: { defaultBranch: 'main', public: true } }, refInfo: { currentOid: revision } });
  const calls: string[] = [];
  const adapter = new GitHubAdapter({
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.github.com/')) return new Response('rate limited', { status: 403 });
      if (url === 'https://github.com/acme/project') return new Response(page, { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === `https://raw.githubusercontent.com/acme/project/${revision}/package.json`) return new Response('{"name":"project"}', { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const repo = await adapter.execute({ id: 's-fallback-repo', claimId: 'c-fallback-repo', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } }, { owner: 'acme', repo: 'project' });
  const file = await adapter.execute({ id: 's-fallback-file', claimId: 'c-fallback-file', adapter: 'github', operation: 'file_exists', params: { path: 'package.json', expected: null } }, { owner: 'acme', repo: 'project' });

  assert.equal(repo.result, 'PASS');
  assert.equal(repo.evidence.revision, revision);
  assert.equal(file.result, 'PASS');
  assert.equal(file.evidence.revision, revision);
  assert.equal(calls.filter((url) => url.startsWith('https://api.github.com/')).length, 2);
  assert.equal(calls.includes(`https://raw.githubusercontent.com/acme/project/${revision}/package.json`), true);
});

test('GitHub public fallback never promotes an unverified page to PASS', async () => {
  const adapter = new GitHubAdapter({
    fetchImpl: async (input) => String(input).startsWith('https://api.github.com/')
      ? new Response('rate limited', { status: 403 })
      : new Response(JSON.stringify({ meta: { title: 'GitHub - acme/other' } }), { status: 200 }),
  });
  const result = await adapter.execute({ id: 's-fallback-malformed', claimId: 'c-fallback-malformed', adapter: 'github', operation: 'repo_exists', params: { path: null, expected: null } }, { owner: 'acme', repo: 'project' });
  assert.equal(result.result, 'INCONCLUSIVE');
});
