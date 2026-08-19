import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { buildAcceptanceTermLedger } from './coverage.ts';
import { hashEvidence, stableJson } from './evidence.ts';
import {
  PersistenceError,
  type PersistedVerificationCase,
  type PersistenceAdapter,
  type PersistenceRequestContext,
  type RateLimitDecision,
} from './persistence.ts';
import type { EvidenceRecord } from './types.ts';

const DEFAULT_POOL_MAX = 4;

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;

  constructor(config: string | PoolConfig) {
    this.pool = new Pool(typeof config === 'string'
      ? { connectionString: config, max: Number(process.env.TERMPROOF_DB_POOL_MAX ?? DEFAULT_POOL_MAX), idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 }
      : config);
    this.pool.on('error', (error) => console.error(JSON.stringify({ event: 'postgres_pool_error', errorType: error.name })));
  }

  static fromEnvironment(): PostgresPersistenceAdapter {
    const connectionString = process.env.TERMPROOF_DATABASE_URL?.trim();
    if (!connectionString) throw new PersistenceError('PERSISTENCE_UNAVAILABLE', 'TERMPROOF_DATABASE_URL is required in production');
    return new PostgresPersistenceAdapter(connectionString);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createCase(record: PersistedVerificationCase, context: PersistenceRequestContext = {}): Promise<void> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `insert into termproof.cases
          (id, run_id, submitted_condition, anchor, status, verdict, version, state, created_by_request_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [record.caseId, record.caseId, record.input.milestone, record.input.githubRepository, record.snapshot.verdict, record.snapshot.verdict, record.version, json(record.snapshot), context.requestId ?? null],
      );
      await this.appendVersionRows(client, record, null);
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }

  async getCase(caseId: string): Promise<PersistedVerificationCase> {
    try {
      const result = await this.pool.query(
        `select id, submitted_condition, anchor, version, state
           from termproof.cases
          where id = $1`,
        [caseId],
      );
      if (result.rowCount !== 1) throw new PersistenceError('CASE_NOT_FOUND', 'Verification case not found');
      return hydrateCase(result.rows[0]);
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw mapPostgresError(error);
    }
  }

  async mutateCase(
    caseId: string,
    context: PersistenceRequestContext,
    mutate: (current: PersistedVerificationCase) => Promise<PersistedVerificationCase>,
  ): Promise<PersistedVerificationCase> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `select id, submitted_condition, anchor, version, state, status, verdict
           from termproof.cases
          where id = $1
          for update nowait`,
        [caseId],
      );
      if (locked.rowCount !== 1) throw new PersistenceError('CASE_NOT_FOUND', 'Verification case not found');

      const current = hydrateCase(locked.rows[0]);
      const idempotencyKey = context.idempotencyKey?.trim() || null;
      if (idempotencyKey) {
        const prior = await client.query(
          `select request_hash, state, response_json
             from termproof.mutation_idempotency
            where case_id = $1 and idempotency_key = $2`,
          [caseId, idempotencyKey],
        );
        if (prior.rowCount === 1) {
          const row = prior.rows[0];
          if ((row.request_hash ?? '') !== (context.requestHash ?? '')) {
            throw new PersistenceError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with different evidence');
          }
          if (row.state === 'COMPLETED' && row.response_json) {
            const response = row.response_json as { version?: number; snapshot?: PersistedVerificationCase['snapshot'] };
            if (!response.snapshot) throw new PersistenceError('PERSISTENCE_UNAVAILABLE', 'Stored idempotent response is malformed');
            await client.query('COMMIT');
            return {
              ...current,
              version: Number(response.version ?? current.version),
              snapshot: response.snapshot,
              plan: response.snapshot.plan,
            };
          }
          throw new PersistenceError('RESUME_LOCKED', 'Resume already in progress');
        }
        await client.query(
          `insert into termproof.mutation_idempotency
            (id, case_id, idempotency_key, request_hash, state)
           values ($1, $2, $3, $4, 'IN_PROGRESS')`,
          [randomUUID(), caseId, idempotencyKey, context.requestHash ?? ''],
        );
      }

      const updated = await mutate(current);
      if (updated.caseId !== caseId) throw new PersistenceError('VERSION_CONFLICT', 'Verification case identity changed during mutation');
      if (updated.version !== current.version + 1) throw new PersistenceError('VERSION_CONFLICT', 'Verification case version did not advance exactly once');

      const update = await client.query(
        `update termproof.cases
            set status = $1,
                verdict = $2,
                version = $3,
                state = $4::jsonb,
                updated_at = now()
          where id = $5 and version = $6`,
        [updated.snapshot.verdict, updated.snapshot.verdict, updated.version, json(updated.snapshot), caseId, current.version],
      );
      if (update.rowCount !== 1) throw new PersistenceError('VERSION_CONFLICT', 'Verification case version changed concurrently');

      await this.appendVersionRows(client, updated, current);
      await client.query(
        `insert into termproof.state_transitions
          (id, case_id, from_version, to_version, from_status, to_status, request_id, mutation_id, transition_json)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          randomUUID(), caseId, current.version, updated.version, current.snapshot.verdict, updated.snapshot.verdict,
          context.requestId ?? null, idempotencyKey,
          json({ fromVersion: current.version, toVersion: updated.version, fromVerdict: current.snapshot.verdict, toVerdict: updated.snapshot.verdict }),
        ],
      );

      if (idempotencyKey) {
        await client.query(
          `update termproof.mutation_idempotency
              set state = 'COMPLETED', response_status = 200, response_json = $1::jsonb, completed_at = now()
            where case_id = $2 and idempotency_key = $3`,
          [json({ version: updated.version, snapshot: updated.snapshot }), caseId, idempotencyKey],
        );
      }

      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await rollbackQuietly(client);
      throw mapPostgresError(error);
    } finally {
      client.release();
    }
  }

  async consumeRateLimit(scopeKey: string, max: number, windowMs: number, now = new Date()): Promise<RateLimitDecision> {
    const timestamp = now.getTime();
    const bucketStart = new Date(Math.floor(timestamp / windowMs) * windowMs);
    const expiresAt = new Date(bucketStart.getTime() + windowMs);
    try {
      const result = await this.pool.query(
        `select allowed, current_count
           from termproof.consume_rate_limit($1, $2, $3, $4)`,
        [scopeKey, bucketStart.toISOString(), expiresAt.toISOString(), max],
      );
      if (result.rowCount !== 1) throw new Error('Rate limit function returned no decision');
      return { allowed: Boolean(result.rows[0].allowed), currentCount: Number(result.rows[0].current_count), expiresAt: expiresAt.toISOString() };
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  private async connect(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      throw mapPostgresError(error);
    }
  }

  private async appendVersionRows(client: PoolClient, record: PersistedVerificationCase, previous: PersistedVerificationCase | null): Promise<void> {
    const { caseId, version, snapshot, acceptanceLedger } = record;
    const auditHash = snapshot.provenance.acceptancePredicateAuditHash ?? hashEvidence(stableJson(acceptanceLedger.audit));
    const planHash = snapshot.provenance.planner.planHash || hashEvidence(stableJson(record.plan));

    if (!previous) {
      await client.query(
        `insert into termproof.acceptance_ledgers
          (id, case_id, version, ledger_hash, ledger_json, canonical_json)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [randomUUID(), caseId, version, acceptanceLedger.sourceHash, json(acceptanceLedger.terms), stableJson(acceptanceLedger.terms)],
      );
      await client.query(
        `insert into termproof.source_predicate_audits
          (id, case_id, version, audit_hash, audit_json, canonical_json)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [randomUUID(), caseId, version, auditHash, json(acceptanceLedger.audit), stableJson(acceptanceLedger.audit)],
      );
    }

    const previousPlanHash = previous?.snapshot.provenance.planner.planHash ?? null;
    if (!previous || previousPlanHash !== planHash) {
      await client.query(
        `insert into termproof.plans
          (id, case_id, version, plan_hash, plan_json, canonical_json, planner_provider, planner_model, planner_role, failover_reason, planner_version, planned_at, provenance_json)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [
          randomUUID(), caseId, version, planHash, json(record.plan), stableJson(record.plan),
          snapshot.provenance.planner.provider ?? snapshot.provenance.planner.kind ?? null,
          snapshot.provenance.planner.model ?? null,
          snapshot.provenance.planner.role ?? null,
          snapshot.provenance.planner.failoverReason ?? null,
          snapshot.provenance.planner.version ?? null,
          snapshot.provenance.planner.timestamp ?? null,
          json(snapshot.provenance),
        ],
      );
    }

    const previousEvidenceIds = new Set(previous?.snapshot.evidenceLedger.map((entry) => entry.evidence.id) ?? []);
    const newEvidence = snapshot.evidenceLedger
      .map((entry) => ({ ...entry, evidence: entry.evidence as EvidenceRecord }))
      .filter((entry) => !previousEvidenceIds.has(entry.evidence.id));

    const observations = new Map<string, EvidenceRecord>();
    for (const { evidence } of newEvidence) {
      const observationId = evidence.observationId ?? evidence.id;
      if (!observations.has(observationId)) observations.set(observationId, evidence);
    }
    for (const evidence of observations.values()) {
      const observationId = evidence.observationId ?? evidence.id;
      const observationHash = evidence.observationRawHash ?? evidence.rawHash;
      const observationPayload = { raw: evidence.raw, result: evidence.result, evidenceId: evidence.id, extractedFacts: evidence.extractedFacts };
      await client.query(
        `insert into termproof.source_observations
          (id, case_id, version, observation_id, request_fingerprint, observation_lineage, source, revision, raw_hash, observation_hash, observation_json, canonical_json, observed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
         on conflict do nothing`,
        [
          randomUUID(), caseId, version, observationId, evidence.requestFingerprint ?? null, observationId,
          evidence.source, evidence.revision, evidence.rawHash, observationHash, json(observationPayload), stableJson(observationPayload),
          evidence.observationObservedAt ?? evidence.observedAt,
        ],
      );
    }

    for (const entry of newEvidence) {
      const evidence = entry.evidence;
      const observationId = evidence.observationId ?? evidence.id;
      await client.query(
        `insert into termproof.evidence_receipts
          (id, case_id, version, evidence_id, claim_id, step_id, observation_id, source, revision, result, evidence_hash, extracted_facts, receipt_json, canonical_json, observed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15)
         on conflict do nothing`,
        [
          randomUUID(), caseId, version, evidence.id, entry.claimId, entry.stepId, observationId,
          evidence.source, evidence.revision, evidence.result, evidence.rawHash, json(evidence.extractedFacts), json(evidence), stableJson(evidence), evidence.observedAt,
        ],
      );
    }

    for (const claim of snapshot.claims) {
      if (claim.steps.length === 0) {
        await client.query(
          `insert into termproof.claim_results
            (id, case_id, version, claim_id, step_id, result, evidence_id, result_json)
           values ($1, $2, $3, $4, null, $5, null, $6::jsonb)`,
          [randomUUID(), caseId, version, claim.id, claim.result, json({ claim })],
        );
        continue;
      }
      for (const step of claim.steps) {
        await client.query(
          `insert into termproof.claim_results
            (id, case_id, version, claim_id, step_id, result, evidence_id, result_json)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [randomUUID(), caseId, version, claim.id, step.id, step.result, step.evidenceIds[0] ?? null, json({ claim, step })],
        );
      }
    }

    await client.query(
      `insert into termproof.verdicts
        (id, case_id, version, verdict, policy_id, verdict_json)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), caseId, version, snapshot.verdict, snapshot.provenance.policy.version, json({ verdict: snapshot.verdict, claims: snapshot.claims, coverage: snapshot.coverage ?? [] })],
    );

    if (!previous) {
      for (const request of snapshot.evidenceRequests) {
        await client.query(
          `insert into termproof.evidence_requests
            (id, case_id, version, term_id, request_key, status, request_json)
           values ($1, $2, $3, null, $4, $5, $6::jsonb)`,
          [randomUUID(), caseId, version, request.id, request.status, json(request)],
        );
      }
    } else {
      for (const request of snapshot.evidenceRequests) {
        const old = previous.snapshot.evidenceRequests.find((candidate) => candidate.id === request.id);
        if (!old) {
          await client.query(
            `insert into termproof.evidence_requests
              (id, case_id, version, term_id, request_key, status, request_json)
             values ($1, $2, $3, null, $4, $5, $6::jsonb)`,
            [randomUUID(), caseId, version, request.id, request.status, json(request)],
          );
        } else if (old.status !== request.status) {
          await client.query(
            `update termproof.evidence_requests
                set version = $1, status = $2, request_json = $3::jsonb, resolved_at = case when $2 = 'SATISFIED' then now() else resolved_at end, updated_at = now()
              where case_id = $4 and request_key = $5`,
            [version, request.status, json(request), caseId, request.id],
          );
        }
      }
    }
  }
}

function hydrateCase(row: Record<string, unknown>): PersistedVerificationCase {
  const snapshot = row.state as PersistedVerificationCase['snapshot'];
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.plan) throw new PersistenceError('PERSISTENCE_UNAVAILABLE', 'Persisted verification case is malformed');
  const milestone = String(row.submitted_condition ?? snapshot.milestone ?? '');
  const anchor = String(row.anchor ?? '');
  return {
    caseId: String(row.id),
    version: Number(row.version),
    input: { milestone, githubRepository: anchor },
    plan: snapshot.plan,
    snapshot,
    acceptanceLedger: buildAcceptanceTermLedger(milestone),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try { await client.query('ROLLBACK'); } catch { /* original error wins */ }
}

function mapPostgresError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '55P03') return new PersistenceError('RESUME_LOCKED', 'Resume already in progress', { cause: error });
  if (code === '23505') return new PersistenceError('VERSION_CONFLICT', 'Durable verification state conflicted with an existing record', { cause: error });
  return new PersistenceError('PERSISTENCE_UNAVAILABLE', 'Durable verification persistence is unavailable', { cause: error });
}
