-- Phase 5B: Business data foundation tables
-- These power the profit cockpit, inventory planning, account health, and service ops views.

-- 1. Unit economics (daily per-SKU profit breakdown)
CREATE TABLE unit_economics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  platform TEXT NOT NULL,
  product_id TEXT NOT NULL,
  date DATE NOT NULL,
  gross_revenue NUMERIC(12,2),
  net_revenue NUMERIC(12,2),
  cogs NUMERIC(12,2),
  platform_fee NUMERIC(12,2),
  shipping_cost NUMERIC(12,2),
  ad_spend NUMERIC(12,2),
  refund_amount NUMERIC(12,2),
  contribution_margin NUMERIC(12,2),
  acos NUMERIC(8,4),
  tacos NUMERIC(8,4),
  units_sold INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, platform, product_id, date)
);

ALTER TABLE unit_economics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_economics_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_unit_economics_daily ON unit_economics_daily
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- 2. Inbound shipments / purchase orders
CREATE TABLE inventory_inbound_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  platform TEXT NOT NULL,
  product_id TEXT NOT NULL,
  shipment_id TEXT,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_transit',
  expected_arrival DATE,
  supplier TEXT,
  lead_time_days INTEGER,
  moq INTEGER,
  landed_cost_per_unit NUMERIC(10,2),
  total_cost NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inventory_inbound_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_inbound_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inventory_inbound_shipments ON inventory_inbound_shipments
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- 3. Account health events (policy violations, listing issues, etc.)
CREATE TABLE account_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  description TEXT,
  affected_entity TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE account_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_health_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_account_health_events ON account_health_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- 4. Service / after-sales cases
CREATE TABLE service_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  platform TEXT NOT NULL,
  case_type TEXT NOT NULL,
  order_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  amount NUMERIC(10,2),
  customer_message TEXT,
  agent_response TEXT,
  escalated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_service_cases ON service_cases
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
