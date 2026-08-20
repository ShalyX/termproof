# Termproof — Orion submission pack

## One-line pitch

Termproof is an autonomous verification agent that turns funded technical milestone promises into bounded evidence checks and a deterministic release recommendation before the next payment is approved.

## Problem

Grant and milestone programs routinely decide whether to release the next tranche from screenshots, self-reported updates, repository links, or manually assembled evidence. Those inputs are useful but they do not establish that the exact promised technical conditions were satisfied.

Termproof converts the acceptance terms themselves into explicit proof obligations, routes only supported objective checks, observes live public systems, preserves attributable evidence, and computes the final disposition with deterministic policy rather than model judgment.

## What is original

The core mechanism is not “AI reads a repo.” It is:

`natural-language acceptance term → normalized proof obligation → evidence capability → bounded source adapter → immutable observation → deterministic assertion → milestone disposition`

That design prevents a common verifier failure: silently replacing a strong promise with a weaker proxy. A source file existing cannot prove runtime behavior; a transaction existing cannot prove receipt success; a sponsor/chain name cannot stand in for protocol evidence. Unsupported or underspecified strength remains `NEEDS_EVIDENCE` instead of being weakened into a pass.

## Agent boundary

The production planner may propose only checks supported by the canonical verifier schema. Gemini is primary; DeepSeek is a bounded operational fallback. The model cannot assign `PASS`, `FAIL`, `VERIFIED`, `FAILED`, or `NEEDS_EVIDENCE`.

GitHub, HTTP, EVM, and npm adapters establish observations. Deterministic policy computes claim results and the milestone disposition. Public source content is always treated as untrusted data and is never executed.

## Supported live evidence

- GitHub: repository/file/license/release state and bounded static source assertions.
- Public HTTPS: exact status, valid JSON, exact JSON-field equality, and bounded body assertions with SSRF/redirect/size protections.
- EVM: allowlisted Base, Base Sepolia, and Arc Testnet chain identity, deployed bytecode, transaction, receipt, event, and ERC-20 Transfer assertions.
- npm: package existence, exact version, repository association, and distribution/integrity metadata without package execution.

## Strongest judge demo

### Act 1 — exact promise

Give Termproof a real technical milestone containing multiple objective clauses across GitHub and HTTPS.

Termproof decomposes the promise, shows each acceptance term, proof obligation, selected capability, and planned verifier step, then fetches live evidence.

### Act 2 — contradiction

Use the truthful Mandate control first. Expected result: complete coverage and `VERIFIED`.

Then change only one exact condition — for example an expected JSON field from `service equals mandate` to `service equals mandate-agent`.

Expected result: the same source is observed, the exact field assertion fails, and Termproof returns `FAILED / HOLD RELEASE`. The model cannot override the contradiction.

### Act 3 — missing evidence and durable resume

Give an objective HTTP condition whose URL is deliberately absent from the original agreement.

Expected result: Termproof preserves the condition and returns `NEEDS_EVIDENCE` with a precise request instead of inventing or weakening a source.

Supply the public HTTPS source. Termproof re-fetches it through the normal HTTP adapter, advances only the requested case, persists the transition in PostgreSQL, and recomputes the deterministic disposition.

Production black-box proof has already established the complete sequence:

`start → NEEDS_EVIDENCE → resume → VERIFIED → idempotent replay → conflicting replay rejected → get persisted case`

## Production evidence

Website: `https://termproof-mauve.vercel.app`

Repository: `https://github.com/ShalyX/termproof`

X: `https://x.com/termproof`

Current Git-backed production commit: `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`

Durable production proof case: `229d0fd0-4553-49d9-baaf-024f6c520fb0`

The proof established one `0 → 1` state transition, `OPEN → SATISFIED` evidence-request persistence, completed mutation idempotency, deterministic conflicting-replay rejection, and durable readback from the dedicated PostgreSQL runtime.

## Security and execution discipline

- No arbitrary repository or npm package execution.
- Public HTTP sources are bounded and SSRF-protected.
- EVM RPC destinations are profile-allowlisted and chain identity is verified.
- Evidence is attributable, revision-aware, hashed, and frozen after provenance attachment.
- Resumable production state uses PostgreSQL, not process memory.
- Resume mutation uses transactional row locking, exact version advancement, and request-hash idempotency.
- Rate limiting is shared and atomic in PostgreSQL.
- Database or planner infrastructure failure fails closed rather than fabricating a verdict.
- Production release gate covers clean install, full tests, lint, artifact validation, Vercel build, and high-severity production dependency audit.

## Honest limitations

Termproof recommends whether objective technical milestone conditions are established; it does not transfer funds or replace the grant owner. It does not claim to prove subjective quality, legal compliance, or arbitrary software behavior. If the available verifier capabilities cannot establish the required proof strength, it asks for stronger evidence or human review.

## Suggested submission description

Termproof is a proof-before-release agent for technical grants and milestone programs. It compiles natural-language acceptance terms into explicit proof obligations, routes them to bounded GitHub/HTTP/EVM/npm evidence capabilities, records immutable provenance, and computes the final milestone disposition with deterministic policy. The model plans but cannot assign verdicts. Strong conditions cannot be silently weakened into easier proxies: missing or unsupported evidence stays visible as `NEEDS_EVIDENCE`. Production supports durable resumable cases in PostgreSQL, transactional locking/idempotency, and shared rate limiting. A judge can watch a truthful multi-source milestone verify, change one exact field and see it fail, then withhold an evidence URL and watch Termproof request and durably resume only that missing proof.

## Suggested short description

Proof before release: an autonomous agent that converts technical milestone terms into bounded live evidence checks and deterministic funding-release recommendations.

## Final submission fields still needed from the builder

- Discord or Telegram URL
- final public demo video URL
- organizer registration confirmation
- final submission/ignition transaction evidence
