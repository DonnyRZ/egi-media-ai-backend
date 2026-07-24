# Multi-Tenant Scalability Readiness

## Data and query boundaries

- All customer-owned tables carry `tenant_id` and `company_id` where the domain is company-scoped.
- Composite scope indexes cover issue reads, analysis/priority joins, queue jobs, pipeline state, reports, alerts, and context selection.
- Pagination remains backend-owned; frontend never re-ranks or loads an unbounded tenant dataset.

## Pipeline scaling

- CMS polling is source-wide and read-only; a published source snapshot is fanned out to every active company with an effective context.
- Each company receives an independent pipeline state and queue task identity.
- A job idempotency key includes source snapshot and company scope.
- Scheduler eligibility is discovered from provisioned companies, not from an EGI/demo default.

## Cost and rate boundaries

- `tenant_ai_usage_events` records task/model/token usage by tenant and company.
- `tenant_rate_limit_windows` is the persistence boundary for future per-tenant rate and budget enforcement.
- AI provider failures remain retryable only according to the existing provider policy; retries must not bypass tenant budgets.

## Operational correlation

Every request, job, pipeline state transition, and AI provenance record must retain request/correlation/trace identity plus tenant/company scope when available. Platform operations may observe aggregate metadata, but raw customer business content remains company-scoped.
