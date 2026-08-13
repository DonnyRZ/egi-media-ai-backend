-- Company provisioning has no separate setup/approval step in the product flow.
-- Existing pending companies must therefore be usable company scopes.
UPDATE ai.companies
SET status = 'active', updated_at = now()
WHERE status = 'pending';
