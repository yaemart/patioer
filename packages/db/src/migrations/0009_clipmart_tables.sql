-- Phase 5 · Sprint 15: ClipMart template marketplace tables + RLS.
-- See docs/plans/phase5-plan.md §3 task 15.7

CREATE TABLE clipmart_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_tenant_id UUID REFERENCES tenants (id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  target_markets TEXT[] NOT NULL DEFAULT '{}',
  target_categories TEXT[] NOT NULL DEFAULT '{}',
  platforms TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}',
  performance JSONB NOT NULL DEFAULT '{}',
  downloads INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(3, 2),
  is_official BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX clipmart_templates_category_idx ON clipmart_templates (category);
CREATE INDEX clipmart_templates_is_official_idx ON clipmart_templates (is_official) WHERE is_official = true;

CREATE TABLE template_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES clipmart_templates (id),
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  gmv_change NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX template_reviews_tenant_template_idx
  ON template_reviews (tenant_id, template_id) WHERE deleted_at IS NULL;

ALTER TABLE clipmart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE clipmart_templates FORCE ROW LEVEL SECURITY;

-- ClipMart templates use a relaxed policy: public templates are visible to all,
-- private templates only to their author.
CREATE POLICY clipmart_template_access ON clipmart_templates
  USING (
    is_public = true
    OR author_tenant_id IS NULL
    OR author_tenant_id = current_setting('app.tenant_id')::uuid
  );

ALTER TABLE template_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_template_reviews ON template_reviews
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
