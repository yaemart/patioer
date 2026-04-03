-- Phase 5B Day 11 – SOP strategy tables

DO $$ BEGIN
  CREATE TYPE sop_status AS ENUM ('active','archived','draft');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 1. Tenant SOPs – atomic strategy instructions scoped to agent/platform/entity
CREATE TABLE IF NOT EXISTS tenant_sops (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants (id),
  scope                 TEXT NOT NULL,
  platform              TEXT,
  entity_type           TEXT,
  entity_id             TEXT,
  scenario_id           UUID,
  scenario              TEXT,
  sop_text              TEXT NOT NULL,
  extracted_goal_context  JSONB,
  extracted_system_prompt TEXT,
  extracted_governance    JSONB,
  extraction_warnings     JSONB,
  status                sop_status NOT NULL DEFAULT 'active',
  effective_from        TIMESTAMPTZ,
  effective_to          TIMESTAMPTZ,
  previous_version_id   UUID,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, scope, platform, entity_type, entity_id, version)
);

ALTER TABLE tenant_sops ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sops FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sops ON tenant_sops
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- 2. Tenant SOP Scenarios – higher-level strategy bundles (launch / defend / clearance / daily)
CREATE TABLE IF NOT EXISTS tenant_sop_scenarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants (id),
  scenario_name       TEXT,
  scenario            TEXT NOT NULL,
  platform            TEXT,
  entity_type         TEXT,
  entity_id           TEXT,
  effective_from      TIMESTAMPTZ,
  effective_to        TIMESTAMPTZ,
  status              sop_status NOT NULL DEFAULT 'active',
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, scenario, platform, entity_type, entity_id, version)
);

ALTER TABLE tenant_sop_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sop_scenarios FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_sop_scenarios ON tenant_sop_scenarios
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- 3. SOP Scenario Templates – system-provided defaults (no tenant_id → no RLS)
CREATE TABLE IF NOT EXISTS sop_scenario_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario            TEXT NOT NULL,
  scope               TEXT NOT NULL,
  platform            TEXT,
  default_sop_text    TEXT NOT NULL,
  default_goal_context  JSONB NOT NULL,
  editable_fields     JSONB NOT NULL,
  locked_fields       JSONB NOT NULL,
  UNIQUE(scenario, scope, platform)
);
