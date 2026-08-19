import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubAdapter } from '../src/adapters/github.ts';
import { BaseAdapter } from '../src/adapters/base.ts';
import { EVM_CHAIN_PROFILES, getEvmChainProfile } from '../src/core/evm-profiles.ts';

test('bounded source verification inspects data without executing repository code', async () => {
  const adapter = new GitHubAdapter({
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes('/contents/worker.js')) {
        return new Response(JSON.stringify({
          sha: 'source-sha',
          content: Buffer.from('export function startWorker() { return true; }').toString('base64'),
          encoding: 'base64',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    },
  });

  const result = await adapter.execute({
    id: 'source-symbol',
    claimId: 'source-claim',
    adapter: 'github',
    operation: 'source_symbol_exists',
    params: { path: 'worker.js', expected: 'startWorker' },
  }, { owner: 'acme', repo: 'worker' });

  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.extractedFacts.executed, false);
  assert.equal(result.evidence.extractedFacts.symbol, 'startWorker');
});

test('malformed static source cannot establish structural implementation', async () => {
  const adapter = new GitHubAdapter({
    fetchImpl: async () => new Response(JSON.stringify({
      sha: 'bad-sha',
      content: Buffer.from('export function startWorker( {').toString('base64'),
      encoding: 'base64',
    }), { status: 200 }),
  });

  const result = await adapter.execute({
    id: 'source-syntax',
    claimId: 'source-claim',
    adapter: 'github',
    operation: 'source_syntax_valid',
    params: { path: 'worker.js', expected: null },
  }, { owner: 'acme', repo: 'worker' });

  assert.equal(result.result, 'FAIL');
  assert.equal(result.evidence.extractedFacts.executed, false);
});

test('comments, gibberish, and oversized source remain data and cannot prove a symbol', async () => {
  const sources = [
    '// startWorker()\n/* no implementation */',
    'not valid source \u0000 \u0001',
    'x'.repeat(600_000),
  ];
  for (const [index, source] of sources.entries()) {
    const adapter = new GitHubAdapter({
      fetchImpl: async () => new Response(JSON.stringify({ sha: `sha-${index}`, content: Buffer.from(source).toString('base64'), encoding: 'base64' }), { status: 200 }),
    });
    const result = await adapter.execute({
      id: `source-symbol-${index}`,
      claimId: 'source-claim',
      adapter: 'github',
      operation: 'source_symbol_exists',
      params: { path: 'worker.js', expected: 'startWorker' },
    }, { owner: 'acme', repo: 'worker' });
    assert.notEqual(result.result, 'PASS');
    assert.equal(result.evidence.extractedFacts.executed, false);
  }
});

test('missing or unavailable source cannot pass a static syntax check', async () => {
  for (const response of [
    new Response('{}', { status: 404 }),
    new Response('upstream unavailable', { status: 503 }),
    new Response(JSON.stringify({ sha: 'malformed-source', content: 'not-base64', encoding: 'utf-8' }), { status: 200 }),
  ]) {
    const adapter = new GitHubAdapter({ fetchImpl: async () => response.clone() });
    const result = await adapter.execute({
      id: 'source-syntax-unavailable',
      claimId: 'source-claim',
      adapter: 'github',
      operation: 'source_syntax_valid',
      params: { path: 'worker.js', expected: null },
    }, { owner: 'acme', repo: 'worker' });
    assert.notEqual(result.result, 'PASS');
    assert.equal(result.evidence.extractedFacts.executed, false);
  }
});

test('EVM profiles are allowlisted and chain identity remains deterministic', async () => {
  assert.equal(EVM_CHAIN_PROFILES.base.chainId, '0x2105');
  assert.equal(getEvmChainProfile('base-sepolia').chainId, '0x14a34');
  assert.throws(() => getEvmChainProfile('ethereum' as never), /allowlisted|unsupported/i);

  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x2105' }), { status: 200 }),
  });
  const result = await adapter.execute({
    id: 'chain-id-spoof',
    claimId: 'chain-claim',
    adapter: 'base',
    operation: 'chain_id_matches',
    params: { network: 'base', address: null, expected: null },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
});
