# T02 Identity Relevance — Eval Spec v3 (FROZEN)

Frozen before implementation of recall/alias/body fixes.
Any harness that redefines metrics below is invalid. Verifier must reject self-grading.

## Problem class

v1 filtered cross-industry junk but leaked same-industry peers (market).
v2 stopped market leaks via name-only identity, but:
- eval was circular (gate scored against itself with stubbed LLM),
- self recall failed for body-only / brand / key-people mentions,
- metrics redefined flip-rate away from LLM stability.

v3 must prevent **both** market precision failures and self-recall failures, across industries.

## Issue formation policy (product)

| subject_relation | Forms issue? |
|------------------|--------------|
| self | Yes, if relevance ∈ {high, medium} |
| competitor | Yes only if `competitors` non-empty AND relevance ∈ {high, medium} |
| market | Never |
| unrelated | Never |

Legacy decisions without `subject_relation` → branch `stop` (fail closed).

## Identity evidence (deterministic gate)

Self/competitor evidence comes **only** from runtime `company_context.fields`:
- `name` (+ derived aliases)
- `brands_aliases` (named brands, properties, product lines)
- `key_people` (executives / public figures tied to the company)
- `competitors` (opt-in list)

Matching uses title + summary + cleaned body (same snippet window as T02 body option).
Matching is contiguous whole-word / whole-phrase — no bag-of-tokens, no substring false friends.
Industry/product token overlap alone → `market` or `unrelated`, never `self`.

Without any lexical entity hit, LLM claim of `self`/`competitor` is demoted (precision).
With lexical entity hit, relation is promoted to `self`/`competitor` even if LLM said market (recall).

## Anti-bias

No brand/industry strings in `src/ai/` prompts or gates.
All niche lives in company context data.
Automated grep must stay clean.

## Contexts

| Key | Role | Seen by builder during fix? |
|-----|------|-----------------------------|
| A | Hospitality (real Arunika-shaped fields + aliases) | Yes |
| B | Manufacturing/logistics + listed competitors | Yes |
| C | Fintech + listed competitors | Yes |
| D | Healthcare/education (sealed generalization) | No — verifier only |

Metrics must pass **per context**, not averaged.

## Golden set requirements

Minimum coverage dimensions (every cell must have ≥1 article per applicable context):

1. Name position: title / summary-only / body-only / absent
2. Entity type: legal name / brand alias / key person / ticker-like short alias (≥6 chars) / false-friend similar name
3. Relation: self / listed competitor / unlisted peer market / dual-entity / mention-in-passing
4. Content quality: normal / thin / placeholder / title=body
5. Topic: ops / regulation / macro / reputation crisis / peer press release
6. Language: id / en / mixed
7. Adversarial: body injection; fake self press release without entity; shared industry words only

Named regressions (must remain market, never form issue for A):
- Sutan Raja Hotel Mid Year Magic
- Rumah Makan Padang Heritage Weekend Market

## Prediction source (anti-circular)

Valid predictions for scored metrics MUST come from one of:

1. **Live**: full T02 production path (LLM + identity gate + overlap gate), with raw LLM outputs logged; or
2. **Compositional mock**: mocked LLM outputs drawn from a declared set of adversarial stubs
   (`always_self`, `always_market`, `gold_relation`, `random_continue`) then full production gates —
   scored against independent gold. Gate-only scoring with a single fixed stub is **insufficient** alone.

Forbidden: `predict() = applySubjectIdentityGate({ subjectRelation: "self", ... })` as the sole scored path.

## Metrics (definitions locked)

For each context key ∈ {A,B,C,D}:

| Metric | Definition | Pass |
|--------|------------|------|
| market_leak_rate | Among gold `subject_relation=market` OR `market_leak=true`, fraction where `should_form_issue=true` OR predicted relation=`self` | = 0% |
| junk_pass_rate | Among gold `junk=true`, fraction where `should_form_issue=true` | = 0% |
| signal_miss_rate | Among gold `signal=true` (must form issue), fraction where `should_form_issue=false` | ≤ 10% |
| self_body_miss_rate | Among gold cells `self` + `name_position=body_only`, fraction missed | ≤ 25% |
| relation_accuracy | Predicted `subject_relation` == gold | ≥ 90% |
| flip_rate | On stability subset (≥20 articles), 3 live LLM runs: fraction where majority relation differs from any run's relation (or class changes continue↔stop) | ≤ 5% |
| injection_fail_rate | Adversarial injection articles that change stop→continue vs sanitized twin | = 0% |

Flip-rate measured only in live mode. Compositional mode reports N/A for flip_rate and must still pass all other metrics.

## Stop criteria

All metrics green on A, B, C **and** sealed D.
Permanent unit + golden tests in repo.
Anti-bias grep clean.
E2E: market peers do not form issues; synthetic self (name/brand/person in body) does form/continue.

## Version

- Spec id: `T02_IDENTITY_EVAL_V3`
- Frozen at: 2026-07-28
