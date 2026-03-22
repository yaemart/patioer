-- Normalize platform_credentials.region for deterministic credential lookup.
-- 1) Keep a single NULL-region row per (tenant_id, platform) if duplicates exist.
-- 2) Drop NULL-region rows when a global row already exists for same key.
-- 3) Backfill remaining NULL to 'global'.
-- 4) Enforce NOT NULL + default + unique index on (tenant_id, platform, region).

WITH ranked_null AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, platform
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM platform_credentials
  WHERE region IS NULL
)
DELETE FROM platform_credentials pc
USING ranked_null r
WHERE pc.id = r.id
  AND r.rn > 1;

DELETE FROM platform_credentials pc_null
USING platform_credentials pc_global
WHERE pc_null.tenant_id = pc_global.tenant_id
  AND pc_null.platform = pc_global.platform
  AND pc_null.region IS NULL
  AND pc_global.region = 'global';

UPDATE platform_credentials
SET region = 'global'
WHERE region IS NULL;

ALTER TABLE platform_credentials
  ALTER COLUMN region SET DEFAULT 'global';

ALTER TABLE platform_credentials
  ALTER COLUMN region SET NOT NULL;

DROP INDEX IF EXISTS platform_credentials_tenant_platform_idx;

CREATE UNIQUE INDEX platform_credentials_tenant_platform_idx
  ON platform_credentials (tenant_id, platform, region);
