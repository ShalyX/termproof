import assert from 'node:assert/strict';
import test from 'node:test';
import { BaseAdapter } from '../src/adapters/base.ts';
import { getCapabilityForStep, getProofObligationForAssertion, validateProofRoute } from '../src/core/capabilities.ts';
import { EVM_CHAIN_PROFILES, getEvmChainProfile } from '../src/core/evm-profiles.ts';
import { parseCanonicalPlannerOutput } from '../src/agent/canonical-planner.ts';
import type { AcceptanceTerm, BaseStep, PlannedClaim } from '../src/core/types.ts';

const ARC_USDC = '0x3600000000000000000000000000000000000000';
const TX_HASH = `0x${'a'.repeat(64)}`;
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function arcStep(operation: string, expected: string | null, claimId = 'arc-claim'): BaseStep {
  return {
    id: `arc-${operation}`,
    claimId,
    adapter: 'base',
    operation: operation as BaseStep['operation'],
    params: { network: 'arc-testnet' as never, address: TX_HASH, expected },
  };
}

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
}

test('Arc resolves through the chain profile and generic EVM capability registry', () => {
  const profile = getEvmChainProfile('arc-testnet');
  assert.equal(profile.chainId, '0x4cef52');
  assert.equal(profile.defaultRpcUrl, 'https://rpc.testnet.arc.network');
  assert.equal(profile.explorerUrl, 'https://testnet.arcscan.app');
  assert.equal(profile.usdcErc20Address, ARC_USDC);
  assert.equal(profile.cctpDomain, 26);
  const obligation = getProofObligationForAssertion('Arc Testnet transaction sender and destination satisfy the required transfer.');
  assert.equal(obligation.requiredChainProfile, 'arc-testnet');
  assert.equal(getCapabilityForStep({ adapter: 'base', operation: 'transaction_from_matches' } as never), 'evm.transaction');
  assert.equal(getCapabilityForStep({ adapter: 'base', operation: 'token_transfer_matches' } as never), 'evm.token_transfer');
  assert.equal(Object.keys(EVM_CHAIN_PROFILES).includes('arc-testnet'), true);
});

test('Arc RPC chain mismatch is a deterministic closed failure', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { 'arc-testnet': 'https://rpc.testnet.arc.network' } as never,
    fetchImpl: async () => rpcResponse('0x2105'),
  });
  const result = await adapter.execute({
    id: 'arc-chain-mismatch',
    claimId: 'arc-claim',
    adapter: 'base',
    operation: 'chain_id_matches',
    params: { network: 'arc-testnet' as never, address: null, expected: '5042002' },
  });
  assert.equal(result.result, 'FAIL');
});

test('Arc transaction sender and destination assertions use generic EVM RPC operations', async () => {
  const methods: string[] = [];
  const adapter = new BaseAdapter({
    rpcUrls: { 'arc-testnet': 'https://rpc.testnet.arc.network' } as never,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      methods.push(body.method);
      return rpcResponse({ hash: TX_HASH, from: SENDER, to: RECIPIENT, input: '0x', value: '0x0' });
    },
  });
  const sender = await adapter.execute(arcStep('transaction_from_matches', SENDER));
  const destination = await adapter.execute(arcStep('transaction_to_matches', RECIPIENT));
  assert.equal(sender.result, 'PASS');
  assert.equal(destination.result, 'PASS');
  assert.deepEqual(methods, ['eth_getTransactionByHash', 'eth_getTransactionByHash']);
});

test('Arc receipt success and event matching remain generic transaction-receipt operations', async () => {
  const adapter = new BaseAdapter({
    rpcUrls: { 'arc-testnet': 'https://rpc.testnet.arc.network' } as never,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'eth_getTransactionReceipt') return rpcResponse({ transactionHash: TX_HASH, status: '0x1', logs: [{ address: ARC_USDC, topics: [TRANSFER_TOPIC], data: '0x' }] });
      return rpcResponse(null);
    },
  });
  const receipt = await adapter.execute(arcStep('receipt_status', '0x1'));
  const event = await adapter.execute(arcStep('event_matches', `address=${ARC_USDC};topic0=${TRANSFER_TOPIC}`));
  assert.equal(receipt.result, 'PASS');
  assert.equal(event.result, 'PASS');
});

test('Arc USDC Transfer decoding compares token, recipient, and exact amount', async () => {
  const amount = 1_250_000n;
  const padded = (value: string) => `0x${value.slice(2).padStart(64, '0')}`;
  const adapter = new BaseAdapter({
    rpcUrls: { 'arc-testnet': 'https://rpc.testnet.arc.network' } as never,
    fetchImpl: async () => rpcResponse({
      transactionHash: TX_HASH,
      status: '0x1',
      logs: [{ address: ARC_USDC, topics: [TRANSFER_TOPIC, padded(SENDER), padded(RECIPIENT)], data: `0x${amount.toString(16).padStart(64, '0')}` }],
    }),
  });
  const result = await adapter.execute(arcStep('token_transfer_matches', `token=${ARC_USDC};recipient=${RECIPIENT};amount=${amount}`));
  assert.equal(result.result, 'PASS');
  assert.equal(result.evidence.extractedFacts.token, ARC_USDC);
  assert.equal(result.evidence.extractedFacts.recipient, RECIPIENT);
  assert.equal(result.evidence.extractedFacts.amount, amount.toString());
});

test('unsupported chains remain unsupported while Base and Base Sepolia profiles stay unchanged', () => {
  assert.throws(() => getEvmChainProfile('ethereum' as never), /unsupported|allowlisted/i);
  const obligation = getProofObligationForAssertion('Ethereum transaction exists.');
  const term = { proofObligation: obligation } as Pick<AcceptanceTerm, 'proofObligation'>;
  const route = validateProofRoute(term, [
    { ...arcStep('transaction_exists', null), params: { network: 'base' as never, address: TX_HASH, expected: null } },
  ]);
  assert.equal(route.ok, false);
  assert.equal(route.disposition, 'UNSUPPORTED');
  assert.equal(getEvmChainProfile('base').chainId, '0x2105');
  assert.equal(getEvmChainProfile('base-sepolia').chainId, '0x14a34');
});

test('canonical planning accepts Arc generic EVM operations without sponsor-specific vocabulary', () => {
  const term: AcceptanceTerm = {
    id: 'term-arc-transfer',
    text: 'Arc Testnet transaction succeeds',
    assertion: 'arc testnet transaction succeeds',
    sourceText: 'Arc Testnet transaction succeeds',
    sourceSpan: { start: 0, end: 34 },
    required: true,
    testability: 'OBJECTIVE',
    proofObligation: getProofObligationForAssertion('Arc Testnet transaction succeeds'),
  };
  const claim: PlannedClaim = {
    id: 'arc-transfer-claim',
    acceptanceTermIds: [term.id],
    statement: term.text,
    required: true,
    testability: 'OBJECTIVE',
    steps: [arcStep('transaction_exists', null, 'arc-transfer-claim')],
  };
  const plan = parseCanonicalPlannerOutput({
    acceptanceTerms: [{ id: term.id, disposition: 'PLANNED', reason: null }],
    claims: [claim],
    missingEvidence: [],
  }, [term]);
  assert.equal(plan.claims[0]?.steps[0]?.operation, 'transaction_exists');
});
