import { createHash, randomUUID } from 'node:crypto';
import type { EvidenceInput, EvidenceRecord } from './types.ts';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stable(source[key])]));
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function hashEvidence(raw: unknown): string {
  return createHash('sha256').update(stableJson(raw)).digest('hex');
}

export function createEvidence(input: EvidenceInput, now = new Date()): EvidenceRecord {
  return {
    ...input,
    id: randomUUID(),
    observedAt: now.toISOString(),
    rawHash: hashEvidence(input.raw),
  };
}

export function freezeEvidence(record: EvidenceRecord): EvidenceRecord {
  deepFreeze(record);
  return record;
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  Object.freeze(value);
}
