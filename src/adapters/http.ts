import { randomUUID } from 'node:crypto';
import { createEvidence, hashEvidence } from '../core/evidence.ts';
import type { AdapterExecution, EvidenceRecord, HttpStep, StepResult } from '../core/types.ts';

const HTTP_OPERATIONS = ['status_matches', 'body_contains', 'json_valid', 'json_field_matches'] as const;
type HttpOperation = typeof HTTP_OPERATIONS[number];

export interface HttpRequestDescriptor {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface HttpObservation {
  id: string;
  requestFingerprint: string;
  request: { url: string; method: string; headers: Record<string, string>; bodyHash: string | null };
  observedAt: string;
  availability: 'AVAILABLE' | 'INCONCLUSIVE';
  status: number | null;
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
  truncated: boolean;
  parsedJson: unknown;
  jsonValid: boolean | null;
  rawResponseHash: string;
  error: string | null;
}

export class HttpAdapter {
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;
  private maxBodyBytes: number;
  private maxAttempts: number;
  private retryDelayMs: number;

  constructor(options: { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; maxBodyBytes?: number; maxAttempts?: number; retryDelayMs?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 50);
  }

  /** Execute every assertion against one immutable observation per canonical request. */
  async executeMany(steps: readonly HttpStep[]): Promise<Map<string, AdapterExecution>> {
    const results = new Map<string, AdapterExecution>();
    const groups = new Map<string, { descriptor: HttpRequestDescriptor; steps: HttpStep[] }>();
    for (const step of steps) {
      if (!isHttpOperation(step.operation)) {
        results.set(step.id, this.invalidStep(step, 'Unsupported HTTP operation'));
        continue;
      }
      if (step.operation === 'status_matches' && (!/^\d{3}$/.test(step.params.expected) || Number(step.params.expected) < 100 || Number(step.params.expected) > 599)) {
        results.set(step.id, this.make(step, 'INCONCLUSIVE', 'Expected HTTP status is invalid', { error: 'invalid_expected_status' }, { error: 'invalid_expected_status' }, null));
        continue;
      }
      if (step.operation === 'json_valid' && step.params.expected.toLowerCase() !== 'true') {
        results.set(step.id, this.make(step, 'INCONCLUSIVE', 'HTTP JSON validity expectation is invalid', { error: 'invalid_json_valid_expectation' }, { error: 'invalid_json_valid_expectation' }, null));
        continue;
      }
      const descriptor = requestDescriptor(step);
      const fingerprint = canonicalHttpRequestFingerprint(descriptor);
      const group = groups.get(fingerprint);
      if (group) group.steps.push(step);
      else groups.set(fingerprint, { descriptor, steps: [step] });
    }
    for (const group of groups.values()) {
      const observation = await this.observe(group.descriptor);
      for (const step of group.steps) results.set(step.id, this.evaluate(step, observation));
    }
    return results;
  }

  async execute(step: HttpStep): Promise<AdapterExecution> {
    const result = (await this.executeMany([step])).get(step.id);
    return result ?? this.invalidStep(step, 'HTTP execution did not produce an evidence receipt');
  }

