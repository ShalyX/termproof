# Termproof evidence and provenance model

Each run records the complete chain:

`promise → plan → verifier → source/revision → observation → extracted facts → evidence hash → deterministic result → milestone disposition`

The provenance envelope records run version, verifier version, policy version, actual planner provider/model, primary or fallback role, non-secret failover reason when applicable, planner timestamp/version, plan hash, source-promise hash, supported-predicate-audit hash, promise, plan, acceptance coverage, and milestone disposition. Acceptance coverage is an immutable term map: each normalized term has exactly one disposition, proof obligation, selected capability, evidence-established IDs, explicit claim/step mappings, canonical predicate type, proof operation, source span, and extraction origin. Each evidence record records claim and step identity, adapter, source, revision, observation, extracted facts, observation time, evidence hash, step result, and the attached provenance.

For HTTP, one request fingerprint maps to one immutable point-in-time observation per verification execution. Derived status, JSON-validity, body, and field receipts retain the observation ID, canonical request fingerprint, raw-response hash, and observation timestamp. An observation outage makes all dependent assertions `INCONCLUSIVE`; a successfully observed contradictory response remains a deterministic `FAIL`. A resume creates a new observation and never rewrites or silently reuses an earlier receipt.

Evidence is created from canonical structured data and frozen after provenance is attached. A caller or model cannot rewrite the recorded observation or result. Resumed evidence is marked `supplied`; earlier evidence remains marked `initial` and remains attributable.

The ledger proves what the configured verifier observed at a point in time and which production planner/model and policy version produced the plan and result. It does not prove that a provider will return the same response later or that an inherently subjective claim is objectively true. A missing planner never creates a plan or verdict.
