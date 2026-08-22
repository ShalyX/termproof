# Termproof — Orion submission pack

## One-line pitch

Termproof is an autonomous verification agent that turns funded technical milestone promises into bounded evidence checks and a deterministic release recommendation before the next payment is approved.

## Judge links

- Product: `https://termproof-mauve.vercel.app`
- Demo: `https://youtu.be/2iZw2vNTgE4`
- GitHub: `https://github.com/ShalyX/termproof`
- X: `https://x.com/termproof`
- Telegram: `https://t.me/term_proof`
- Deployment proof: `docs/deployment-proof.md`

## Problem

Grant and milestone programs routinely decide whether to release the next tranche from screenshots, self-reported updates, repository links, or manually assembled evidence. Those inputs are useful but they do not establish that the exact promised technical conditions were satisfied.

Termproof converts the acceptance terms themselves into explicit proof obligations, routes only supported objective checks, observes live public systems, preserves attributable evidence, and computes the final disposition with deterministic policy rather than model judgment.

## What is original

The core mechanism is not “AI reads a repo.” It is:

`natural-language acceptance term → normalized proof obligation → evidence capability → bounded source adapter → immutable observation → deterministic assertion → milestone disposition`

That design prevents a common verifier failure: silently replacing a strong promise with a weaker proxy. A source file existing cannot prove runtime behavior; a transaction existing cannot prove receipt success; a sponsor/chain name cannot stand in for protocol evidence. Unsupported or underspecified strength remains `NEEDS_EVIDENCE` instead of being weakened into a pass.

**The memorable wedge: Termproof refuses proxy substitution.** If the promised condition requires stronger proof than the available evidence can establish, release stays on hold.

## Features

- Compiles natural-language technical acceptance terms into explicit proof obligations.
- Routes only bounded checks supported by the canonical capability registry.
- Observes live GitHub, public HTTPS, allowlisted EVM networks including Base, and npm registry evidence.
- Produces attributable, hashed evidence receipts with source and observation provenance.
- Keeps model planning separate from deterministic `PASS`/`FAIL` and milestone verdict policy.
- Preserves strong proof requirements instead of weakening them into easier proxies.
- Returns `NEEDS_EVIDENCE` when an objective condition lacks the source required to test it.
- Durably resumes open evidence requests from PostgreSQL with transactional locking and idempotency.
- Fails closed on planner or persistence failures rather than manufacturing a verdict.
- Never clones/runs third-party repository code or installs/executes npm packages.

## Agent boundary

The production planner may propose only checks supported by the canonical verifier schema. Gemini is primary; DeepSeek is a bounded operational fallback. The model cannot assign `PASS`, `FAIL`, `VERIFIED`, `FAILED`, or `NEEDS_EVIDENCE`.

GitHub, HTTP, EVM, and npm adapters establish observations. Deterministic policy computes claim results and the milestone disposition. Public source content is always treated as untrusted data and is never executed.

## Supported live evidence

- GitHub: repository/file/license/release state and bounded static source assertions.
- Public HTTPS: exact status, valid JSON, exact JSON-field equality, and bounded body assertions with SSRF/redirect/size protections.
- EVM: allowlisted Base, Base Sepolia, and Arc Testnet chain identity, deployed bytecode, transaction, receipt, event, and ERC-20 Transfer assertions.
- npm: package existence, exact version, repository association, and distribution/integrity metadata without package execution.

## Strongest judge demo

Final demo: `https://youtu.be/2iZw2vNTgE4`

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

Production black-box proof has established the complete sequence:

`start → NEEDS_EVIDENCE → resume → VERIFIED → idempotent replay → conflicting replay rejected → get persisted case`

## Production evidence

Registration: confirmed by Orion organizer email on August 20, 2026; wallet confirmed for the Builder Hackathon.

Ignition: Base transaction `0x9724c0e1a73188771d0f04f25f72a67a6074ae89a961adfb9984cb22dcc98b11` succeeded for 0.004309 ETH.

Submission recovery: Orion support instructed use of `Restore My Submission`; the already-paid submission was restored successfully without a second ignition payment.

