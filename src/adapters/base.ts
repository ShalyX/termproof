import { createEvidence } from '../core/evidence.ts';
import type { AdapterExecution, BaseNetwork, BaseStep, EvidenceRecord, StepResult } from '../core/types.ts';
import { EVM_CHAIN_PROFILES, getEvmChainProfile } from '../core/evm-profiles.ts';

export class BaseAdapter {
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;
  private maxResponseBytes: number;
  private rpcUrls: Record<BaseNetwork, string>;

  constructor(options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    timeoutMs?: number;
    maxResponseBytes?: number;
    rpcUrls?: Partial<Record<BaseNetwork, string>>;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 128 * 1024;
    this.rpcUrls = Object.fromEntries(Object.values(EVM_CHAIN_PROFILES).map((profile) => [
      profile.key,
      options.rpcUrls?.[profile.key] ?? process.env[profile.rpcEnvironmentVariable] ?? profile.defaultRpcUrl,
    ])) as Record<BaseNetwork, string>;
  }

  async execute(step: BaseStep): Promise<AdapterExecution> {
    if (step.operation === 'chain_id_matches') return this.verifyChain(step);
    if (step.operation === 'contract_deployed' || step.operation === 'contract_code_exists') return this.verifyContract(step);
    if (step.operation === 'transaction_exists') return this.verifyTransaction(step);
    if (step.operation === 'receipt_status' || step.operation === 'receipt_status_matches') return this.verifyReceiptStatus(step);
    if (step.operation === 'transaction_from_matches') return this.verifyTransactionField(step, 'from');
    if (step.operation === 'transaction_to_matches') return this.verifyTransactionField(step, 'to');
    if (step.operation === 'event_matches') return this.verifyEvent(step);
    if (step.operation === 'token_transfer_matches') return this.verifyTokenTransfer(step);
    return this.invalidStep(step, 'Unsupported EVM operation');
  }

  private async verifyChain(step: BaseStep): Promise<AdapterExecution> {
    const response = await this.rpc(step, 'eth_chainId', []);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (typeof response.result !== 'string') return this.inconclusive(step, response.raw, 'Base RPC returned an invalid chain id');
    const expected = getEvmChainProfile(step.params.network).chainId;
    const result: StepResult = response.result.toLowerCase() === expected ? 'PASS' : 'FAIL';
    return this.make(step, result, result === 'PASS' ? `Connected to ${step.params.network}` : `Expected ${expected}; RPC reported ${response.result}`, response.raw, response.result, { chainFamily: 'evm', chainProfile: step.params.network, chainId: response.result, expectedChainId: expected });
  }

  private async verifyContract(step: BaseStep): Promise<AdapterExecution> {
    if (!step.params.address || !/^0x[a-f0-9]{40}$/i.test(step.params.address)) {
      return this.inconclusive(step, { error: 'invalid_address' }, 'Base contract address is invalid');
    }
    const response = await this.rpc(step, 'eth_getCode', [step.params.address, 'latest']);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (typeof response.result !== 'string' || !/^0x[0-9a-f]*$/i.test(response.result)) {
      return this.inconclusive(step, response.raw, 'Base RPC returned invalid contract code');
    }
    const deployed = response.result !== '0x' && response.result !== '0x0';
    const result: StepResult = deployed ? 'PASS' : 'FAIL';
    return this.make(step, result, deployed ? `Contract ${step.params.address} is deployed` : `No contract code at ${step.params.address}`, response.raw, response.result, { address: step.params.address, deployed, codeLength: response.result.length });
  }

  private async verifyTransaction(step: BaseStep): Promise<AdapterExecution> {
    if (!isTransactionHash(step.params.address)) return this.inconclusive(step, { error: 'invalid_transaction_hash' }, 'EVM transaction hash is invalid');
    const response = await this.rpc(step, 'eth_getTransactionByHash', [step.params.address]);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (response.result === null) return this.make(step, 'FAIL', `Transaction ${step.params.address} was not found`, response.raw, null, { transactionHash: step.params.address, found: false });
    const transaction = asRecord(response.result);
    if (!transaction || !isTransactionHash(transaction.hash)) return this.inconclusive(step, response.raw, 'EVM RPC returned an invalid transaction');
    return this.make(step, 'PASS', `Transaction ${step.params.address} was found`, response.raw, transaction.hash, {
      transactionHash: transaction.hash,
      found: true,
      from: typeof transaction.from === 'string' ? transaction.from : null,
      to: typeof transaction.to === 'string' ? transaction.to : null,
    });
  }

