# Termproof threat model

## Assets

- deterministic verdict integrity;
- evidence provenance and attribution;
- provider credentials;
- worker availability and safe network egress;
- public-facing error containment.

## Threats and controls

### Prompt injection and deceptive content

Milestone text, README content, API bodies, and npm metadata are treated as data. The planner has a constrained schema and no result or verdict fields. Adapter output is passed to deterministic policy; fetched text is never executed as instructions.

### SSRF and network confusion

HTTP accepts HTTPS URLs only, rejects credentials and fragments, blocks loopback/private/link-local/local/internal forms and known DNS aliases, rejects redirects, and applies bounded timeouts and bodies. Allowlisted EVM RPC endpoints are deployment-controlled and only bounded JSON-RPC methods are allowed.

### False results during outages

Timeouts, malformed payloads, redirect refusal, oversized responses, rate limits, and upstream failures become `INCONCLUSIVE`, not deterministic `FAIL`. Required unresolved claims produce `NEEDS_EVIDENCE`.

### Evidence tampering and replay

Evidence is canonicalized and hashed. Provenance is attached before records are deeply frozen. Resume validates the open claim/step and rejects unsupported fields, wrong adapters, closed requests, and concurrent resumes.

### Arbitrary execution

The verifier does not clone repositories, run repository code, install npm packages, import package code, evaluate response bodies, or execute contract bytecode.

### Secrets

Gemini, DeepSeek, and GitHub credentials are server-side environment variables. `.env*` files are ignored except for the empty `.env.example`; secrets are not returned in evidence, provenance, API responses, logs, or client bundles.

## Residual limitations

- Public provider availability and rate limits can require another run.
- A GitHub license check proves the detected repository license, not legal compliance of all dependencies.
- Contract bytecode proves deployment on the configured network, not safety or functional correctness.
- Subjective acceptance criteria require an explicit deterministic test and otherwise remain unresolved.
