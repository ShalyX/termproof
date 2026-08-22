# Termproof deployment proof

This document ties a stable public Vercel deployment to the exact public Git commit that produced it.

## Runtime checkpoint

- Production alias: `https://termproof-mauve.vercel.app`
- Stable deployment URL: `https://termproof-oyss0nfbg-shalyxs-projects.vercel.app`
- Vercel deployment ID: `dpl_8bnBtrx1bhWNpC2pbEgxfZMwCF7u`
- Vercel project: `termproof`
- Deployment target: `production`
- Deployment state at verification: `READY`
- Deployment source: GitHub
- Repository: `ShalyX/termproof`
- Branch: `main`
- Git commit: `cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`
- Git commit verification: verified

Vercel deployment metadata for this immutable deployment identifies the repository, `main` branch, and exact commit SHA above. The production alias may later move to packaging-only commits, but this stable deployment URL remains the runtime checkpoint used for the production black-box evidence below.

## Production black-box durability checkpoint

Case: `229d0fd0-4553-49d9-baaf-024f6c520fb0`

The external production proof established:

1. `start` returned `NEEDS_EVIDENCE` with one precise open HTTP evidence request.
2. A supplied public HTTPS source was re-fetched through the normal bounded HTTP adapter.
3. The case advanced exactly `0 → 1` and `NEEDS_EVIDENCE → VERIFIED`.
4. The request advanced `OPEN → SATISFIED`.
5. Exact idempotent replay returned the stored result without a second transition.
6. Reusing the same idempotency key with different evidence was rejected with `IDEMPOTENCY_CONFLICT`.
7. A subsequent `get` returned the persisted `VERIFIED` case from PostgreSQL.

The verifier semantics exercised by this checkpoint are the same semantics described in the public repository at the linked commit.

## Judge links

- Live product: `https://termproof-mauve.vercel.app`
- Demo: `https://youtu.be/2iZw2vNTgE4`
- Source commit: `https://github.com/ShalyX/termproof/commit/cb2d4e26bcb3b7d6edf1476270f3874a4a0eedba`
