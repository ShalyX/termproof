# Orion submission readiness

Evidence-based status for the current production checkpoint. No item is marked complete without repository, deployment, or user-provided evidence.

| Requirement | Status | Evidence / next action |
|---|---|---|
| Website | COMPLETE | Production: `https://termproof-mauve.vercel.app` on Vercel. Current production deployment is Git-backed and READY. |
| GitHub | COMPLETE | Public repository: `https://github.com/ShalyX/termproof`; `main` contains the synchronized v12.4 durable runtime. |
| Working agent | COMPLETE | Production black-box proof exercised `start → NEEDS_EVIDENCE → resume → VERIFIED → idempotent replay → conflict rejection → get` against the live API and dedicated PostgreSQL runtime. |
| Durable runtime | COMPLETE | Production cases, evidence requests, idempotency, transitions, receipts, observations, and shared rate-limit buckets are persisted in the dedicated Termproof PostgreSQL schema. |
| Release gate | COMPLETE | Clean install, full test suite, lint, artifact validation, Vercel build, and production high-severity audit are enforced before release. |
| X profile | COMPLETE | User-supplied official project profile: `https://x.com/termproof`. |
| Discord or Telegram | COMPLETE | Public Telegram community: `https://t.me/term_proof`. User also supplied invite URL `https://t.me/+Hwqdf9cKBUozY2Q8`; use the public username URL in submission fields. |
| Demo link | COMPLETE | User-supplied final judge-facing YouTube demo: `https://youtu.be/2iZw2vNTgE4`. |
| Orion registration | COMPLETE | Organizer confirmation email from `founders@orionagents.org` on August 20, 2026 states registration and wallet are confirmed for the Orion Builder Hackathon. |
| Ignition transaction | COMPLETE | User-supplied BaseScan evidence shows transaction `0x9724c0e1a73188771d0f04f25f72a67a6074ae89a961adfb9984cb22dcc98b11` succeeded, transferring 0.004309 ETH for the Orion ignition fee at Aug 20, 2026 16:26:59 UTC. |
| AI vetting / DAO voting | RECOVERY REQUIRED | Orion displayed `Agent Submitted` and began issuing the soulbound reputation token, but the page reloaded before AI vetting completed and before `Send to DAO Voting` was completed. Termproof is not currently visible in the public site UI. Do not pay a second ignition fee; recover the existing submission with Orion support/backend state. |
| Deadline | TRACKED | Organizer confirmation email states submissions close September 2, 2026 at 23:59 UTC. Reconfirm in the organizer UI immediately before final submission. |

## Production proof checkpoint

Production URL: `https://termproof-mauve.vercel.app`

Current Git-backed production commit: `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`

The live production proof created case `229d0fd0-4553-49d9-baaf-024f6c520fb0` and established:

- initial deterministic disposition `NEEDS_EVIDENCE` with one precise open HTTP evidence request;
- supplied public HTTPS evidence re-fetched through the normal bounded HTTP adapter;
- exact case transition version `0 → 1` and disposition `NEEDS_EVIDENCE → VERIFIED`;
- evidence request state `OPEN → SATISFIED`;
- exact idempotent replay returned the stored result without a second transition;
- reuse of the same idempotency key with different evidence returned `IDEMPOTENCY_CONFLICT`;
- subsequent `get` returned the persisted VERIFIED case from PostgreSQL;
- production logs showed the expected 200/409 request sequence with no runtime-error cluster.

## Remaining human-facing submission blocker

The product, public technical evidence, identities, demo, organizer registration, and paid ignition transaction are complete. One organizer recovery action remains:

1. restore the already-paid Termproof submission after the interrupted AI-vetting screen, then complete `Send to DAO Voting` without charging a second ignition fee.
