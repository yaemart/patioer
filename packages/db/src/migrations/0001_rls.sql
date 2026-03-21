-- Enable Row Level Security on all tenant-scoped business tables.
-- The `tenants` table is intentionally excluded: it serves as a metadata lookup
-- table accessible before a tenant context is established (see ADR 0001).
--
-- Policies use fail-closed `current_setting('app.tenant_id')` (no second arg).
-- If `app.tenant_id` has not been SET for the current transaction the call
-- raises an error, preventing accidental cross-tenant data leakage.

ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

-- Each policy name includes the table name so pg_policies is self-documenting.
-- The application always calls SET LOCAL app.tenant_id = $1 inside a
-- transaction before executing any business query (see withTenantDb).

CREATE POLICY tenant_isolation_platform_credentials ON platform_credentials
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_products ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_orders ON orders
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_agents ON agents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_agent_events ON agent_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_approvals ON approvals
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
