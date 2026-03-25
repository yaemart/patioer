-- Run after decision_memory has representative rows (e.g. > 100 per tenant for IVFFlat tuning).
-- CONCURRENTLY may require running outside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS decision_memory_context_vector_ivfflat
    ON decision_memory
    USING ivfflat (context_vector vector_cosine_ops)
    WITH (lists = 100);
