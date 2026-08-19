# Termproof security posture

Release checkpoint: v12.4 durable-runtime hardening on top of the frozen v12.3.4 source-predicate completeness, ledger-integrity, verdict-safety, evidence-integrity, and proof-strength semantics.

## Dependency gate

- The v12.3.4 production-reachable dependency audit was zero high/critical findings.
- v12.4 adds PostgreSQL/Nitro runtime dependencies and must pass the same production-reachable high/critical gate before release.
- Development/build-only tooling findings are not represented as production-runtime findings; the project does not claim that every development dependency is vulnerability-free.

## Application boundaries

- The model cannot assign claim results or milestone dispositions.
- Deterministic policy is the only verdict boundary.
- The provider-neutral production planner is mandatory. Gemini is primary and requests structured JSON-schema output; DeepSeek is the only bounded fallback for Gemini timeout, 429/quota, 5xx/provider outage, empty response, or malformed JSON after bounded retry. Both outputs are application-side parsed, canonical-schema validated, and coverage-validated. Semantic invalidity never triggers provider-shopping. If no provider returns a valid complete plan, the API returns `PLANNER_UNAVAILABLE` and no verdict; there is no runtime demo, mock, heuristic, fixture, or local fallback.
- `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, and `TERMPROOF_DATABASE_URL` are server-side deployment secrets. Provenance records provider/model/role/failover reason/timestamp/version and plan hash only; credentials are excluded from evidence, API responses, client bundles, and Git.
- Every substantive acceptance term receives a stable ID and exactly one disposition. `VERIFIED` requires complete required-term coverage plus `PASS` for every required deterministic claim.
- The acceptance ledger is built from the original promise before planning, retains clause/source-span/entity metadata, is hashed in provenance, and is independently compared with mapped coverage before policy can issue `VERIFIED`.
- A capability-oriented supported-predicate audit independently scans the original source for supported repository, HTTP, npm, and EVM predicates. Equivalent contract-deployment language, including arbitrary contract names without a preceding `contract` token, maps to `CONTRACT_CODE → evm.contract_state → contract_code_exists`. Detected predicates are reconciled into the ledger or leave an explicit `LEDGER_INCOMPLETE` guard; planner omissions cannot shrink the source scope.
- The final policy guard verifies the source audit is represented in the dispositioned ledger and that ledger metadata (predicate type, extraction origin, proof operation, proof obligation, and source span) is unchanged in coverage. Any mismatch degrades to `NEEDS_EVIDENCE`; it cannot produce `VERIFIED`.
- Proof obligations and evidence capabilities are separate from sponsor, project, or chain branding. Unsupported protocols and behavioral/subjective obligations surface as `UNSUPPORTED`, `NEEDS_EVIDENCE`, or human review; a weaker route cannot produce `PASS`.
- Identical HTTP requests share one bounded observation and raw-response hash within a run. Request fingerprints include canonical URL, method, relevant headers, and body hash; no observation cache crosses users, runs, or resumes.
- GitHub source inspection is capped, encoding-aware, comment/string-aware, and static. It never executes source; pathological, malformed, empty, comment-only, or oversized source cannot establish implementation behavior.
- EVM RPC profiles are allowlisted (Base, Base Sepolia, and Arc Testnet), chain identity is checked against the returned JSON-RPC result and request ID, and oversized/malformed transaction, receipt, log, or Transfer responses fail closed as `INCONCLUSIVE`.
- EVM proof-strength separation is enforced: chain identity, contract code existence, transaction existence, and receipt success each require their matching generic capability and operation.
- New EVM evidence uses the protocol-neutral `evm://<profile>` source namespace; immutable historical receipts retain their original identifiers.
- Fetched evidence is untrusted data and cannot act as instructions.
- HTTP SSRF protections block private-network targets, credentials, fragments, redirect following, oversized bodies, and known DNS-alias forms.
- No third-party repository or npm package is installed, imported, or executed.
- Evidence provenance is hashed and immutable after attachment.

## Durable state controls

- Production resumable state uses PostgreSQL; process memory is not a production fallback.
- A successful `start` is committed transactionally with its case snapshot, ledger/audit, plan provenance, source observations, evidence receipts, claim results, verdict, and evidence requests.
- The persisted case envelope retains the original input, acceptance terms, independent source audit, version, and complete snapshot. `get` reloads that state from PostgreSQL across serverless instances.
- Resume mutation obtains a PostgreSQL row lock using `FOR UPDATE NOWAIT`. A second concurrent resume fails closed rather than racing the first mutation.
- Case versions advance by exactly one with an optimistic version predicate. A version conflict aborts the transaction.
- Resume idempotency stores a key plus request hash. Replaying the same request returns the stored result; reusing the key with different evidence is rejected.
- Acceptance ledgers and source-predicate audits are immutable content-addressed records. Evidence/source observations are attributable and preserved rather than rewritten during resume.
- Database unavailability maps to a generic persistence-unavailable response and does not silently downgrade to in-memory state.

## Operational controls

- The API emits request IDs and logs bounded failure metadata without request bodies or credentials.
- Rate limiting is durable and atomic through PostgreSQL `termproof.consume_rate_limit(...)`, so multiple workers share a single per-window counter. Database inability fails closed; it does not enable an in-process bypass.
- The production database schema denies anonymous/authenticated client access, enables RLS, and uses database-level immutability controls for audit/evidence tables.
- Runtime credentials remain deployment configuration and are not committed to source. `.env.example` contains names/defaults only.
