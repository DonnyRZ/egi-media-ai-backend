# Seed and Bootstrap Policy

## Development

- The platform bootstrap account is configured through `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
- It is created as a platform operator only; no tenant or company is implied.
- Generic customer data is created only by the explicit `db:seed:generic` command with `SEED_GENERIC_TENANT=true`.
- Demo IDs are never read as fallback scope by runtime services.

## Staging

- Use a dedicated generic customer tenant and non-production credentials.
- Run migrations before seed.
- Seed must be idempotent and must not overwrite customer records outside its declared seed IDs.

## Production

- Never run the generic seed command.
- Bootstrap only the platform operator through controlled environment/secret provisioning.
- Provision customer tenants, companies, and memberships through the platform API with audit and idempotency keys.
- Reset procedures may archive a test tenant in a non-production environment, but may not delete or mutate another tenant's business data.