  private async verifyReceiptStatus(step: BaseStep): Promise<AdapterExecution> {
    if (!isTransactionHash(step.params.address)) return this.inconclusive(step, { error: 'invalid_transaction_hash' }, 'EVM transaction hash is invalid');
    const expectedStatus = normalizeReceiptStatus(step.params.expected);
    if (!expectedStatus) return this.inconclusive(step, { error: 'invalid_expected_status' }, 'EVM receipt status expectation is invalid');
    const response = await this.rpc(step, 'eth_getTransactionReceipt', [step.params.address]);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (response.result === null) return this.make(step, 'FAIL', `Receipt for ${step.params.address} was not found`, response.raw, null, { transactionHash: step.params.address, found: false, expectedStatus });
    const receipt = asRecord(response.result);
    if (!receipt || typeof receipt.status !== 'string' || !/^0x[01]$/i.test(receipt.status)) return this.inconclusive(step, response.raw, 'EVM RPC returned an invalid transaction receipt');
    const observedStatus = receipt.status.toLowerCase();
    const result: StepResult = observedStatus === expectedStatus ? 'PASS' : 'FAIL';
    return this.make(step, result, result === 'PASS' ? `Receipt status is ${observedStatus}` : `Expected receipt status ${expectedStatus}; observed ${observedStatus}`, response.raw, revisionFrom(receipt), {
      transactionHash: step.params.address,
      found: true,
      expectedStatus,
      observedStatus,
    });
  }

  private async verifyTransactionField(step: BaseStep, field: 'from' | 'to'): Promise<AdapterExecution> {
    if (!isTransactionHash(step.params.address)) return this.inconclusive(step, { error: 'invalid_transaction_hash' }, 'EVM transaction hash is invalid');
    if (!isAddress(step.params.expected)) return this.inconclusive(step, { error: 'invalid_expected_address' }, 'EVM transaction address expectation is invalid');
    const response = await this.rpc(step, 'eth_getTransactionByHash', [step.params.address]);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (response.result === null) return this.make(step, 'FAIL', `Transaction ${step.params.address} was not found`, response.raw, null, { transactionHash: step.params.address, found: false, field });
    const transaction = asRecord(response.result);
    if (!transaction || !isTransactionHash(transaction.hash) || !isAddress(transaction[field])) return this.inconclusive(step, response.raw, `EVM RPC returned an invalid transaction ${field} field`);
    const observed = String(transaction[field]).toLowerCase();
    const expected = String(step.params.expected).toLowerCase();
    const result: StepResult = observed === expected ? 'PASS' : 'FAIL';
    return this.make(step, result, result === 'PASS' ? `Transaction ${field} matches ${expected}` : `Expected ${field} ${expected}; observed ${observed}`, response.raw, transaction.hash, {
      transactionHash: transaction.hash,
      field,
      expected,
      observed,
    });
  }

  private async verifyEvent(step: BaseStep): Promise<AdapterExecution> {
    if (!isTransactionHash(step.params.address)) return this.inconclusive(step, { error: 'invalid_transaction_hash' }, 'EVM transaction hash is invalid');
    const expectation = parseEventExpectation(step.params.expected);
    if (!expectation) return this.inconclusive(step, { error: 'invalid_event_expectation' }, 'EVM event expectation is invalid');
    const response = await this.rpc(step, 'eth_getTransactionReceipt', [step.params.address]);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (response.result === null) return this.make(step, 'FAIL', `Receipt for ${step.params.address} was not found`, response.raw, null, { transactionHash: step.params.address, found: false, ...expectation });
    const receipt = asRecord(response.result);
    if (!receipt || !Array.isArray(receipt.logs)) return this.inconclusive(step, response.raw, 'EVM RPC returned a receipt without valid logs');
    const logs = parseLogs(receipt.logs);
    if (!logs) return this.inconclusive(step, response.raw, 'EVM RPC returned malformed receipt logs');
    const matched = logs.some((log) => matchesEvent(log, expectation));
    const result: StepResult = matched ? 'PASS' : 'FAIL';
    return this.make(step, result, matched ? 'Receipt contains the expected event' : 'Receipt does not contain the expected event', response.raw, revisionFrom(receipt), {
      transactionHash: step.params.address,
      ...expectation,
      matched,
      logCount: logs.length,
    });
  }

