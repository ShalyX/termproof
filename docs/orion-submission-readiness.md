# Orion submission readiness

Evidence-based status for the current production checkpoint. No item is marked complete without repository, deployment, organizer, wallet, or user-provided evidence.

| Requirement | Status | Evidence / next action |
|---|---|---|
| Website | COMPLETE | Production: `https://termproof-mauve.vercel.app` on Vercel. |
| GitHub | COMPLETE | Public repository: `https://github.com/ShalyX/termproof`. |
| Working agent | COMPLETE | Production black-box proof exercised `start → NEEDS_EVIDENCE → resume → VERIFIED → idempotent replay → conflict rejection → get` against the live API and PostgreSQL runtime. |
| Durable runtime | COMPLETE | Production cases, evidence requests, idempotency, transitions, receipts, observations, and shared rate-limit buckets are persisted in the dedicated Termproof PostgreSQL schema. |
| Deployment provenance | COMPLETE | Stable Vercel deployment `dpl_8bnBtrx1bhWNpC2pbEgxfZMwCF7u` maps to public Git commit `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`; see `docs/deployment-proof.md`. |
| Release gate | COMPLETE | Clean install, test suite, lint, artifact validation, Vercel build, and production high-severity audit are enforced in the release workflow. `.gitattributes` pins shell scripts to LF for cross-platform checkout consistency. |
| X profile | COMPLETE | Official project profile: `https://x.com/termproof`. |
| Discord or Telegram | COMPLETE | Public Telegram community: `https://t.me/term_proof`. |
| Demo link | COMPLETE / MUST SURFACE IN ORION | Final judge-facing YouTube demo: `https://youtu.be/2iZw2vNTgE4`. The Orion entry must expose this URL before DAO voting. |
| Orion registration | COMPLETE | Organizer confirmation email from `founders@orionagents.org` on August 20, 2026 states registration and wallet are confirmed for the Builder Hackathon. |
| Ignition transaction | COMPLETE | Base transaction `0x9724c0e1a73188771d0f04f25f72a67a6074ae89a961adfb9984cb22dcc98b11` succeeded for 0.004309 ETH at Aug 20, 2026 16:26:59 UTC. |
| Submission recovery | COMPLETE | Orion support instructed the builder to reconnect the registered wallet and use `Restore My Submission`; Termproof was successfully restored without another ignition payment. |
| AI vetting | COMPLETE | Restored submission completed AI vetting with an Intelligence Score of `46/100`. The analysis scored innovation and technical feasibility strongly but penalized judge-facing completeness, market/economic framing, and missing/unsurfaced fields such as Demo URL. |
| DAO voting | PENDING | Do not send the current 46/100 package to DAO until the Orion revision form is audited and the Demo URL / judge-facing fields are confirmed. |
| Deadline | TRACKED | Organizer confirmation states submissions close September 2, 2026 at 23:59 UTC. |

## Production proof checkpoint

Production URL: `https://termproof-mauve.vercel.app`

Stable production runtime checkpoint: `https://termproof-oyss0nfbg-shalyxs-projects.vercel.app`

Vercel deployment: `dpl_8bnBtrx1bhWNpC2pbEgxfZMwCF7u`

Source commit: `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`

The live production proof created case `229d0fd0-4553-49d9-baaf-024f6c520fb0` and established:

- initial deterministic disposition `NEEDS_EVIDENCE` with one precise open HTTP evidence request;
- supplied public HTTPS evidence re-fetched through the normal bounded HTTP adapter;
- exact case transition version `0 → 1` and disposition `NEEDS_EVIDENCE → VERIFIED`;
- evidence request state `OPEN → SATISFIED`;
- exact idempotent replay returned the stored result without a second transition;
- reuse of the same idempotency key with different evidence returned `IDEMPOTENCY_CONFLICT`;
- subsequent `get` returned the persisted `VERIFIED` case from PostgreSQL.

## Current judge-package blocker

The product, public source, identities, demo, registration, ignition, recovery, and AI vetting are complete. The remaining blocker is judge presentation:

1. open `Revise and Resubmit`;
2. confirm the Demo URL is explicitly present in the Orion submission;
3. confirm Features and all structured risk/economic fields are preserved and visible to the vetter;
4. use the revised description to foreground the non-substitutable proof-obligation mechanism rather than adapter inventory;
5. only then send the revised submission to DAO voting.
