# S47 — UI Contract and Visual Audit

Status: completed for the current implemented route set.
Date: 2026-07-24

## Verified

- Frontend endpoint registry is checked against implemented backend routes.
- API mappers preserve backend pagination, status, version, and error envelopes.
- Company Context uses PDF as the primary source flow; URL and text are explicit alternatives.
- Effective context is read-only; draft editing and approval are separate human-gated actions.
- Context arrays, missing fields, report narrative, report issue packs, metrics, and activity are rendered as readable fields/lists rather than raw JSON blocks.
- Loading, empty, unauthorized, forbidden, conflict, stale, provider failure, and retry states exist for the main API-backed views.
- Responsive drawer/sheet behavior, focus handling, labels, reduced-motion support, and touch-size controls are included in the frontend foundation.
- A production build and frontend API/contract tests pass after the audit changes.

## Manual browser check still required for S48

The browser must still be used for the final human acceptance pass: sign in as a customer owner, open Company Context draft, upload a real PDF, wait for the provider response, review/approve, switch company, and verify dashboard/report/alert states. This is an acceptance activity, not a substitute for backend contract tests.
