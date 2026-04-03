-- Phase 5B: Approval center enhancements
-- Adds display fields, impact preview, expiry, and rollback plan

ALTER TYPE approval_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS display_title TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS display_description TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS impact_preview JSONB;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS rollback_plan TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS expire_at TIMESTAMPTZ;
