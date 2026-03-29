-- Phase 5 · Sprint 15: Add Stripe billing fields to tenants table.
-- See docs/plans/phase5-plan.md §3 task 15.6

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_id_idx
  ON tenants (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
