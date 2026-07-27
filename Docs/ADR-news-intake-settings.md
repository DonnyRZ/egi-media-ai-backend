# ADR — News Intake Settings (Contract Lock)

| | |
|---|---|
| **Status** | **LOCKED (Sprint 0)** · Sprint 1 workers decouple **PASS** · Sprint 2 narrow RBAC/API **PASS** · Sprint 3 Automatic intake desired state **PASS** · Sprint 4 Recent runs observability **PASS** |
| **Date** | 2026-07-27 |
| **Owner** | News intake / Settings |
| **Code SoT (server start)** | `egi-media-ai-backend/src/app/server.js` → `_startAutomation` |
| **Code SoT (ingest API)** | `egi-media-ai-backend/src/routes/ingest.js` |
| **Code SoT (scheduler)** | `egi-media-ai-backend/src/automation/scheduler.js`, `scheduler-config.js`, `poll-enqueue.service.js`, `automatic-intake.controller.js`, `automatic-intake-settings.store.js` |
| **Code SoT (workers)** | `egi-media-ai-backend/src/automation/worker-runner.js`, `ingest/ingest.worker.js`, `source/crawl-ingest.service.js` |
| **Code SoT (fan-out)** | `egi-media-ai-backend/src/automation/pipeline-stage-dispatcher.js` |
| **Code SoT (RBAC)** | `egi-media-ai-backend/src/auth/rbac.js` |
| **Related** | `Docs/AI-Automation-Contract.md`, `Docs/ADR-news-feed-multisource-f0.md` |

**Purpose:** Lock product language, intake modes, and backend invariants before Settings UI (Sprint 5) and before RBAC/API shaping (Sprint 2+). This ADR is docs-only for Sprint 0; Sprint 1 implements worker/scheduler decoupling.

---

## 1. Product surface (EN copy lock)

Settings and operator UX **must** use business copy. Do **not** expose pipeline / ingest / scheduler jargon in primary UI labels.

| Locked EN label | Meaning | Forbidden synonyms in primary UI |
|---|---|---|
| **News intake** | Settings area / feature name for bringing articles into the issue pipeline | Pipeline, Ingest, Scheduler, Automation (as page title) |
| **Automatic intake** | Process-wide scheduled CMS poll (on/off + cadence later) | Scheduler enabled, cron, tick |
| **Pull articles now** | Manual trigger actions | Enqueue poll, Run ingest, Trigger job |
| **Recent runs** | Observable recent intake / job history | Job queue dump, Dead letters (unless secondary ops detail) |

Secondary technical detail (job ids, queue names) may appear in ops/debug views only, never as the primary Settings vocabulary.

---

## 2. Intake modes (locked)

### 2.1 Automatic intake = CMS poll only, process-wide scheduler

- **What it does:** On an interval, the process-wide scheduler enqueues bounded **EGI Media CMS** `poll` jobs (`cms.poll` / payload `mode: "poll"`).
- **What it does not do:** It does **not** schedule crawl media. It does **not** auto-fan-out crawl across the 17 adapters.
- **Scope of enablement:** `AI_SCHEDULER_ENABLED` (and future Settings **Automatic intake** toggle) is **process-wide**, not per-tenant UI chrome pretending to own the timer. Multi-tenant eligibility still gates *which companies* get scheduled poll enqueue (`MultiTenantIngestScheduler` + `listEligible()`).
- **Code today:** `PollEnqueueService.enqueuePoll` always uses CMS source name `egi-media-cms` and `mode: "poll"`. Scheduler never references crawl.
- **Watermark truth:** CMS watermarks are keyed by `source_name` + `locale` (`egi-media-cms` / locale) — **shared across companies**, not per-company. Scheduled ticks may enqueue one poll job per eligible company, but they advance the same CMS watermark store. Product copy must not imply independent per-company CMS cursors.

### 2.2 Manual = three explicit actions under **Pull articles now**

| Manual action | API mode / job | Source | Bound |
|---|---|---|---|
| EGI Media poll | `mode: "poll"` → `cms.poll` | CMS published list + watermark | One locale, bounded `limit` (1–100) |
| One crawl media | `mode: "crawl-poll"` → `crawl.poll` | Exactly one registered `crawl_source_id` | One media id from the 17; never “all crawl” |
| One article | `mode: "article"` → `cms.article.trigger` | Single published article via `IssueSourceResolver` | Requires `article_id` string: bare CMS UUID, `cms:<uuid>`, or `crawl:<source_id>:<hash>`; **`viral:…` rejected** |

