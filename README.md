# Termproof

![Termproof — Terms, tested.](public/brand/termproof-lockup.svg)

**Terms, tested.** Termproof turns a technical milestone promise into bounded evidence checks and a deterministic milestone disposition. Proof before release.

**Live production:** `https://termproof-mauve.vercel.app`  
**Judge demo:** `https://youtu.be/2iZw2vNTgE4`  
**Production runtime checkpoint:** Vercel deployment `dpl_8bnBtrx1bhWNpC2pbEgxfZMwCF7u` from Git commit `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba` — see [`docs/deployment-proof.md`](docs/deployment-proof.md).

It recommends `VERIFIED`, `FAILED`, or `NEEDS_EVIDENCE`. It does not release funds, move assets, or approve a grant on its own.

## The failure Termproof is built to prevent

A verifier should not turn a strong acceptance term into an easier proxy just because that proxy is convenient to check.

A file existing does not prove runtime behavior. A transaction hash existing does not prove receipt success. A sponsor or chain name does not prove protocol state. Termproof normalizes each acceptance term into a proof obligation and requires an evidence capability strong enough to establish that obligation. If the available capability is weaker, the term stays unresolved instead of being silently converted into a pass.

That is the core product boundary: **strong proof obligations cannot be weakened into proxies.**

## How it works

`promise → constrained plan → proof obligation → adapter observation → extracted facts → evidence hash → deterministic claim result → milestone disposition`

The language model may propose only supported checks. It cannot assign claim results or the milestone disposition. Policy code evaluates adapter results. Uncertain infrastructure conditions become `INCONCLUSIVE`, which produces `NEEDS_EVIDENCE` for required claims.

## Supported verification systems

- GitHub: repository, file, license, release, and bounded static source checks. Static source checks inspect content/declarations/syntax without executing it.
- Public HTTPS: exact status, bounded body, valid-JSON, or exact JSON-field checks, with timeout, redirect, response-size, credential, and private-network protections.
- Allowlisted EVM profiles (Base, Base Sepolia, and Arc Testnet): chain identity, deployed-contract bytecode, transaction lookup, receipt status, sender/destination, event, and ERC-20 Transfer assertions through configured RPC endpoints. Arc Testnet profile metadata includes chain ID 5042002, explorer metadata, and the documented USDC interface; the same generic EVM operations are used for every profile.
- npm registry: package existence, exact version, repository association, and distribution/integrity metadata. Packages are never installed or executed.

Resumable cases can defer a claim, request precise evidence, preserve the existing evidence ledger, and re-run only the requested check. Production resumable state is persisted in PostgreSQL with transactional row locking, optimistic versioning, mutation idempotency, and shared durable rate limiting; process memory is not the production source of truth.

## Local setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`GEMINI_API_KEY` and `DEEPSEEK_API_KEY` are deployment-only secrets. Gemini is the primary structured-output planner; DeepSeek is attempted only after a bounded Gemini operational failure such as timeout, rate limit, provider outage, empty output, or malformed JSON. Both outputs are parsed and validated against the same canonical planner schema and deterministic acceptance-term coverage gate. A semantically invalid plan is never provider-shopped, and if no valid plan is available the API returns `PLANNER_UNAVAILABLE` without a verdict. Credentials remain server-side and are never returned as evidence.

Production resumable routes additionally require the server-only `TERMPROOF_DATABASE_URL`; production fails closed if durable persistence is unavailable.

## Validation

```bash
npm test
npm run lint
npm run validate:artifact
npm audit --omit=dev --audit-level=high
```

The release gate runs on Linux. `.gitattributes` pins shell scripts and project text to LF so a Windows checkout does not rewrite executable scripts to CRLF. On Windows, run the shell-backed commands from WSL or Git Bash.

The production checkpoint includes the core/adversarial suite, provider failover tests, persistence/idempotency tests, and rendered-interface checks. The production-only high-severity audit gate is clean; development/build tooling posture is documented in [`docs/security.md`](docs/security.md).

## Demo scenario

The production form starts with an objective Mandate repository and health-endpoint example across GitHub and HTTPS. The regression suite runs the exact Mandate input against the live sources, then changes only `service equals mandate` to `service equals mandate-agent`; the truthful control must produce `VERIFIED`, while the exact JSON-field contradiction must produce `FAILED / HOLD RELEASE` with complete term coverage. A missing required evidence source still yields `NEEDS_EVIDENCE`; supplying that source resumes the requested check while preserving prior evidence attribution. A deterministic failed check remains `FAILED` even when unrelated evidence is added.

Before a verdict, Termproof normalizes every substantive acceptance term into a stable ID and records its disposition (`PLANNED`, `NEEDS_EVIDENCE`, `NOT_OBJECTIVELY_TESTABLE`, or `UNSUPPORTED`). `VERIFIED` requires complete required-term coverage and a `PASS` result for every required deterministic claim; an incomplete plan cannot verify a milestone.

Coverage also records the required proof obligation, selected evidence capability, and evidence receipts actually established. A presence check cannot satisfy a stronger implementation, runtime, transaction, protocol-object, or subjective obligation. Identical HTTP assertions in one run share one bounded point-in-time observation and retain its request fingerprint and raw-response hash.

## Production durability proof

A production black-box lifecycle has exercised:

`start → NEEDS_EVIDENCE → resume → VERIFIED → idempotent replay → conflicting replay rejected → get persisted case`

The dedicated PostgreSQL runtime recorded the exact `0 → 1` case transition, `OPEN → SATISFIED` evidence request, completed idempotency record, source observations, evidence receipts, and final durable readback.

## Public-case access model

The current hackathon API has no user-account layer. Resumable case IDs act as high-entropy bearer capabilities: anyone who obtains a case ID can read that case and may supply evidence for an open request through the bounded resume path. Do not place confidential evidence in a Termproof case. Authenticated tenant ownership is required before private or multi-tenant production use.

## Limitations

- The verifier recommends disposition; it does not release funds or perform grant settlement.
- It checks bounded public observations, not arbitrary software behavior or legal compliance.
- Subjective criteria cannot be objectively verified without an explicit deterministic test.
- Public provider outages, rate limits, malformed responses, and stale or unavailable infrastructure can require additional evidence.
- Repository and package content is data only. No third-party repository or npm package is cloned, installed, imported, or executed.
- Current resumable case access is capability-based rather than account-authenticated; case IDs must be treated as bearer secrets.

See [`docs/architecture.md`](docs/architecture.md), [`docs/evidence-provenance.md`](docs/evidence-provenance.md), [`docs/threat-model.md`](docs/threat-model.md), [`docs/security.md`](docs/security.md), [`docs/deployment-proof.md`](docs/deployment-proof.md), [`docs/orion-submission-pack.md`](docs/orion-submission-pack.md), and [`docs/orion-submission-readiness.md`](docs/orion-submission-readiness.md).

Brand assets and production tokens are documented in [`docs/brand.md`](docs/brand.md). Historical package, verifier, API, and deployment identifiers retain the original `grant-milestone-verifier` name so cosmetic branding does not alter provenance or runtime contracts.
