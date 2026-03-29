-- Phase 5 · Sprint 15: Extend agent_type enum with finance-agent and ceo-agent (Phase 4 legacy L-01).
-- See docs/plans/phase5-plan.md §2 L-01

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'finance-agent';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ceo-agent';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'customer-success';
