# EGI Media AI SaaS Access-Control Contract

## Scope

EGI Media AI is a multi-tenant SaaS product. EGI Holding is one possible customer tenant, not a platform-level owner. A tenant may contain multiple companies. Every customer read or write is scoped by tenant and, where applicable, company.

## Actor types

- `human`: authenticated customer or platform user.
- `service`: authenticated backend service.
- `ai_worker`: service identity used only for approved AI pipeline tasks.

AI output is never a human approval identity.

## Roles

- `platform_superadmin`: provider-internal platform operations; not a customer role.
- `tenant_owner`: owns one customer tenant and has tenant-wide administration rights.
- `tenant_admin`: administers users, companies, and tenant policy within one tenant.
- `company_admin`: administers one or more assigned companies.
- `executive`: reads intelligence and approves/shares reports.
- `executive_viewer`: reads intelligence without review/approval authority.
- `analyst`: prepares Company Context, reviews intelligence, submits reports, and performs constrained rewrites.
- `reviewer`: reviews and approves report content according to tenant policy.
- `viewer`: read-only customer access.
- `ai_worker`: machine identity for pipeline tasks; never approves, shares, manages users, or chooses recipients.

## Scope rules

- A tenant-wide membership has `company_id = null`.
- A company membership has a concrete `company_id` belonging to the same tenant.
- A company switcher may only select a company returned by the backend authorization projection.
- Request headers and frontend state never grant scope. JWT identity plus backend membership is authoritative.
- Cross-tenant access always returns `403` without disclosing resource existence.

## Human-only decisions

The following permissions require `actor_type = human` and an authorized membership:

- `company_context.approve`
- `report.approve`
- `report.share`
- `report.rewrite`

## Service restrictions

`ai_worker` may invoke only internal pipeline permissions. It cannot approve or share reports, mutate user access, access billing, select recipients, select email subjects, or send a business decision.

## Error contract

- `401 UNAUTHORIZED`: no valid authenticated actor.
- `403 FORBIDDEN`: actor is authenticated but lacks tenant/company membership or permission.
- `409 VERSION_CONFLICT`: authorized mutation used a stale version.

## Authorization source of truth

Production authorization is resolved from backend membership persistence. JWT claims carry identity and an optional requested scope for routing, but frontend-provided role or permission claims are not trusted as an access grant. Development dummy auth is explicitly limited to local UI preview.
