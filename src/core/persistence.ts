import { createHash, randomUUID } from 'node:crypto';
import type { AcceptanceTermLedger } from './coverage.ts';
import { stableJson } from './evidence.ts';
import type { VerificationInput, VerificationPlan } from './types.ts';
import type { VerificationCaseSnapshot } from './resumable.ts';

export interface PersistenceRequestContext {
  requestId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
}

export interface PersistedVerificationCase {
  caseId: string;
  version: number;
  input: VerificationInput;
  plan: VerificationPlan;
  snapshot: VerificationCaseSnapshot;
  acceptanceLedger: AcceptanceTermLedger;
}

export interface RateLimitDecision {
  allowed: boolean;
  currentCount: number;
  expiresAt: string;
}

export interface PersistenceAdapter {
  readonly kind: 'memory' | 'postgres';
  createCase(record: PersistedVerificationCase, context?: PersistenceRequestContext): Promise<void>;
  getCase(caseId: string): Promise<PersistedVerificationCase>;
  mutateCase(
    caseId: string,
    context: PersistenceRequestContext,
    mutate: (current: PersistedVerificationCase) => Promise<PersistedVerificationCase>,
  ): Promise<PersistedVerificationCase>;
  consumeRateLimit(scopeKey: string, max: number, windowMs: number, now?: Date): Promise<RateLimitDecision>;
  close?(): Promise<void>;
}

export class PersistenceError extends Error {
  readonly code: 'PERSISTENCE_UNAVAILABLE' | 'CASE_NOT_FOUND' | 'RESUME_LOCKED' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT';

  constructor(code: PersistenceError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PersistenceError';
    this.code = code;
  }
}

interface MemoryIdempotencyRecord {
  requestHash: string;
  response: PersistedVerificationCase;
}

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly kind = 'memory' as const;
  private readonly cases = new Map<string, PersistedVerificationCase>();
  private readonly activeMutations = new Set<string>();
  private readonly idempotency = new Map<string, MemoryIdempotencyRecord>();
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  async createCase(record: PersistedVerificationCase): Promise<void> {
    if (this.cases.has(record.caseId)) throw new PersistenceError('VERSION_CONFLICT', 'Verification case already exists');
    this.cases.set(record.caseId, structuredClone(record));
  }

  async getCase(caseId: string): Promise<PersistedVerificationCase> {
    const current = this.cases.get(caseId);
    if (!current) throw new PersistenceError('CASE_NOT_FOUND', 'Verification case not found');
    return structuredClone(current);
  }

  async mutateCase(
    caseId: string,
    context: PersistenceRequestContext,
    mutate: (current: PersistedVerificationCase) => Promise<PersistedVerificationCase>,
  ): Promise<PersistedVerificationCase> {
    const key = context.idempotencyKey ? `${caseId}:${context.idempotencyKey}` : null;
    if (key) {
      const existing = this.idempotency.get(key);
      if (existing) {
        const requestHash = context.requestHash ?? '';
        if (existing.requestHash !== requestHash) throw new PersistenceError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with different evidence');
        return structuredClone(existing.response);
      }
    }
    if (this.activeMutations.has(caseId)) throw new PersistenceError('RESUME_LOCKED', 'Resume already in progress');
    this.activeMutations.add(caseId);
    try {
      const current = this.cases.get(caseId);
      if (!current) throw new PersistenceError('CASE_NOT_FOUND', 'Verification case not found');
      const beforeVersion = current.version;
      const updated = await mutate(structuredClone(current));
      if (updated.version !== beforeVersion + 1) throw new PersistenceError('VERSION_CONFLICT', 'Verification case version did not advance exactly once');
      this.cases.set(caseId, structuredClone(updated));
      if (key) this.idempotency.set(key, { requestHash: context.requestHash ?? '', response: structuredClone(updated) });
      return structuredClone(updated);
    } finally {
      this.activeMutations.delete(caseId);
    }
  }

  async consumeRateLimit(scopeKey: string, max: number, windowMs: number, now = new Date()): Promise<RateLimitDecision> {
    const timestamp = now.getTime();
    const bucketStart = Math.floor(timestamp / windowMs) * windowMs;
    const key = `${scopeKey}:${bucketStart}`;
    const existing = this.buckets.get(key);
    const expiresAt = bucketStart + windowMs;
    const count = existing && existing.expiresAt > timestamp ? existing.count + 1 : 1;
    this.buckets.set(key, { count, expiresAt });
    return { allowed: count <= max, currentCount: count, expiresAt: new Date(expiresAt).toISOString() };
  }

  resetForTests(): void {
    this.cases.clear();
    this.activeMutations.clear();
    this.idempotency.clear();
    this.buckets.clear();
  }
}

export function hashPersistenceRequest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function newCaseId(): string {
  return randomUUID();
}
