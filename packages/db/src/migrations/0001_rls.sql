-- tenants is intentionally excluded from per-row tenant isolation.
-- Lookups against this table occur before the tenant context is established
-- (e.g. resolving a slug -> id on every incoming request).  Access control
-- is enforced at the API layer; no sensitive business data lives here.

ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_platform_credentials ON platform_credentials;
CREATE POLICY tenant_isolation_platform_credentials ON platform_credentials
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_products ON products;
CREATE POLICY tenant_isolation_products ON products
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
CREATE POLICY tenant_isolation_orders ON orders
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_agents ON agents;
CREATE POLICY tenant_isolation_agents ON agents
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_agent_events ON agent_events;
CREATE POLICY tenant_isolation_agent_events ON agent_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_approvals ON approvals;
CREATE POLICY tenant_isolation_approvals ON approvals
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
