import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export function createRequestId(candidate?: string | null): string {
  return candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
}

export class RateLimiter {
  private readonly buckets = new Map<string, { started: number; count: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: { max: number; windowMs: number; now?: () => number }) {
    this.max = Math.max(1, options.max);
    this.windowMs = Math.max(1, options.windowMs);
    this.now = options.now ?? Date.now;
  }

  allow(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.started >= this.windowMs) {
      this.buckets.set(key, { started: now, count: 1 });
      return true;
    }
    if (bucket.count >= this.max) return false;
    bucket.count += 1;
    return true;
  }
}
