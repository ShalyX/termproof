# Termproof brand implementation

**Name:** Termproof  
**Mark:** Condition Cut  
**Tagline:** Terms, tested.  
**Positioning:** Proof before release.  
**Mechanism:** Promise → Test → Evidence → Verdict

Condition Cut depicts an unresolved term moving through bounded evidence points into an earned resolution. The compact treatment combines the cut condition and terminal evidence point for clarity at favicon scale. It is not a checkmark, shield, lock, chain, or decorative blockchain symbol.

## Production palette

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#171715` | Primary text, decisive fields, inverse surfaces |
| Bone | `#F5F1E8` | Primary background and inverse foreground |
| Oxblood | `#7A2723` | Condition cut, restrained emphasis, failure state |
| Slate | `#50575A` | Technical neutral and supporting text |
| Warm gray | `#A69E91` | Rules, unresolved state, non-text structure |

Semantic state colors supplement the core palette: pass `#1F5B45`, needs evidence `#765619`, fail `#7A2723`, and neutral `#50575A`. Dark verdict surfaces use accessible state accents: pass `#7FBBA2`, fail `#E0AAA3`, needs evidence `#D6BD72`, and partial `#C3BEB4`. Statuses always include text labels and do not rely on color alone.

The tested foreground/background contrast ratios are Ink/Bone 15.93:1, Slate/Bone 6.53:1, Oxblood/Bone 8.70:1, pass 6.85:1, needs evidence 5.71:1, fail 8.20:1, and neutral 6.20:1. Warm gray is reserved for non-essential rules and structure, not required body text.

## Typography

IBM Plex Sans Variable is the production interface and editorial sans. IBM Plex Mono is restricted to hashes, addresses, evidence IDs, revisions, operations, and other code/data. Both are distributed under the SIL Open Font License 1.1 through pinned Fontsource packages.

## Assets

- `public/brand/condition-cut-primary.svg` — primary evidence-state mark on light surfaces.
- `public/brand/condition-cut-inverse.svg` — inverse mark on Ink.
- `public/brand/condition-cut-symbol.svg` — compact symbol-only treatment.
- `public/brand/termproof-lockup.svg` — horizontal name and tagline lockup.
- `public/brand/termproof-app-icon.svg` — square app treatment.
- `public/favicon.svg` — 32-unit favicon geometry optimized for 16–32 px rendering.

All marks use explicit vector paths and solid fills. They contain no generated raster tracing, effects, filters, or decorative gradients.

## Experience and motion system

The production interface extends Condition Cut into a native verification-machine graphic. A submitted condition enters unresolved, branches to the four bounded adapters, returns as attributable evidence receipts, and closes only when deterministic policy computes a verdict. The same geometry is reused for loading, evidence gaps, contradictions, partial resolution, and completed verdicts.

Motion is causal and one-shot: the input arrives, routes draw, adapter modules activate, evidence returns, and the policy orbit resolves. Persistent looping is limited to the active loading state. `prefers-reduced-motion` collapses the choreography to its final legible state and disables repeated motion.

The result surface has three disclosure levels:

1. claim, adapter route, proof receipt, and deterministic result;
2. extracted facts and receipt metadata;
3. full provenance and bounded raw observation.

The public form does not expose a canned control or fixture instructions. The Mandate A/B regression is kept in the test suite: the truthful health response must resolve, while changing only the expected `service` field to `mandate-agent` must produce a deterministic contradiction. The interface remains a general-purpose promise intake.