AI vetting: restored submission completed with Intelligence Score `46/100`. Innovation scored `18/25` and technical feasibility `22/25`; the main deductions were judge-facing completeness, market/economic framing, and fields the vetter treated as missing or absent from its context.

Stable runtime deployment: `https://termproof-oyss0nfbg-shalyxs-projects.vercel.app`

Vercel deployment ID: `dpl_8bnBtrx1bhWNpC2pbEgxfZMwCF7u`

Git-backed runtime commit: `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`

Durable production proof case: `229d0fd0-4553-49d9-baaf-024f6c520fb0`

## Security and execution discipline

- No arbitrary repository or npm package execution.
- Public HTTP sources are bounded and SSRF-protected.
- EVM RPC destinations are profile-allowlisted and chain identity is verified.
- Evidence is attributable, revision-aware, hashed, and frozen after provenance attachment.
- Resumable production state uses PostgreSQL, not process memory.
- Resume mutation uses transactional row locking, exact version advancement, and request-hash idempotency.
- Rate limiting is shared and atomic in PostgreSQL.
- Database or planner infrastructure failure fails closed rather than fabricating a verdict.
- Current hackathon case access is capability-based: a case ID acts as a bearer capability. Confidential/private evidence is out of scope until authenticated tenant ownership is added.

## Honest limitations

Termproof recommends whether objective technical milestone conditions are established; it does not transfer funds or replace the grant owner. It does not claim to prove subjective quality, legal compliance, or arbitrary software behavior. If the available verifier capabilities cannot establish the required proof strength, it asks for stronger evidence or human review.

## Orion revision fields

Use these values where the revision form exposes the corresponding field. Do not invent unavailable economics merely to satisfy the vetter.

- Target blockchain: `Base`
- Strategy: `Risk Management`
- Category: `Risk`
- Revenue sharing: `0%` — Termproof has no current revenue-sharing token mechanism.
- Funding target: `$1,500`
- Token symbol: leave blank — Termproof has no token.
- Website: `https://termproof-mauve.vercel.app`
- X: `https://x.com/termproof`
- Telegram: `https://t.me/term_proof`
- GitHub: `https://github.com/ShalyX/termproof`
- Demo URL: `https://youtu.be/2iZw2vNTgE4`

If the vetter receives only description text rather than all structured fields, the description below explicitly states the relevant risk/economic facts so `0%`, no-token status, and the funding target are not mistaken for omitted data.

## Revised submission description

Termproof is a proof-before-release risk agent for technical grants, DAO programs, and milestone-based treasury decisions. It compiles natural-language acceptance terms into explicit proof obligations, routes them to bounded GitHub/HTTP/EVM/npm evidence capabilities, records attributable evidence receipts, and computes the final release recommendation with deterministic policy. The model plans but cannot assign verdicts.

Its key safety property is non-substitution: a strong promise cannot be silently replaced with an easier proxy. A file existing cannot prove runtime behavior; a transaction hash cannot prove receipt success. If the required proof strength is unavailable, Termproof holds the recommendation at `NEEDS_EVIDENCE` instead of manufacturing a pass.

The live product demonstrates truthful `VERIFIED`, deliberate contradiction → `FAILED / HOLD RELEASE`, and missing-source → durable `NEEDS_EVIDENCE` → resume flows. Production state is PostgreSQL-backed with locking, idempotency, and shared rate limiting, and a stable Vercel deployment is tied to public Git commit `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`.

Termproof sits before a grant or DAO treasury release decision: it does not move funds itself; it gives the human or governance process a reproducible evidence-backed recommendation before the next tranche is approved. Strategy: Risk Management. Category: Risk. Target chain: Base. Funding target: $1,500. Revenue sharing: 0% at this stage. Termproof has no token.

Demo: `https://youtu.be/2iZw2vNTgE4`

## Suggested short description

Proof before release: a risk agent that converts technical milestone terms into non-substitutable proof obligations, live evidence checks, and deterministic funding-release recommendations.

## DAO gate

Do not send to DAO until the Orion revision screen visibly contains the Demo URL and the structured fields above, and the revised AI vetting result has completed.
