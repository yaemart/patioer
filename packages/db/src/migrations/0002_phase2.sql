-- Phase 2 Migration: Day 1 baseline
-- Multi-platform credential support + enum/webhook extensions.

-- 1) platform_credentials extensions
ALTER TABLE platform_credentials
  ADD COLUMN IF NOT EXISTS credential_type TEXT NOT NULL DEFAULT 'oauth';

ALTER TABLE platform_credentials
  ADD COLUMN IF NOT EXISTS region TEXT;

ALTER TABLE platform_credentials
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE platform_credentials
  ALTER COLUMN shop_domain DROP NOT NULL;

DROP INDEX IF EXISTS platform_credentials_tenant_platform_domain_idx;
DROP INDEX IF EXISTS platform_credentials_tenant_platform_idx;

CREATE UNIQUE INDEX platform_credentials_tenant_platform_idx
  ON platform_credentials (tenant_id, platform, COALESCE(region, '__none__'));

UPDATE platform_credentials
SET credential_type = 'oauth'
WHERE credential_type IS NULL;

-- 2) agent_type enum extensions (Phase 2 agents)
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ads-optimizer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'inventory-guard';

-- 3) webhook_events extensions for multi-platform ingestion
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'shopify';

ALTER TABLE webhook_events
  ALTER COLUMN shop_domain DROP NOT NULL;
