# Tenant Provisioning Contract

## Tenant lifecycle

`pending -> active -> suspended -> archived`

- `pending`: created but not ready for customer use.
- `active`: customer may access permitted companies.
- `suspended`: access and pipeline processing are blocked.
- `archived`: immutable historical boundary; no new memberships or business writes.

## Company lifecycle

`pending -> active -> suspended -> archived`

Company IDs are unique within a tenant. A company never belongs to two tenants.

## Membership lifecycle

`invited -> active -> suspended -> revoked`

Only active memberships authorize customer business access. Platform operators are represented separately in `platform_operators` and are not customer memberships.

## Provisioning invariants

- Creating a tenant does not create an EGI Holding company.
- Creating a company requires an existing tenant and creates no cross-tenant alias.
- Creating a tenant owner membership requires an existing user, tenant, and optionally a company.
- A tenant-wide membership (`company_id = NULL`) may enumerate companies in that tenant but the request still needs an explicit active company for company-scoped business APIs.
- Every mutating provisioning request requires an idempotency key and is auditable.

## API contract summary

- `GET /api/v1/platform/tenants`: platform-superadmin only.
- `POST /api/v1/platform/tenants`: create a pending tenant; platform-superadmin only.
- `PATCH /api/v1/platform/tenants/:tenantId`: lifecycle transition; platform-superadmin only.
- `GET /api/v1/platform/tenants/:tenantId/companies`: platform-superadmin only.
- `POST /api/v1/platform/tenants/:tenantId/companies`: create a pending company; platform-superadmin only.
- `PATCH /api/v1/platform/tenants/:tenantId/companies/:companyId`: lifecycle/name update; platform-superadmin only.
- `POST /api/v1/platform/tenants/:tenantId/owner`: create or activate a tenant owner membership.
- `GET /api/v1/companies`: customer-visible authorized company list.

All response fields use snake_case at the HTTP boundary. Errors use the existing `{ success:false, error, meta }` envelope.
