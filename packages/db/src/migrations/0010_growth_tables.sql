-- Phase 5 · Sprint 15: Growth & referral tables + RLS.
-- See docs/plans/phase5-plan.md §3 task 15.8

CREATE TABLE referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_referral_codes ON referral_codes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tenant_id UUID NOT NULL REFERENCES tenants (id),
  new_tenant_id UUID NOT NULL REFERENCES tenants (id),
  reward_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_referral_rewards ON referral_rewards
  USING (referrer_tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_responses FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_nps_responses ON nps_responses
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
