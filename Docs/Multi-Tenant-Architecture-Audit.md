# Multi-Tenant Architecture Audit

Status: M01 completed / M02-M06 baseline

## Scope model

| Scope | Owner | Examples | Rule |
|---|---|---|---|
| Platform | EGI Media platform operations | platform operators, tenant provisioning | Never receives customer business data by default |
| Tenant | Customer workspace | tenant profile, memberships, billing metadata | Parent boundary for all customer data |
| Company | A legal/business entity inside a tenant | context, issues, alerts, reports | Every AI business record belongs to exactly one tenant and company |
| Actor | Human or service identity | user, platform operator, worker | Actor access is derived from token plus membership |

## Ownership rules

- `egi-media-backend` owns the source CMS database and exposes published article data read-only to AI.
- `egi-media-ai-backend` owns the `ai` schema, tenant/company access model, AI pipeline records, reports, alerts, jobs, and audit events.
- No AI business query may use an unscoped `company_id`; SQL predicates must include both `tenant_id` and `company_id`.
- A company ID is only unique inside a tenant. Cross-tenant access is denied even if an ID is guessed.
- A tenant-wide membership may read authorized companies, but it does not create a shared issue across companies.
- Platform operators manage provisioning and platform metadata; they do not silently become a customer company member.

## Hardcode audit

### Runtime hardcodes to remove or isolate

- `dummy-tenant`, `company-a`, and `dummy-actor` in backend auth and frontend session fallback.
- `demo-tenant`, `demo-company`, and configured pipeline scopes used as implicit customer identity.
- EGI email/name in local bootstrap auth. This remains configuration-only and is not a business scope.

### Allowed non-runtime fixtures

- Playwright fixtures may use synthetic IDs to exercise UI states.
- Integration tests may use isolated tenant/company IDs.
- Development seed may create a generic customer tenant, but it must be explicit and never run in production.

## Required boundary decisions

- Platform superadmin login without a tenant/company must land in platform administration/onboarding state, not a customer dashboard.
- A customer user without an active membership cannot query business endpoints.
- A user with multiple company memberships must choose an active company; the frontend cannot elevate scope by sending a different header.
- Pipeline scheduling must enumerate active companies with an effective context, rather than defaulting to one configured demo company.

## Findings

1. The access tables exist, but tenant/company lifecycle values are incomplete (`deleted` instead of `pending`/`archived` for tenants).
2. Company provisioning is missing as a generic API.
3. Platform superadmin is not provisioned into a customer tenant by design, which is correct, but the frontend does not yet represent this state.
4. Local auth is bootstrap-only; customer signup/invitation persistence is not yet a complete flow.
5. In-memory stores and fallback scopes are unsuitable as production defaults.
6. The scheduler currently supports configured scopes and a Postgres eligible-company store, but the local memory path still accepts configured scopes without validating tenant/company records.

## Exit criteria for M01

- Runtime hardcodes are classified as bootstrap, test fixture, or defect.
- Ownership and scope rules are documented.
- Follow-up implementation is tracked by M02-M20 rather than silently changing product behavior.
