-- Phase 2 · Sprint 5: agents.system_prompt — tenant-editable LLM system prompt per agent.
-- NULL means no custom prompt; the LLM client falls back to a built-in default.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
