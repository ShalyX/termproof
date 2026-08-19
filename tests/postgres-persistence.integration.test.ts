import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresPersistenceAdapter } from '../src/core/postgres-persistence.ts';

const connectionString = process.env.TERMPROOF_DATABASE_URL?.trim();
const live = connectionString ? test : test.skip;

live('Postgres durable rate limiter is atomic across adapter calls', async () => {
  const adapter = new PostgresPersistenceAdapter(connectionString!);
  const cleanup = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000 });
  const scope = `integration:${randomUUID()}`;
  const now = new Date();
  const windowMs = 60_000;
  const bucketStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  try {
    const first = await adapter.consumeRateLimit(scope, 2, windowMs, now);
    const second = await adapter.consumeRateLimit(scope, 2, windowMs, now);
    const third = await adapter.consumeRateLimit(scope, 2, windowMs, now);

    assert.deepEqual(
      [first.allowed, first.currentCount, second.allowed, second.currentCount, third.allowed, third.currentCount],
      [true, 1, true, 2, false, 3],
    );
  } finally {
    await adapter.close();
    await cleanup.query(
      'delete from termproof.rate_limit_buckets where scope_key = $1 and bucket_start = $2',
      [scope, bucketStart.toISOString()],
    );
    await cleanup.end();
  }
});

live('Postgres adapter can read a persisted production-format case envelope when a case id is supplied', async (t) => {
  const caseId = process.env.TERMPROOF_POSTGRES_CASE_ID?.trim();
  if (!caseId) {
    t.skip('Set TERMPROOF_POSTGRES_CASE_ID to exercise durable case readback.');
    return;
  }

  const adapter = new PostgresPersistenceAdapter(connectionString!);
  try {
    const persisted = await adapter.getCase(caseId);
    assert.equal(persisted.caseId, caseId);
    assert.equal(persisted.snapshot.caseId, caseId);
    assert.equal(persisted.version >= 0, true);
    assert.equal(persisted.input.milestone, persisted.snapshot.milestone);
    assert.equal(persisted.acceptanceLedger.terms.length > 0, true);
    assert.equal(typeof persisted.acceptanceLedger.audit.complete, 'boolean');
  } finally {
    await adapter.close();
  }
});
