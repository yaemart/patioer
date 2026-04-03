-- Phase 5B Day 5 – Tenant Goals

DO $$ BEGIN
  CREATE TYPE goal_category AS ENUM ('revenue','margin','acos','inventory','customer','custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE goal_period AS ENUM ('daily','weekly','monthly','quarterly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenant_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
  name          TEXT NOT NULL,
  category      goal_category NOT NULL,
  period        goal_period NOT NULL DEFAULT 'monthly',
  target_value  NUMERIC(14,2) NOT NULL,
  current_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit          TEXT NOT NULL DEFAULT 'USD',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  priority      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tenant_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_goals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_goals ON tenant_goals
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
