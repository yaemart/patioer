-- Phase 2 · Sprint 4: ads_campaigns + inventory_levels (Drizzle + RLS).
-- See docs/plans/phase2-plan.md §4.2–4.3.

CREATE TABLE ads_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  platform TEXT NOT NULL,
  platform_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  daily_budget NUMERIC(10, 2),
  total_spend NUMERIC(10, 2),
  roas NUMERIC(6, 2),
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX ads_campaigns_tenant_platform_campaign_idx
  ON ads_campaigns (tenant_id, platform, platform_campaign_id);

CREATE TABLE inventory_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  product_id UUID NOT NULL REFERENCES products (id),
  platform TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  safety_threshold INTEGER DEFAULT 10,
  status TEXT NOT NULL,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX inventory_levels_tenant_product_platform_idx
  ON inventory_levels (tenant_id, product_id, platform);

ALTER TABLE ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_ads_campaigns ON ads_campaigns
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_inventory_levels ON inventory_levels
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
