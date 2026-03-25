-- DataOS Event Lake DDL (database: electroos_events)
-- Applied via scripts/clickhouse-apply-ddl.ts or clickhouse-client

CREATE DATABASE IF NOT EXISTS electroos_events;

CREATE TABLE IF NOT EXISTS electroos_events.events (
    event_id UUID DEFAULT generateUUIDv4(),
    tenant_id UUID NOT NULL,
    platform String,
    agent_id String NOT NULL,
    event_type String NOT NULL,
    entity_id String,
    payload String,
    metadata String,
    created_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, agent_id, created_at)
TTL created_at + INTERVAL 2 YEAR;

CREATE TABLE IF NOT EXISTS electroos_events.price_events (
    event_id UUID DEFAULT generateUUIDv4(),
    tenant_id UUID NOT NULL,
    platform String,
    product_id String NOT NULL,
    price_before Float64,
    price_after Float64,
    change_pct Float64,
    approved UInt8,
    conv_rate_7d Float64 DEFAULT 0,
    revenue_7d Float64 DEFAULT 0,
    created_at DateTime64(3) DEFAULT now64(3)
) ENGINE = MergeTree()
ORDER BY (tenant_id, product_id, created_at);