  /** Each call is a new point-in-time observation; no cache crosses runs or users. */
  async observe(descriptor: HttpRequestDescriptor): Promise<HttpObservation> {
    const observedAt = this.now().toISOString();
    let url: URL;
    try { url = new URL(descriptor.url); } catch { return this.inconclusiveObservation(descriptor, observedAt, 'invalid_url'); }
    if (!isSafePublicUrl(url)) return this.inconclusiveObservation(descriptor, observedAt, 'invalid_url');
    const request = canonicalRequest(url, descriptor);
    const requestFingerprint = hashEvidence(request);
    let lastError = 'transport_error';

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: request.method,
          redirect: 'manual',
          headers: request.headers,
          ...(descriptor.body === undefined || descriptor.body === null ? {} : { body: descriptor.body }),
          signal: controller.signal,
        });
        const body = await readBody(response, this.maxBodyBytes);
        const headers = headersRecord(response.headers);
        const parsed = parseJson(body.text);
        const responseHash = hashEvidence({ status: response.status, headers, body: body.text, bodyBytes: body.bytes, truncated: body.truncated });
        const transient = isInfrastructureStatus(response.status) || response.status >= 300 && response.status < 400;
        if (body.truncated) return this.makeObservation(requestFingerprint, request, observedAt, 'INCONCLUSIVE', response.status, headers, body, null, null, responseHash, 'body_too_large');
        if (isInfrastructureStatus(response.status) && attempt + 1 < this.maxAttempts) {
          lastError = `http_${response.status}`;
          await retryDelay(this.retryDelayMs, attempt);
          continue;
        }
        return this.makeObservation(requestFingerprint, request, observedAt, transient ? 'INCONCLUSIVE' : 'AVAILABLE', response.status, headers, body, parsed.value, parsed.valid, responseHash, transient ? `http_${response.status}` : null);
      } catch {
        lastError = controller.signal.aborted ? 'timeout' : 'transport_error';
        if (attempt + 1 < this.maxAttempts) {
          await retryDelay(this.retryDelayMs, attempt);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    return this.inconclusiveObservation(descriptor, observedAt, lastError, request);
  }

  private evaluate(step: HttpStep, observation: HttpObservation): AdapterExecution {
    const expected = step.params.expected;
    if (step.operation === 'status_matches' && (!/^\d{3}$/.test(expected) || Number(expected) < 100 || Number(expected) > 599)) return this.make(step, 'INCONCLUSIVE', 'Expected HTTP status is invalid', observationReceipt(observation), { error: 'invalid_expected_status' }, observation);
    if (step.operation === 'json_valid' && expected.toLowerCase() !== 'true') return this.make(step, 'INCONCLUSIVE', 'HTTP JSON validity expectation is invalid', observationReceipt(observation), { error: 'invalid_json_valid_expectation' }, observation);
    if (observation.availability === 'INCONCLUSIVE') return this.make(step, 'INCONCLUSIVE', 'HTTP observation could not establish a stable response', observationReceipt(observation), { error: observation.error ?? 'inconclusive_observation', status: observation.status, observationId: observation.id, bodyBytes: observation.bodyBytes, truncated: observation.truncated }, observation);
    const status = observation.status ?? 0;
    if (step.operation === 'status_matches') {
      const matches = status === Number(expected);
      return this.make(step, matches ? 'PASS' : 'FAIL', `HTTP ${status}`, observationReceipt(observation), { status, expectedStatus: Number(expected) }, observation);
    }
    if (step.operation === 'body_contains') {
      const contains = observation.body.includes(expected);
      const result: StepResult = status < 200 || status >= 300 ? 'FAIL' : contains ? 'PASS' : 'FAIL';
      return this.make(step, result, contains ? `HTTP body contains ${expected}` : `HTTP body did not contain ${expected}`, observationReceipt(observation), { status, bodyContains: contains, bodyBytes: observation.bodyBytes, truncated: observation.truncated }, observation);
    }
    if (status < 200 || status >= 300) return this.make(step, 'FAIL', `HTTP ${status} did not provide the expected JSON response`, observationReceipt(observation), { status, error: 'unexpected_status', jsonValid: observation.jsonValid }, observation);
    if (observation.jsonValid !== true) return this.make(step, 'FAIL', 'HTTP response was not valid JSON', observationReceipt(observation), { status, jsonValid: false, error: 'invalid_json' }, observation);
    if (step.operation === 'json_valid') return this.make(step, 'PASS', 'HTTP response is valid JSON', observationReceipt(observation), { status, jsonValid: true }, observation);
    const expectedField = parseJsonFieldExpectation(expected);
    if (!expectedField) return this.make(step, 'INCONCLUSIVE', 'JSON field expectation is invalid', observationReceipt(observation), { status, error: 'invalid_json_field_expectation' }, observation);
    const observedValue = readJsonField(observation.parsedJson, expectedField.field);
    const matches = observedValue !== undefined && Object.is(observedValue, expectedField.value);
    return this.make(step, matches ? 'PASS' : 'FAIL', matches ? `JSON field ${expectedField.field} matched` : `JSON field ${expectedField.field} did not match`, observationReceipt(observation), { status, jsonValid: true, jsonField: expectedField.field, expectedValue: expectedField.value, observedValue, jsonFieldMatches: matches }, observation);
  }

  private invalidStep(step: HttpStep, message: string): AdapterExecution {
    return this.make(step, 'INCONCLUSIVE', message, { error: 'invalid_step' }, { error: 'invalid_step' }, null);
  }

  private make(step: HttpStep, result: StepResult, message: string, raw: unknown, extractedFacts: Record<string, unknown>, observation: HttpObservation | null): AdapterExecution {
    const evidence: EvidenceRecord = createEvidence({
      claimId: step.claimId,
      stepId: step.id,
      adapter: 'http',
      source: step.params.url,
      revision: observation?.status === null || observation?.status === undefined ? null : String(observation.status),
      raw,
      extractedFacts,
      result,
      ...(observation ? { observationId: observation.id, requestFingerprint: observation.requestFingerprint, observationRawHash: observation.rawResponseHash, observationObservedAt: observation.observedAt } : {}),
    }, this.now());
    return { result, message, evidence };
  }

  private makeObservation(requestFingerprint: string, request: HttpObservation['request'], observedAt: string, availability: HttpObservation['availability'], status: number, headers: Record<string, string>, body: { text: string; bytes: number; truncated: boolean }, parsedJson: unknown, jsonValid: boolean | null, rawResponseHash: string, error: string | null): HttpObservation {
    return Object.freeze({ id: randomUUID(), requestFingerprint, request, observedAt, availability, status, headers: Object.freeze(headers), body: body.text, bodyBytes: body.bytes, truncated: body.truncated, parsedJson, jsonValid, rawResponseHash, error });
  }

  private inconclusiveObservation(descriptor: HttpRequestDescriptor, observedAt: string, error: string, request?: HttpObservation['request']): HttpObservation {
    const canonical = request ?? canonicalRequest(null, descriptor);
    const fingerprint = hashEvidence(canonical);
    return this.makeObservation(fingerprint, canonical, observedAt, 'INCONCLUSIVE', null, {}, { text: '', bytes: 0, truncated: false }, null, null, hashEvidence({ error, request: canonical }), error);
  }
}

