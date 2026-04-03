-- Phase 5B Day 18 – Add operating mode to governance settings
ALTER TABLE tenant_governance_settings
  ADD COLUMN IF NOT EXISTS operating_mode TEXT NOT NULL DEFAULT 'daily';
