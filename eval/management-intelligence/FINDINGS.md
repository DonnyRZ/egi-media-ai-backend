# Root-cause findings — production T02 materiality

Generated from Phase 0–2 of the management-intelligence audit loop.

## Method mismatch (confirmed)

| Variable | Production VPS | Live eval harness |
|---|---|---|
| `T02_INCLUDE_BODY_SNIPPET` | `false` | `true` |
| Context | Real Arunika fields (broad priorities) | Synthetic Northstar |
| Negative evidence | Absent | Often explicit (“It states no…”) |

Conclusion: green live-eval alone is **not** evidence of production correctness.

## Phase 1 — baseline replay (production-matching)

Reproduce rate vs stored production decisions: **0.60**.

- Strong TP stable: Sutan Raja, Badung.
- Weak FP unstable: water heater / Apindo / IHSG often flip medium↔low across runs.
- Mangrove and peer-dining (Padang) also sit on the boundary.

## Phase 2 — ablation

| Mode | FP-1 water heater | FP-4 mangrove | TP-1 Sutan Raja | TP-3 Padang |
|---|---|---|---|---|
| baseline | often continue | unstable | keep | unstable keep |
| with-body | continue (worse) | continue (worse) | keep | **false stop** |
| synthetic-context | still continue | stop/unstable | keep | keep/unstable |
| strip-broad-priorities | **stop** | stop | keep | **false stop** |
| explicit-negative-summary | stop | stop | keep | **false stop** |

### Hypotheses

- **H1 body snippet:** rejected as primary cause. Body-on hurts precision/recall.
- **H2 broad context fields:** partially confirmed. Stripping broad priorities stops water heater, but also kills Padang.
- **H3 synthetic eval:** confirmed. Explicit negatives make FP look solved while production articles remain ambiguous.
- **H4 merge/stochasticity:** confirmed. Production FP-2/3/4 and TP-3 all continued on a **2/3 medium majority with one low vote**. Replay can invert that draw.

## Root cause (combined)

1. Model scores weak macro/vendor/topic-overlap articles as `medium` often enough to win a 2/3 majority.
2. Broad aspirational company-context priorities amplify that tendency, but are not the only driver.
3. Eval harness overstated success by not matching production inputs.

## Fix direction (Phase 3)

Do **not** rely on prompt wording alone.

1. Add a **deterministic market-materiality gate** after identity gating:
   - Keep continuing `market` only when evidence has a direct hook to concrete context fields (product/industry peer action, region+project/regulation, dependency, or listed competitor).
   - Demote otherwise to `low`/`none`.
   - Must remain industry-neutral (runtime fields only).
2. Align live eval with production (`includeBodySnippet: false`) and keep `production-cases.json` as regression.
3. Re-test production cases before deploy.

## Phase 3 — implemented

- `applyMarketMaterialityGate` (`market-materiality-gate.js`), fingerprint gateStack `v15-pre-identity-cleanup` (was `v14-market-materiality-gate`), T02 prompt **1.9.2**.
- Pre-identity cleanup (2026-07-31): removed dead continue-path `applyContextOverlapGate` demotion + stub provenance; `context-overlap-gate.js` is lexical helpers only; dropped deprecated `branchForRelevance`; destination keep is operating-regions + project + demand (not hospitality-industry gated).
- Demote continuing `market` without a direct context hook.
- **Upgrade path:** if the model returns low/none for `market` but title/summary already show peer-family/product + commercial action, promote to `medium` (rescues stochastic Padang-style FN).
- **Not** upgraded on region/project alone (would promote local roadworks).
- Project/reg regex tightened: bare `jalan`/`proyek` removed so local road repairs in a listed city do not count as material infrastructure.

## Phase 4 — review status

- Unit tests for gate (including upgrade + FP/TN non-upgrade + TN-2 demote): green.
- Production replay (`replay-production.js` baseline): **10/10 matchExpected**, 0 FP, 0 FN.
- Live eval critical set (A peer/dining/regulation/negatives + B manufacturing + C fintech): green (C retried after transient provider error).
- Deployed `c2a3e41` to VPS; active issues reduced to Sutan Raja, Badung JLS, Rumah Makan Padang.
