-- Migration 0019: Ads keyword-level tables for Sprint 21
-- Supports KeywordAdsHarness: keywords, negative keywords, search terms, daily metrics

CREATE TABLE IF NOT EXISTS ads_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES ads_campaigns(id),
  platform_keyword_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'broad',
  bid NUMERIC(10, 4),
  status TEXT NOT NULL DEFAULT 'enabled',
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(10, 2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ads_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_keywords_tenant_isolation ON ads_keywords
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS ads_negative_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES ads_campaigns(id),
  platform_keyword_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ads_negative_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_negative_keywords_tenant_isolation ON ads_negative_keywords
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS ads_search_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES ads_campaigns(id),
  keyword_id UUID,
  search_term TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(10, 2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  report_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ads_search_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_search_terms_tenant_isolation ON ads_search_terms
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS ads_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES ads_campaigns(id),
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(10, 2) DEFAULT 0,
  sales NUMERIC(10, 2) DEFAULT 0,
  acos NUMERIC(6, 4),
  roas NUMERIC(6, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ads_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_metrics_daily_tenant_isolation ON ads_metrics_daily
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