  private async verifyTokenTransfer(step: BaseStep): Promise<AdapterExecution> {
    if (!isTransactionHash(step.params.address)) return this.inconclusive(step, { error: 'invalid_transaction_hash' }, 'EVM transaction hash is invalid');
    const expectation = parseTokenTransferExpectation(step.params.expected);
    if (!expectation) return this.inconclusive(step, { error: 'invalid_token_transfer_expectation' }, 'EVM token transfer expectation is invalid');
    const response = await this.rpc(step, 'eth_getTransactionReceipt', [step.params.address]);
    if (!response.ok) return this.inconclusive(step, response.raw, response.error);
    if (response.result === null) return this.make(step, 'FAIL', `Receipt for ${step.params.address} was not found`, response.raw, null, { transactionHash: step.params.address, found: false, ...expectation });
    const receipt = asRecord(response.result);
    if (!receipt || !Array.isArray(receipt.logs)) return this.inconclusive(step, response.raw, 'EVM RPC returned a receipt without valid logs');
    const logs = parseLogs(receipt.logs);
    if (!logs) return this.inconclusive(step, response.raw, 'EVM RPC returned malformed receipt logs');
    for (const log of logs) {
      if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      if (log.topics.length < 3 || !isAddressFromTopic(log.topics[2]) || !/^0x[0-9a-f]{64}$/i.test(log.data)) return this.inconclusive(step, response.raw, 'EVM Transfer log has malformed topics or amount data');
      const recipient = topicAddress(log.topics[2]);
      const amount = BigInt(log.data);
      if (log.address.toLowerCase() === expectation.token && recipient === expectation.recipient && amount === expectation.amount) {
        return this.make(step, 'PASS', 'Receipt contains the expected ERC-20 Transfer', response.raw, revisionFrom(receipt), {
          transactionHash: step.params.address,
          token: expectation.token,
          recipient,
          amount: amount.toString(),
          transferTopic: TRANSFER_TOPIC,
          matched: true,
        });
      }
    }
    return this.make(step, 'FAIL', 'Receipt does not contain the expected ERC-20 Transfer', response.raw, revisionFrom(receipt), {
      transactionHash: step.params.address,
      token: expectation.token,
      recipient: expectation.recipient,
      amount: expectation.amount.toString(),
      transferTopic: TRANSFER_TOPIC,
      matched: false,
    });
  }

