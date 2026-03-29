CREATE TABLE tenant_governance_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants (id),
  price_change_threshold INTEGER NOT NULL DEFAULT 15,
  ads_budget_approval INTEGER NOT NULL DEFAULT 500,
  new_listing_approval BOOLEAN NOT NULL DEFAULT true,
  human_in_loop_agents JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenant_governance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_governance_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenant_governance_settings ON tenant_governance_settings
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
