# Termproof architecture

## Flow

1. The original promise is independently audited by the capability-oriented supported-predicate registry, then normalized into a complete acceptance-term ledger with stable IDs, source spans, entities, proof obligations, canonical verifier operations, and extraction origin before it is planned.
2. The provider-neutral production planner is preflighted. Gemini is primary and uses structured JSON-schema output; DeepSeek is the bounded fallback for Gemini timeout, rate-limit, 5xx/outage, empty output, or malformed JSON after retry. Both providers are parsed into the same canonical plan and pass the same deterministic semantic coverage gate.
3. Each term is assigned a proof obligation (presence, content, structure, runtime, on-chain state/event, behavioral trace, protocol object, or human review) before routing. A capability registry validates that the selected adapter can establish that obligation; a weaker proxy cannot count as coverage.
4. The orchestrator groups identical HTTP request fingerprints within one run into one bounded observation sequence, then evaluates all dependent assertions against that immutable response. Different methods, headers, bodies, URLs, runs, and resumes remain isolated.
5. Adapters fetch bounded observations and emit evidence records.
6. Deterministic coverage reconciles the source-predicate audit against the ledger and the plan. Deterministic policy evaluates each claim and then the milestone. `VERIFIED` requires both source-predicate completeness and complete required-term coverage with all required claims passing; a missing or mismatched predicate returns `NEEDS_EVIDENCE / LEDGER_INCOMPLETE`.
7. The UI displays coverage, proof obligation, selected capability, evidence lineage, the result, and the evidence ledger; it does not calculate verdicts.

## Trust boundaries

- The planner is untrusted orchestration. It cannot emit verdict fields or set results.
- There is no production demo, mock, heuristic, fixture, or locally generated fallback. If no provider returns a valid complete plan, verification stops with `PLANNER_UNAVAILABLE` and no verdict. A semantically invalid primary plan does not trigger provider-shopping.
- Acceptance coverage is a separate deterministic gate: every normalized term remains visible with exactly one disposition and a term → claim → step mapping.
- The supported-predicate audit is a second, independent gate. It registers canonical predicate families against capabilities and operations (including repository/file presence, HTTP status/JSON/fields, npm state, EVM chain identity, contract bytecode, transaction existence, and receipt success). A detector may add a deterministic term, but the planner cannot define the complete promise.
- Proof strength is explicit. `file exists` is not `implements a worker`; a repository/config proxy is not runtime behavior; a chain name is not a transaction/event; and a protocol name is not protocol-object evidence.
- GitHub, HTTP, RPC, and npm responses are untrusted data, never instructions.
- Only configured RPC endpoints for allowlisted EVM profiles are used; planner text cannot choose arbitrary RPC hosts.
- Policy code is the only component that transforms step results into claim or milestone dispositions.
- Planner provenance records the actual provider, model, primary/fallback role, non-secret failover reason, planner timestamp/version, and plan hash. Provider secrets never enter the plan, evidence, API response, or client bundle.

## Resumable verification

Cases are currently in-process records. `start` executes available steps and records open evidence requests. `resume` validates the case, claim, step, adapter, and allowed evidence fields before re-running only that step. Existing ledger entries remain attributable as `initial` or `supplied`; concurrent resume calls for one case are rejected.

## Adapters

- GitHub uses the canonical public GitHub API and validates the repository host.
- HTTP permits public HTTPS only, rejects credentials, fragments, private-network textual targets and known DNS aliases, does not follow redirects, bounds bodies, validates JSON fields without executing response content, and times out.
- EVM verification uses allowlisted Base, Base Sepolia, and Arc Testnet profiles with chain-ID identity checks, bounded RPC responses, strict JSON-RPC response correlation, and shared `eth_chainId`, `eth_getCode`, transaction, receipt, log, and ERC-20 Transfer primitives. Base remains a compatibility name for the protocol-neutral EVM adapter; Arc-specific values are profile metadata, not adapter branches.
- EVM proof strength is separated: chain identity, deployed bytecode at an address, transaction existence, and receipt success are independent obligations. `transaction_exists` cannot satisfy receipt success, and source-file or chain evidence cannot satisfy `contract_code_exists`.
- GitHub source checks are bounded static inspection only: presence, non-empty content, literal source content, declaration presence, and a bounded delimiter/syntax scan. Source is never compiled, imported, evaluated, installed, or executed.
- npm uses the fixed public registry origin, validates package names, bounds metadata, and never installs or executes packages.

## Deployment

The app is deployed as the Sites/Vinext production artifact. No D1 or R2 data store is required by the verifier. Runtime secrets are environment configuration, not source or client data.