  private async rpc(step: BaseStep, method: string, params: unknown[]): Promise<{ ok: boolean; result?: unknown; raw: unknown; error: string }> {
    const url = this.rpcUrls[step.params.network];
    if (!url || !isSafePublicUrl(url)) return { ok: false, raw: { error: 'invalid_rpc_url' }, error: 'Base RPC endpoint is not allowed' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const body = await readLimitedText(response, this.maxResponseBytes);
      if (body.tooLarge) return { ok: false, raw: { status: response.status, error: 'response_too_large', bytes: body.bytes }, error: 'Base RPC response exceeded the evidence limit' };
      const text = body.text;
      if (response.status !== 200) return { ok: false, raw: { status: response.status, error: 'upstream_status' }, error: `Base RPC HTTP ${response.status}` };
      let parsed: unknown = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { return { ok: false, raw: { status: response.status, error: 'invalid_json' }, error: 'Base RPC returned invalid JSON' }; }
      const raw = { status: response.status, request: { method, params }, response: parsed };
      if (!parsed || typeof parsed !== 'object') return { ok: false, raw, error: 'Base RPC returned an invalid response' };
      const rpc = parsed as Record<string, unknown>;
      if (rpc.jsonrpc !== '2.0' || rpc.id !== 1 || 'error' in rpc || !('result' in rpc)) return { ok: false, raw, error: 'Base RPC returned a malformed or mismatched response' };
      return { ok: true, result: rpc.result, raw, error: '' };
    } catch {
      const error = controller.signal.aborted ? 'timeout' : 'transport_error';
      return { ok: false, raw: { error }, error: error === 'timeout' ? 'Base RPC request timed out' : 'Base RPC request could not be completed' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private invalidStep(step: BaseStep, message: string): AdapterExecution {
    return this.inconclusive(step, { error: 'invalid_step' }, message);
  }

  private inconclusive(step: BaseStep, raw: unknown, message: string): AdapterExecution {
    return this.make(step, 'INCONCLUSIVE', message, raw, null, { error: raw && typeof raw === 'object' && 'error' in raw ? (raw as { error: unknown }).error : 'inconclusive' });
  }

  private make(step: BaseStep, result: StepResult, message: string, raw: unknown, revision: string | null, extractedFacts: Record<string, unknown>): AdapterExecution {
    const evidence: EvidenceRecord = createEvidence({
      claimId: step.claimId,
      stepId: step.id,
      adapter: 'base',
      source: `evm://${step.params.network}`,
      revision,
      raw,
      extractedFacts: { chainProfile: step.params.network, ...extractedFacts },
      result,
    }, this.now());
    return { result, message, evidence };
  }
}

/** Protocol-neutral name for the allowlisted EVM adapter; BaseAdapter remains a compatibility export. */
export class EvmAdapter extends BaseAdapter {}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-f0-9]{64}$/i.test(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-f0-9]{40}$/i.test(value);
}

function isAddressFromTopic(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
}

function topicAddress(value: string): string {
  return `0x${value.slice(-40)}`.toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeReceiptStatus(value: string | null): string | null {
  if (value === 'success') return '0x1';
  if (value === 'failure') return '0x0';
  if (value === '0x0' || value === '0x1') return value;
  return null;
}

function revisionFrom(value: Record<string, unknown>): string | null {
  if (typeof value.blockHash === 'string') return value.blockHash;
  if (typeof value.transactionHash === 'string') return value.transactionHash;
  if (typeof value.hash === 'string') return value.hash;
  return null;
}

interface EventExpectation {
  expectedAddress?: string;
  expectedTopic0?: string;
}

function parseEventExpectation(value: string | null): EventExpectation | null {
  if (!value) return null;
  const fields: Record<string, string> = {};
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (!item || fields[key] !== undefined || !['address', 'topic0'].includes(key)) return null;
    fields[key] = item;
  }
  if (!fields.address && !fields.topic0) return null;
  if (fields.address && !isAddress(fields.address)) return null;
  if (fields.topic0 && !/^0x[a-f0-9]{64}$/i.test(fields.topic0)) return null;
  return {
    ...(fields.address ? { expectedAddress: fields.address.toLowerCase() } : {}),
    ...(fields.topic0 ? { expectedTopic0: fields.topic0.toLowerCase() } : {}),
  };
}

interface TokenTransferExpectation {
  token: string;
  recipient: string;
  amount: bigint;
}

function parseTokenTransferExpectation(value: string | null): TokenTransferExpectation | null {
  if (!value) return null;
  const fields: Record<string, string> = {};
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (!item || fields[key] !== undefined || !['token', 'recipient', 'amount'].includes(key)) return null;
    fields[key] = item;
  }
  if (!fields.token || !fields.recipient || fields.amount === undefined || !isAddress(fields.token) || !isAddress(fields.recipient) || !/^\d+$/.test(fields.amount)) return null;
  return { token: fields.token.toLowerCase(), recipient: fields.recipient.toLowerCase(), amount: BigInt(fields.amount) };
}

interface ParsedLog {
  address: string;
  topics: string[];
  data: string;
}

function parseLogs(value: unknown[]): ParsedLog[] | null {
  const logs: ParsedLog[] = [];
  for (const item of value) {
    const log = asRecord(item);
    if (!log || !isAddress(log.address) || !Array.isArray(log.topics) || log.topics.some((topic) => typeof topic !== 'string' || !/^0x[a-f0-9]*$/i.test(topic)) || typeof log.data !== 'string' || !/^0x[a-f0-9]*$/i.test(log.data)) return null;
    logs.push({ address: log.address.toLowerCase(), topics: log.topics as string[], data: log.data });
  }
  return logs;
}

function matchesEvent(log: ParsedLog, expectation: EventExpectation): boolean {
  return (!expectation.expectedAddress || log.address === expectation.expectedAddress) && (!expectation.expectedTopic0 || log.topics[0]?.toLowerCase() === expectation.expectedTopic0);
}

function isSafePublicUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet))) return true;
  const [a, b] = octets.map(Number);
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}

async function readLimitedText(response: Response, maxBytes: number): Promise<{ text: string; bytes: number; tooLarge: boolean }> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    return { text: text.slice(0, maxBytes), bytes, tooLarge: bytes > maxBytes };
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
    return { text: new TextDecoder().decode(joinChunks(chunks)), bytes, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
