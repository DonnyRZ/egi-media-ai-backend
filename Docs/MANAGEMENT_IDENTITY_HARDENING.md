# Management identity hardening notes

## Feature flags

| Flag | Default | Effect |
| --- | --- | --- |
| `T07_PERSPECTIVE_REVIEW` | on (`!== "0"`) | When `0`, skip T07 management-perspective review and persist primary analysis. Keep review code until correction rate proves low. |
| `T02_CONSENSUS_CALLS` / `T02_DUAL_CALL` | consensus on | Do **not** lower consensus solely because identity landed. Revisit only after branch-flip metrics stay green on production-cases + multi-industry eval. |
| Identity generate path | sync on activate (T01-like timeout) | Activate still succeeds if identity fails (`status=failed`). Intake stays blocked until `ready`. |

## Intake hard-require (current policy)

- Manual Pull and internal ingest enqueue **require** management identity `ready` for the effective context version (`MANAGEMENT_IDENTITY_REQUIRED`).
- Automatic intake eligibility JOINs `management_identities.status='ready'`.
- T02 `_validateEffectiveContext` fail-closes without trusted identity.
- Judgmental prompt stamp (`leadershipSystemPreamble`) throws without identity — no soft fallback.
- Approve/replace may persist context when identity draft fails; operators retry via `POST /companies/:id/context/management-identity/retry`.
- `DELETE /companies/:id/context` archives effective context; intake remains blocked until a new context + identity are ready.

## Gates (do not regress)

- `applySubjectIdentityGate` and `applyMarketMaterialityGate` stay authoritative for continue/stop.
- Persona must not replace those gates.
- Do not thin T02 indifference/materiality rubrics until eval evidence exists.

## Optional async identity (future)

v1 generates identity synchronously after context activate with a T01-like timeout.
If approve latency becomes painful:

1. Persist `pending` immediately on activate.
2. Enqueue identity draft job; upsert `ready` / `failed`.
3. FE already can poll identity status on GET context / news-intake status.
4. Intake remains blocked until `ready` (no silent fallback).

## Eval checklist

- `node scripts/check-management-identity-quality.js`
- `node --test test/management-identity-readiness.test.js`
- Keep `eval/management-intelligence/production-cases.json` as hospitality pilot regression.
- Multi-company offline fixtures: `eval/management-intelligence/identity-quality-cases.json` (fintech + manufacturing fakes; not prompt hard-codes).