export function canonicalHttpRequestFingerprint(descriptor: HttpRequestDescriptor): string {
  let url: URL | null = null;
  try { url = new URL(descriptor.url); } catch { /* adapter returns INCONCLUSIVE */ }
  return hashEvidence(canonicalRequest(url, descriptor));
}

function requestDescriptor(step: HttpStep): HttpRequestDescriptor {
  return { url: step.params.url, method: step.params.request?.method, headers: step.params.request?.headers, body: step.params.request?.body };
}

function canonicalRequest(url: URL | null, descriptor: HttpRequestDescriptor): HttpObservation['request'] {
  const headerMap = new Map<string, string>([['accept', '*/*']]);
  for (const [key, value] of Object.entries(descriptor.headers ?? {})) headerMap.set(key.toLowerCase(), value.trim());
  const headers = Object.fromEntries([...headerMap.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { url: url?.href ?? descriptor.url.trim(), method: (descriptor.method ?? 'GET').toUpperCase(), headers, bodyHash: descriptor.body === undefined || descriptor.body === null ? null : hashEvidence(descriptor.body) };
}

function observationReceipt(observation: HttpObservation): Record<string, unknown> {
  return { observationId: observation.id, requestFingerprint: observation.requestFingerprint, status: observation.status, headers: observation.headers, body: observation.body, bodyBytes: observation.bodyBytes, truncated: observation.truncated, jsonValid: observation.jsonValid, rawResponseHash: observation.rawResponseHash, error: observation.error };
}

function isHttpOperation(value: string): value is HttpOperation {
  return (HTTP_OPERATIONS as readonly string[]).includes(value);
}

function parseJsonFieldExpectation(expected: string): { field: string; value: unknown } | null {
  const separator = expected.indexOf('=');
  if (separator <= 0) return null;
  const field = expected.slice(0, separator).trim();
  const rawValue = expected.slice(separator + 1).trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(field) || !rawValue) return null;
  try { return { field, value: JSON.parse(rawValue) }; } catch { return { field, value: rawValue }; }
}

function readJsonField(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isSafePublicUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateDnsAlias(hostname)) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  if (hostname === 'metadata.google.internal' || hostname.endsWith('.internal')) return false;
  if (hostname.includes(':')) return !isPrivateIpv6(hostname);
  return !isPrivateIpv4(hostname);
}

function isPrivateDnsAlias(hostname: string): boolean {
  if (hostname === 'lvh.me' || hostname.endsWith('.lvh.me') || hostname === 'localtest.me' || hostname.endsWith('.localtest.me')) return true;
  for (const suffix of ['.nip.io', '.sslip.io', '.xip.io']) {
    if (!hostname.endsWith(suffix)) continue;
    const alias = hostname.slice(0, -suffix.length);
    return isPrivateIpv4(alias) || isPrivateIpv6(alias);
  }
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname.startsWith('::ffff:')) {
    const parts = hostname.slice(7).split(':');
    if (parts.length === 2 && parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return hostname === '::1' || hostname === '::' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb');
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet))) return false;
  const [a, b] = octets.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isInfrastructureStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseJson(text: string): { value: unknown; valid: boolean | null } {
  if (!text.trim()) return { value: null, valid: false };
  try { return { value: JSON.parse(text), valid: true }; } catch { return { value: null, valid: false }; }
}

function headersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

async function retryDelay(delayMs: number, attempt: number): Promise<void> {
  const delay = Math.min(1_000, Math.max(0, delayMs) * (attempt + 1));
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function readBody(response: Response, maxBytes: number): Promise<{ text: string; bytes: number; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    return { text: text.slice(0, maxBytes), bytes, truncated: bytes > maxBytes };
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
        const remaining = Math.max(0, maxBytes - bytes);
        if (remaining > 0) chunks.push(value.slice(0, remaining));
        bytes += value.byteLength;
        await reader.cancel();
        return { text: new TextDecoder().decode(joinChunks(chunks)), bytes, truncated: true };
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    return { text: new TextDecoder().decode(joinChunks(chunks)), bytes, truncated: false };
  } finally {
    reader.releaseLock();
  }
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}
