# Termproof security posture

Release checkpoint: v12.3.4 source-predicate completeness, ledger-integrity, verdict-safety, evidence-integrity, and proof-strength hardening on top of v12.3.3 atomic coverage.

## Dependency gate

- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Critical production-reachable vulnerabilities: zero.
- High production-reachable vulnerabilities: zero.
- The full dependency tree still reports development/build-only findings in tooling such as Vinext, Vite, Wrangler, Miniflare, ESLint, and their transitive packages. Those packages are excluded from the deployed runtime; the project does not claim that the entire dependency tree is vulnerability-free.

## Application boundaries

- The model cannot assign claim results or milestone dispositions.
- Deterministic policy is the only verdict boundary.
- The provider-neutral production planner is mandatory. Gemini is primary and requests structured JSON-schema output; DeepSeek is the only bounded fallback for Gemini timeout, 429/quota, 5xx/provider outage, empty response, or malformed JSON after bounded retry. Both outputs are application-side parsed, canonical-schema validated, and coverage-validated. Semantic invalidity never triggers provider-shopping. If no provider returns a valid complete plan, the API returns `PLANNER_UNAVAILABLE` and no verdict; there is no runtime demo, mock, heuristic, fixture, or local fallback.
- `GEMINI_API_KEY` and `DEEPSEEK_API_KEY` are server-side deployment secrets. Provenance records provider/model/role/failover reason/timestamp/version and plan hash only; credentials are excluded from logs, evidence, API responses, client bundles, and Git.
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
- Resumable cases preserve prior evidence attribution and reject wrong-claim, closed-request, and concurrent resume attempts.

## Operational controls

The API emits request IDs, applies an in-process rate limit, returns generic error messages, and logs failure metadata without request bodies or credentials. The current case store and rate limiter are process-local; durable multi-worker coordination is not part of this frozen release.