All three use the **same ingest queue + worker path** (`POST /api/v1/internal/pipeline/ingest` today). Callers never submit article body/content. UI labels stay business copy; the internal path name may keep `pipeline/ingest` until a later rename sprint.

### 2.3 Crawl never auto-all-17

- Crawl ingest is **opt-in per media** via manual `crawl-poll` with a required `crawl_source_id` in `CRAWL_SOURCE_IDS`.
- There is **no** scheduler path that loops all 17 adapters.
- Silently fanning crawl to all 17 media is a **hard FAIL**.
- Viral remains News Feed only (`feeds_issues = false`); never an issue-pipeline intake source (see F0 ADR).

### 2.4 AI fan-out = all eligible companies (honest UX later)

After a successful snapshot, stage dispatch fans out relevance / pipeline work to **every eligible company** with effective Company Context (`PipelineStageDispatcher` → `companyStore.listEligible()`), not only the company that triggered the ingest API call.

**UX honesty (later sprints):** Settings / confirm copy must not imply “this company only” when the backend fans out to all eligible companies. Prefer language like “eligible companies” once the UI exists.

---

## 3. Worker vs scheduler (Sprint 1 direction — locked intent)

### Problem (verified in code)

`Server._startAutomation` constructs both `MultiTenantIngestScheduler` and `QueueWorkerRunner`, then:

```text
if (automation.enabled) { this.scheduler.start(); this.workerRunner.start(); }
```

`automation.enabled` maps from `AI_SCHEDULER_ENABLED`. Therefore **workers only run when the scheduler flag is on**.

### Failure mode

With `AI_SCHEDULER_ENABLED=false` (safe default in `.env.example`):

1. Manual **Pull articles now** (ingest API) returns **202** and enqueues jobs.
2. `workerRunner` never starts → jobs sit forever → **202-but-never-runs**.

### Required direction (Sprint 1) — **IMPLEMENTED**

- **Decoupled:** `resolveAutomationStart` starts scheduler only when `AI_SCHEDULER_ENABLED=true`; starts `workerRunner` when `AI_WORKERS_ENABLED` is not false (default **true**).
- Preserve existing behavior when **both** are enabled (scheduled ticks + workers).
- Scheduler remains behind `AI_SCHEDULER_ENABLED` (safe default: off).
- Do **not** invent a runtime Settings toggle for the process scheduler in Sprint 1 (docs note only; API later).

### Dead config note

`AI_SCHEDULER_CATCH_UP` is parsed into `config.catchUp` but **is not read by scheduler or workers** today. Treat as **dead config** until a catch-up sprint explicitly wires it. Do not imply catch-up is live in Settings copy.

---

## 4. Permissions (Sprint 2 — locked)

| Permission | Purpose | Granted to |
|---|---|---|
| `news.intake.read` | Status + Recent runs | `platform_superadmin`, `tenant_owner`, `tenant_admin`, `company_admin` |
| `news.intake.trigger` | Pull articles now | `platform_superadmin`, `tenant_owner`, `tenant_admin`, `company_admin` |
| `news.intake.manage` | Automatic intake desired on/off (Sprint 3+) | `platform_superadmin`, `tenant_owner`, `tenant_admin` only — **not** `company_admin` |

| Invariant | Rule |
|---|---|
| Internal ingest + automation status/jobs | Still require `ai.pipeline.run` + `trustedScope` |
| `tenant_owner` / `tenant_admin` | **Must not** receive `ai.pipeline.run` |
| `ai_worker` | Keeps `ai.pipeline.run` for machine actors; **no** `news.intake.*` |
| Human Settings | Use `/api/v1/news-intake/*` only — do not expose T02–T14 internals |

