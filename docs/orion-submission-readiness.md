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
| Orion registration | UNVERIFIED | Prior project notes indicate registration work was done, but there is no current repository/email evidence available here. Confirm in the organizer UI before submission. |
| Ignition/submission transaction | PENDING | Complete only in the official submission UI; retain the transaction/link as evidence after submission. |
| Deadline | TRACKED | Project field map tracks September 2, 2026 at 23:59 UTC. Reconfirm in the organizer UI immediately before final submission. |

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

## Remaining human-facing submission blockers

The product, public technical evidence, identities, and final demo are ready. The remaining blockers are organizer actions:

1. organizer registration confirmation; and
2. final organizer submission/ignition transaction.
