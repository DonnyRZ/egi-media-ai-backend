# AI Automation Contract

Status: engineering baseline for S31–S50

## Scope

Automation discovers published articles from `egi-media-backend`, stores validated source snapshots, and dispatches company-scoped AI work. The scheduler owns timing only. CMS access, source validation, queue processing, AI task execution, alert eligibility, and report creation belong to workers/services.

## Source and fan-out model

- CMS is read-only source of truth.
- Scheduled polling is source-scoped, not company-scoped.
- Each published article/locale/content version is snapshotted once.
- The validated snapshot is fanned out into separate relevance jobs for each eligible company with an effective Company Context.
- The same article may produce different company-scoped relevance, issue, analysis, priority, alert, and report branches.
- Scheduler/API callers never submit article content; workers fetch it from CMS.

## Trigger and checkpoint policy

- Automatic scheduling is disabled unless explicitly enabled.
- Automatic ticks enqueue bounded `cms.poll` jobs; they never call CMS directly.
- Manual `poll` and single-article `article` triggers use the same queue and worker path.
- Polling is independent per configured locale and uses its persisted watermark/cursor.
- A failed poll never advances its checkpoint.
- Overlapping polls for the same source/locale are suppressed.
- Retryable CMS/provider/database failures use bounded backoff; non-retryable validation/business failures are dead-lettered.
- Replaying the same trigger is idempotent.

## Eligibility and scope

- Only published, non-deleted CMS articles pass the source gate.
- A company branch requires an effective Company Context.
- Source snapshots are tenant-independent; relevance and all downstream records are tenant/company scoped.
- A missing/stale Company Context stops that company branch without blocking other companies.

## Queue and pipeline contract

Every job carries tenant/company scope where applicable, source or aggregate ID, locale, stage/task, input version/fingerprint, idempotency key, trace/correlation ID, and retry metadata. Legal queue outcomes are `queued`, `running`, `succeeded`, `retrying`, and `dead_letter`.

```text
scheduled poll → source snapshot → T02 relevance → T03 optional rationale
→ T04 match → T05 title → T06 one-liner → T07 analysis → T08 labels
→ T09 priority → T10 reason → alert/report boundary
```

`none` relevance stops that company branch. AI never chooses recipient, subject, channel, Top 5, or human approval/share decisions.

## Open operational decisions

Final cadence, enabled locales, downtime catch-up, numeric retry/timeout/cost/concurrency limits, material-update definition, withdrawal reconciliation, and report timezone/period schedule remain configuration/product decisions. Until configured, defaults are safe: scheduler disabled, bounded polling, fail-closed validation, no watermark advance on failure, and no automatic email/report sharing.

## Acceptance criteria

1. A scheduler tick only enqueues an idempotent poll job.
2. Concurrent ticks cannot create overlapping polls for the same source/locale.
3. A poll fetches only published source data and checkpoints only after successful processing.
4. One source snapshot can fan out into independently scoped company jobs.
5. Failure in one company branch does not leak or block another company branch.
6. Restart/retry does not duplicate snapshots, evidence, issues, alerts, or reports.
7. Automation status is observable without exposing secrets or raw prompts.
