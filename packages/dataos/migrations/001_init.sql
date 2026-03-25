-- DataOS PostgreSQL (separate from ElectroOS). Run via: pnpm exec tsx scripts/dataos-migrate.ts

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS product_features (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    platform TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price_current NUMERIC(10,2),
    price_avg_30d NUMERIC(10,2),
    price_min_30d NUMERIC(10,2),
    price_max_30d NUMERIC(10,2),
    price_volatility NUMERIC(5,4),
    conv_rate_7d NUMERIC(5,4),
    conv_rate_30d NUMERIC(5,4),
    units_sold_7d INTEGER,
    revenue_7d NUMERIC(12,2),
    rank_in_category INTEGER,
    stock_qty INTEGER,
    days_of_stock INTEGER,
    reorder_point INTEGER,
    competitor_min_price NUMERIC(10,2),
    competitor_avg_price NUMERIC(10,2),
    price_position TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, platform, product_id)
);

CREATE INDEX IF NOT EXISTS product_features_tenant_idx ON product_features (tenant_id);

CREATE TABLE IF NOT EXISTS decision_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    agent_id TEXT NOT NULL,
    platform TEXT,
    entity_id TEXT,
    context JSONB NOT NULL,
    action JSONB NOT NULL,
    outcome JSONB,
    context_vector vector(1536),
    decided_at TIMESTAMPTZ DEFAULT NOW(),
    outcome_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS decision_memory_tenant_agent_decided_idx
    ON decision_memory (tenant_id, agent_id, decided_at DESC);

-- IVFFlat optional: requires sufficient rows; see scripts/dataos-pgvector-ivfflat.sql
