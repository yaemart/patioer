-- Migration 002: 软删除支持 (Constitution §5.2 — 禁止硬删除生产数据)
-- 为 product_features 和 decision_memory 两张表添加 deleted_at 列。
-- 现有查询须过滤 WHERE deleted_at IS NULL；delete 操作改为 UPDATE SET deleted_at = NOW()。

ALTER TABLE product_features
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS product_features_not_deleted_idx
  ON product_features (tenant_id, platform, product_id)
  WHERE deleted_at IS NULL;

ALTER TABLE decision_memory
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS decision_memory_not_deleted_idx
  ON decision_memory (tenant_id, agent_id, decided_at DESC)
  WHERE deleted_at IS NULL;