**Human API (Sprint 2):**

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/news-intake/status` | `news.intake.read` |
| GET | `/api/v1/news-intake/runs` | `news.intake.read` |
| POST | `/api/v1/news-intake/pull` | `news.intake.trigger` |
| POST | `/api/v1/news-intake/automatic` | `news.intake.manage` |

Pull reuses the same ingest enqueue/worker path as `POST /api/v1/internal/pipeline/ingest` (modes `poll` / `crawl-poll` / `article`). Idempotency-Key, locale ∈ {id,en,uz}, limit 1–100, registered `crawl_source_id`, and no article body fields remain mandatory.

**Automatic intake manage (Sprint 3):** `POST /api/v1/news-intake/automatic` body `{ "desired": true|false }` is **idempotent start/stop of the CMS poll scheduler only**. Workers are never stopped by this toggle. Status exposes `desired`, `actual_running`, `interval_ms`, `batch_size`, and last enqueue/error fields (plus S2 aliases `enabled`/`running`).

---

## 5. Hard invariants checklist (backend audit — attach & preserve)

Every News intake change **must** keep these true:

| # | Invariant | Evidence / SoT |
|---|---|---|
| H1 | **No watermark rewind** — if a poll throws before `watermarkStore.set`, the prior checkpoint remains; success may advance forward from observed data / page watermark only (never deliberately move backward) | `IngestWorker.poll`, `CrawlIngestService.pollSource`, AI Automation Contract |
| H2 | **Viral never enters issue pipeline** | F0 ADR; channel `feeds_issues=false`; ingest modes are poll / article / crawl-poll only |
| H3 | **Clients never submit article body** — reject `content` / `title` / `summary` / `article` fields on ingest trigger; workers fetch CMS/crawl | `routes/ingest.js` validation |
| H4 | **Keep `trustedScope`** on intake / automation operator APIs | `requireAuthContext({ trustedScope: true, ... })` |
| H5 | **Do not grant full `ai.pipeline.run` to all human admins** | `rbac.js` excludes it from `tenant_owner` / `tenant_admin` / `company_admin`; human Settings use `news.intake.*` |
| H6 | **Crawl never silently fans out to all 17 media** — one `crawl_source_id` per crawl-poll; no auto-all scheduler | `ingest.js`, `CrawlIngestService`, scheduler CMS-only |
| H7 | **Automatic intake = CMS only** — scheduler enqueues CMS poll jobs only | `PollEnqueueService`, `MultiTenantIngestScheduler` |
| H8 | **AI stage fan-out = all eligible companies** — honest product copy later | `PipelineStageDispatcher.dispatch` |
| H9 | **Workers must not be gated solely by scheduler enabled** — manual ingest must process when Automatic intake is off (`AI_WORKERS_ENABLED` default true; scheduler stays on `AI_SCHEDULER_ENABLED`) | `start-policy.js`, `server.js` `_startAutomation` (Sprint 1) |
| H10 | **Idempotent triggers** — Idempotency-Key required; replay safe | `routes/ingest.js`, queue job store |
| H11 | **Bounded limits** — locale ∈ {id,en,uz}; limit 1–100 | `routes/ingest.js` |
| H12 | **Crawl DB never written into editorial CMS `articles`** | F0 ADR hard rule |

---

## 6. Sprint map (sequential; audit PASS required)

| Sprint | Scope | Gate |
|---|---|---|
| **0** | This ADR — contract lock | Re-read vs code; Verdict PASS |
| **1** | Decouple workers from `AI_SCHEDULER_ENABLED` | Manual ingest runs with scheduler off; tests PASS |
| **2** | Narrow RBAC / API for News intake (no blanket `ai.pipeline.run`) — **IMPLEMENTED** | Permission audit PASS |
| **3** | Automatic intake desired-state persistence + manage/status — **IMPLEMENTED** | Contract + tests PASS |
| **4** | Recent runs pagination/filter hardening — **IMPLEMENTED** | Contract + tests PASS |
| **5** | Frontend Settings (list-first, locked EN copy, Lucide, tokens) | Design + copy audit |

Do not skip ahead. Prefer quality over rushing later sprints.

---

## 7. Acceptance (Sprint 0)

1. ADR exists under `egi-media-ai-backend/Docs/` and matches real code paths cited above.
2. EN copy lock table is present and mandatory for future FE.
3. Automatic vs manual modes are unambiguous; crawl auto-all-17 is forbidden.
4. Fan-out honesty and permission direction are recorded.
5. Hard invariants H1–H12 are attached.
6. Worker/scheduler decoupling is explicitly deferred to Sprint 1 with the 202-but-never-runs failure mode documented.
7. `AI_SCHEDULER_CATCH_UP` called out as dead config.

**Sprint 0 Verdict:** recorded in the implementing agent’s audit loop (must be **PASS** before Sprint 1 code).

---

## 8. Acceptance (Sprint 2)

1. `news.intake.read` / `news.intake.trigger` / `news.intake.manage` exist in `rbac.js` with the grant matrix in §4.
2. `tenant_owner` / `tenant_admin` / `company_admin` still **lack** `ai.pipeline.run`.
3. Human routes `/api/v1/news-intake/status|runs|pull` require trusted scope + narrow perms; pull reuses ingest enqueue with mode/locale/limit/crawl/content invariants.
4. Internal `POST /api/v1/internal/pipeline/ingest` remains `ai.pipeline.run` (machine/platform).
5. Swagger documents News Intake without collapsing into Internal Pipeline tags.
6. Audit tests: 403 without permission; 202 with `news.intake.trigger`; tenant_owner denied raw ingest/T02; S1 worker tests still pass.

**Sprint 2 Verdict:** PASS (implementing agent audit loop).

---

## 9. Acceptance (Sprint 3) — Automatic intake desired state

### Decisions

1. **Process-global desired boolean** for Automatic intake (phase 1). Not per-tenant chrome; eligibility still gates which companies receive scheduled CMS poll enqueue.
2. **Persistence:**
   - `AI_PERSISTENCE_MODE=postgres` → `ai.process_settings` (`0015_process_settings.sql`) via `PostgresAutomaticIntakeSettingsStore`.
   - Otherwise → host-local file (default `.data/automatic-intake-settings.json`, override `AI_AUTOMATIC_INTAKE_SETTINGS_PATH`) via `FileAutomaticIntakeSettingsStore`.
   - Tests / explicit `AI_AUTOMATIC_INTAKE_SETTINGS_MODE=memory` → in-memory only.
3. **Boot rule:** If a persisted desired value exists, it wins. `AI_SCHEDULER_ENABLED` is the **initial seed only** when no persisted desired state exists (written with `source: env_default`).
4. **Toggle semantics:** Manage API / controller start|stop **scheduler only**. Workers remain governed by `AI_WORKERS_ENABLED` / start-policy (S1 invariant H9).
5. **`AI_SCHEDULER_CATCH_UP`** remains **dead config** — not exposed on status/manage and not wired.

### Acceptance checklist

1. Manage without `news.intake.manage` → 403; `tenant_owner` / `tenant_admin` can toggle; `company_admin` cannot.
2. Disable Automatic intake → scheduler stops new CMS scheduled ticks; workers stay up; Pull articles now still returns 202 and processes.
3. Enable restores scheduler; scheduler path remains CMS poll only (no crawl schedule / no auto-all-17).
4. Restart restores persisted desired (file or postgres) per boot rule above.
5. `/api/v1/news-intake/status` exposes `desired`, `actual_running`, `interval_ms`, `batch_size`, last enqueue/error fields.
6. S1 + S2 regression suites still PASS; no watermark rewind; no `ai.pipeline.run` granted to human admins.

**Sprint 3 Verdict:** PASS (implementing agent audit loop).

---

## 10. Acceptance (Sprint 4) — Recent runs observability

### Decisions

1. **Company-scoped only:** `GET /api/v1/news-intake/runs` always lists with trusted `tenantId` + `companyId`. Missing company context is refused. No cross-company exfiltration.
2. **Ingest-family default:** Only `queueName=ingest` and job types `cms.poll` | `crawl.poll` | `cms.article.trigger`. Unrelated AI-task / pipeline jobs are excluded by default.
3. **Optional AI-task inclusion:** `include_ai_tasks=true` may include other company-scoped jobs; each item is labeled `family: "intake" | "ai_task"`. Still never dumps the global queue.
4. **Pagination:** `limit` default **20**, max **100**; `offset` (0…10000) **or** opaque `cursor` (mutually exclusive). Stable newest-first (`created_at DESC`, `jobId DESC` tie-break). Response includes `has_more`, `next_offset`, `next_cursor`.
5. **Validation:** Invalid `limit` / `offset` / `status` / `cursor` / `include_ai_tasks` → **400** `VALIDATION_ERROR` (no silent clamp for bad limit/status).
6. **FE-friendly item shape:** `id`, `when`, `source`, `mode`/`action`, `state`, `locale`, `crawl_source_id`, `job_type`, `family`, `reused` (null on list unless known), `created_at`, `updated_at`.
7. **Store filter push-down:** `InMemoryJobStore.list` / `PostgresJobStore.list` accept optional `queueName`, `jobTypes`, `limit`, `offset` so bounded pages do not require dumping the whole company queue to the API layer.

### Acceptance checklist

1. Bad `limit` / `cursor` / `status` → 400.
2. Default listing is newest-first, ingest-family only, bounded by `limit`.
3. Pagination via `offset` and via `next_cursor` advances correctly; `has_more` accurate.
4. Company A cannot see company B jobs (same or other tenant).
5. `news.intake.read` required; viewers/denied roles get 403.
6. S1–S3 regression suites still PASS; S2/S3 endpoints unchanged in behavior.
7. Swagger documents query params + enriched run/page schema.

**Sprint 4 Verdict:** PASS (implementing agent audit loop).

---

## 11. Sprint 5 next

Frontend Settings **News intake** page (list-first, locked EN copy from §1, Lucide, design tokens). No FE in Sprint 4.