-- Phase 5 · Sprint 15: Onboarding progress + billing usage logs + reconciliation + RLS.
-- See docs/plans/phase5-plan.md §3 tasks 15.9, 15.10

CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  current_step INTEGER NOT NULL DEFAULT 1,
  step_data JSONB NOT NULL DEFAULT '{}',
  oauth_status JSONB NOT NULL DEFAULT '{}',
  health_check_passed BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX onboarding_progress_tenant_idx ON onboarding_progress (tenant_id);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_onboarding_progress ON onboarding_progress
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE billing_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  agent_id TEXT NOT NULL,
  tokens_used INTEGER NOT NULL,
  cost_usd NUMERIC(10, 4) NOT NULL,
  model TEXT NOT NULL,
  is_overage BOOLEAN NOT NULL DEFAULT false,
  reported_to_stripe BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX billing_usage_logs_tenant_created_idx
  ON billing_usage_logs (tenant_id, created_at DESC);

ALTER TABLE billing_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_usage_logs ON billing_usage_logs
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE billing_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  stripe_amount_cents INTEGER NOT NULL,
  calculated_amount_cents INTEGER NOT NULL,
  diff_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX billing_reconciliation_tenant_period_idx
  ON billing_reconciliation (tenant_id, period_start DESC);

ALTER TABLE billing_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_reconciliation FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_reconciliation ON billing_reconciliation
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
