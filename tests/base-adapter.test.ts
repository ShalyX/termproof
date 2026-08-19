import test from 'node:test';
import assert from 'node:assert/strict';
import { BaseAdapter } from '../src/adapters/base.ts';

test('Base chain verification returns PASS with JSON-RPC evidence', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers && new Headers(init.headers).get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(init?.body)), { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2105' }), { status: 200 });
    },
    now: () => new Date('2026-08-15T00:00:00Z'),
  });

  const result = await adapter.execute({
    id: 'base-step-chain',
    claimId: 'base-claim-chain',
    adapter: 'base',
    operation: 'chain_id_matches',
    params: { network: 'base', address: null, expected: null },
  });

  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.adapter, 'base');
  assert.equal(result.evidence.extractedFacts.chainId, '0x2105');
  assert.match(result.evidence.rawHash, /^[a-f0-9]{64}$/);
});

test('Base verifier treats an oversized RPC response as INCONCLUSIVE', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    maxResponseBytes: 64,
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${'ab'.repeat(100)}` }), { status: 200 }),
  });

  const result = await adapter.execute({
    id: 'base-step-large',
    claimId: 'base-claim-large',
    adapter: 'base',
    operation: 'contract_deployed',
    params: { network: 'base', address: '0x4200000000000000000000000000000000000006', expected: null },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'response_too_large');
});

test('Base contract verification passes only when eth_getCode returns deployed bytecode', async () => {
  const address = '0x4200000000000000000000000000000000000006';
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x60006000' }), { status: 200 });
    },
  });

  const result = await adapter.execute({
    id: 'base-step-code',
    claimId: 'base-claim-code',
    adapter: 'base',
    operation: 'contract_deployed',
    params: { network: 'base', address, expected: null },
  });

  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.extractedFacts.deployed, true);
  assert.equal(result.evidence.extractedFacts.address, address);
});

test('Base RPC outage is INCONCLUSIVE rather than a contract FAIL', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async () => new Response('gateway unavailable', { status: 503 }),
  });

  const result = await adapter.execute({
    id: 'base-step-outage',
    claimId: 'base-claim-outage',
    adapter: 'base',
    operation: 'contract_deployed',
    params: { network: 'base', address: '0x4200000000000000000000000000000000000006', expected: null },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'upstream_status');
});

test('Base verifier rejects malformed contract addresses without an RPC call', async () => {
  let calls = 0;
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  const result = await adapter.execute({
    id: 'base-step-invalid-address',
    claimId: 'base-claim-invalid-address',
    adapter: 'base',
    operation: 'contract_deployed',
    params: { network: 'base', address: '0x1234', expected: null },
  });

  assert.equal(result.result, 'INCONCLUSIVE');
  assert.equal(result.evidence.extractedFacts.error, 'invalid_address');
  assert.equal(calls, 0);
});

test('Base chain mismatch is a deterministic FAIL', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x14a34' }), { status: 200 }),
  });
  const result = await adapter.execute({
    id: 'base-step-wrong-chain',
    claimId: 'base-claim-wrong-chain',
    adapter: 'base',
    operation: 'chain_id_matches',
    params: { network: 'base', address: null, expected: null },
  });

  assert.equal(result.result, 'FAIL');
  assert.equal(result.evidence.extractedFacts.chainId, '0x14a34');
});

test('Base empty bytecode is a deterministic FAIL, not infrastructure uncertainty', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { base: 'https://base.example/rpc' },
    fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }), { status: 200 }),
  });
  const result = await adapter.execute({
    id: 'base-step-empty-code',
    claimId: 'base-claim-empty-code',
    adapter: 'base',
    operation: 'contract_deployed',
    params: { network: 'base', address: '0x4200000000000000000000000000000000000006', expected: null },
  });

  assert.equal(result.result, 'FAIL');
  assert.equal(result.evidence.extractedFacts.deployed, false);
});
