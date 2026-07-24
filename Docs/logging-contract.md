# EGI Media AI Backend Logging Contract

Status: implementation contract for S49-S61.

## Purpose

Operational logs explain what happened in a running service. They are not a replacement for access audit events, business records, or metrics. Every log entry is structured JSON and must be safe to ship to a shared log collector.

## Levels

- `debug`: diagnostic detail enabled only when explicitly configured.
- `info`: normal lifecycle events and successful state transitions.
- `warn`: recoverable degradation, retry, fail-closed, stale data, or rejected business action.
- `error`: failed request, task, job, provider, persistence, or delivery operation.
- `fatal`: process-level failure that requires shutdown or operator intervention.

## Required common fields

`timestamp`, `level`, `service`, `environment`, `event`, `request_id` when request-scoped, `correlation_id` when available, `actor_type`, `tenant_id`, `company_id`, `task`, `entity_type`, `entity_id`, `error_code`, `retryable`, and `duration_ms` when relevant.

Fields may be `null`; fabricated identifiers are forbidden.

## Event families

Event names use lowercase `snake_case` and are stable API for operators:

- HTTP: `http_request_started`, `http_request_completed`, `http_request_failed`
- auth/scope: `auth_context_resolved`, `auth_rejected`, `scope_rejected`
- AI: `ai_task_started`, `ai_task_succeeded`, `ai_task_failed`, `ai_provider_rejected`, `ai_output_rejected`
- PDF/source: `pdf_upload_received`, `pdf_extraction_succeeded`, `pdf_extraction_failed`, `source_gate_failed`
- database: `database_query_failed`, `database_transaction_rolled_back`, `database_constraint_failed`
- queue: `job_enqueued`, `job_started`, `job_succeeded`, `job_retry_scheduled`, `job_dead_lettered`
- email: `alert_eligibility_evaluated`, `email_delivery_started`, `email_delivery_succeeded`, `email_delivery_failed`
- report/lifecycle: `report_generation_failed`, `review_transition_succeeded`, `review_transition_failed`

## Error fields

Errors must include the normalized `error_code`, safe public category, `retryable`, and a redacted `cause` object where available. Provider diagnostics may include status, provider error type/code, provider request ID, and response ID. Raw provider messages, prompts, PDF text, tokens, passwords, recipient addresses, and subjects are never logged.

## Security and privacy

The logger recursively redacts credentials and sensitive payload fields, strips control characters, and limits field size. Authorization headers, cookies, API keys, SMTP credentials, access tokens, passwords, prompt/source content, company context content, recipient values, and email subjects are redacted or represented by a stable hash where correlation requires it.

## Relationship to other telemetry

- Operational logs: runtime diagnosis.
- Access audit events: human/security accountability in the database.
- Metrics: aggregate rates and latency, never raw payloads.
- Traces: request/correlation identifiers connecting the three.

## Fail-closed rule

Logging failure must not expose secrets or change an authorization, AI, delivery, or approval decision. A logger must tolerate malformed metadata and missing error properties.
