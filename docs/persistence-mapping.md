# Termproof durable persistence mapping

v12.4 keeps the v12.3.4 verification semantics frozen and changes only runtime durability/concurrency. PostgreSQL is the production source of truth for resumable cases and rate limiting.

## Case state envelope

`termproof.cases.state` stores the complete resumable envelope:

```text
{
  version,
  input,
  acceptanceTerms,
  acceptanceAudit,
  snapshot
}
```

The promoted v12.4 production deployment writes this exact envelope. `snapshot` contains the public `VerificationCaseSnapshot` (`caseId`, `milestone`, `verdict`, `claims`, `evidenceLedger`, `evidenceRequests`, `plan`, `coverage`, `provenance`).

## Table mapping

| Runtime object | PostgreSQL table | Durability rule |
| --- | --- | --- |
| Current resumable case/version | `termproof.cases` | One mutable current row per case; optimistic `version` update |
| Original normalized acceptance terms | `termproof.acceptance_ledgers` | Immutable/content-addressed; one original ledger hash per case |
| Independent source-predicate audit | `termproof.source_predicate_audits` | Immutable/content-addressed |
| Canonical planner output + provenance | `termproof.plans` | Immutable by plan hash/version |
| Missing-evidence request | `termproof.evidence_requests` | Request identity retained; status may advance to satisfied |
| Bounded fetched source response | `termproof.source_observations` | Immutable observation lineage + raw/observation hashes |
| Assertion-specific evidence | `termproof.evidence_receipts` | Immutable evidence ID/hash linked to observation |
| Deterministic claim/step result | `termproof.claim_results` | Append by case version |
| Deterministic milestone disposition | `termproof.verdicts` | Append by case version |
| Resume version change | `termproof.state_transitions` | Append-only; `to_version = from_version + 1` |
| Resume replay guard | `termproof.mutation_idempotency` | Unique `(case_id, idempotency_key)` plus request hash/result |
| Shared API request bucket | `termproof.rate_limit_buckets` | Atomic UPSERT through `termproof.consume_rate_limit(...)` |

## Initial `start`

A successful `start` uses one database transaction:

1. insert `cases` at version `0` with the state envelope;
2. append the original acceptance ledger and source-predicate audit;
3. append the plan/provenance;
4. append each unique source observation;
5. append each evidence receipt linked to its observation;
6. append deterministic claim results;
7. append the deterministic verdict; and
8. append any evidence requests.

No `state_transitions` row is required for version `0` because there is no previous case state.

## `get`

`get(caseId)` loads `cases.state` from PostgreSQL. It does not depend on a process-local cache, so a case can be read by a different serverless worker from the one that created it.

## `resume`

Resume executes inside one transaction:

1. select the current case `FOR UPDATE NOWAIT`;
2. resolve/validate the idempotency key and request hash;
3. validate that the evidence request is still open and matches the planned claim/step/adapter;
4. perform the bounded observation;
5. compute the new deterministic claim/coverage/verdict snapshot;
6. update `cases` only when the expected prior version still matches;
7. append only new observations/evidence and the new-version claim/verdict rows;
8. update the evidence request status;
9. append the state transition; and
10. persist the idempotent response before commit.

A lock conflict, version conflict, database outage, or idempotency mismatch fails closed. There is no production memory fallback.

## Shared HTTP observations

For one run, assertion-specific evidence records may share one `observation_id` when they were derived from the same canonical HTTP request fingerprint. `source_observations` stores the fetched response once; `evidence_receipts` preserves each claim/step-specific assertion and extracted facts.

The promoted v12.4 production database demonstrates this mapping: the Mandate health checks reuse one HTTP observation while preserving separate evidence receipts for HTTP status, JSON validity, and JSON-field assertions.

## Rate limiting

The API passes the same client scope used by the prior route (`cf-connecting-ip`, otherwise `anonymous`) into the PostgreSQL rate-limit function. The function atomically increments the shared bucket and returns `{allowed, current_count}`. This prevents independent serverless workers from each maintaining their own counters.
