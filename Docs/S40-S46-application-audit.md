# S40–S46 Application Audit

Status: implementation audit completed; live full-flow gate remains explicit.
Date: 2026-07-24

## S40 — Authentication and onboarding

- Signup and login use persistent AI-database accounts when `AI_PERSISTENCE_MODE=postgres`.
- Tenant/company provisioning is platform-authorized and generic; it does not require an EGI Holding company.
- Membership resolution is tenant/company scoped and role-derived by the backend.
- Frontend session state stores the bearer token in memory and uses the backend session endpoint for authorization refresh.
- Platform superadmin without a customer membership is represented by the platform control-plane route, not silently mapped to a customer dashboard.

Evidence: `multi-tenant-provisioning.test.js`, `rbac-access-control.test.js`, `rbac-membership-api.test.js`, `scripts/multi-tenant-readiness-gate.js`.

## S41 — Article ingest

- CMS access is read-only and limited to published, non-deleted articles.
- Citation URLs include the requested locale.
- Polling uses a watermark, source snapshots, bounded batches, idempotent jobs, and per-company pipeline scope.
- Scheduler configuration is explicit; failures do not advance the watermark.

Evidence: `s31-35-automation.test.js`, `s38-40-pipeline-automation.test.js`, `source-boundary.test.js`, `failure-recovery.test.js`.

## S42 — AI issue pipeline

- Relevance, rationale, matching, title, one-liner, analysis, claim labels, priority, and priority reason remain separate tasks.
- `none` relevance stops downstream issue formation.
- Finished issues are not silently reopened.
- Analysis becomes current only after citation and claim-label validation.
- Top 5 is not produced by an AI task.

Evidence: golden task suite, S08–S14 endpoint tests, citation-gate tests, and `test:golden`.

## S43 — Dashboard and search

- Executive Summary is backend-owned Top 5 ranking.
- Issue search/detail reads are not limited to Top 5.
- Period, priority, status, pagination, empty, error, and stale-state contracts are represented in the frontend.

Evidence: `s12-dashboard-read.test.js`, `dashboard-service.test.js`, frontend `test:api`, and frontend `test:contract`.

## S44 — Alerts

- Eligibility is backend rules only: preference, priority, quiet hours, dedupe, and the unresolved material-update policy.
- T12 creates only constrained blurb content; recipient and subject remain backend-owned.
- Gmail delivery is template-based, audited, idempotent, retry-aware, and fail-closed.
- Header, recipient, subject, and CRLF injection are rejected or neutralized.

Evidence: `alert-eligibility.test.js`, `email-delivery.test.js`, `s26-security-regression.test.js`, and S25 integration test.

## S45 — Reports

- Report drafts are period-specific and built from validated issue/insight packs, not raw articles or dashboard Top 5.
- T13 Mini narrative is citation- and period-gated.
- Review, approval, and sharing require human authorization and version checks.
- T14 is limited to a human-selected span and preserves the citation set.

Evidence: `report-lifecycle.test.js`, `s16-report-draft.test.js`, `s17-real-mini.test.js`, and `t14-constrained-rewrite.test.js`.

## S46 — Multi-tenant and multi-company regression

- Every AI business record is scoped by both `tenant_id` and `company_id`.
- The same company ID in different tenants remains isolated.
- The same article can be processed into separate company branches.
- Context, issue, dashboard, alert, and report reads reject cross-scope access.
- Pipeline discovery uses active companies with effective context rather than a configured EGI company.

Evidence: `multi-tenant-provisioning.test.js`, `s26-security-regression.test.js`, `s38-40-pipeline-automation.test.js`, and `multi-tenant:gate`.

## Current local database observation

The local Postgres instance is reachable and contains the AI schema plus the CMS source schema. It currently contains multiple generated acceptance tenants and companies, published source articles, effective contexts, issue rows, snapshots, and queued jobs. Those rows are test/acceptance history, not a claim that every source article has completed the live AI pipeline.

## Remaining acceptance boundary

The automated suite proves contracts and isolation. A final S48 live run must still be executed against one clean customer scope with a published CMS article and real provider calls, then verify the resulting issue, priority, alert audit, and report lifecycle end to end. It must not use the existing generated fixture rows as its success signal.
