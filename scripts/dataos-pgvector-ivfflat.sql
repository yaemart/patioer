-- 在 decision_memory 积累足够行（>100/租户）后手动执行。
-- Run after representative rows; CONCURRENTLY may require running outside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS decision_memory_context_vector_ivfflat
    ON decision_memory
    USING ivfflat (context_vector vector_cosine_ops)
    WITH (lists = 100);
