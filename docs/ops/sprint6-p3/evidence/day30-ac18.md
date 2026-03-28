# AC-P3-18 验证证据：三层隔离测试全部通过

**验证日期：** 2026-03-27
**验收标准：** 租户隔离测试全部通过（Event Lake + Feature Store + Decision Memory 三层）

## 测试租户

- 租户 A: `550e8400-e29b-41d4-a716-446655440001`
- 租户 B: `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`

## 测试结果

### 1. Event Lake (ClickHouse) 隔离

- 租户 A 写入事件 `{secret: "A-data-d30"}` → ok
- 租户 B 查询含 `A-data-d30` 的事件 → **0 行** ✅

隔离机制：应用层 WHERE tenant_id 过滤

### 2. Feature Store (PG + Redis) 隔离

- 租户 A upsert feature ISO-D30 → ok
- 租户 B 读取 ISO-D30 → **null** ✅

隔离机制：PostgreSQL RLS + Redis 租户作用域缓存键

### 3. Decision Memory (PG + pgvector) 隔离

- 租户 A 记录 decision `{secret: "A-context-d30"}` → ok
- 租户 B recall 相同上下文 → **0 条** ✅

隔离机制：PostgreSQL RLS + SQL WHERE tenant_id 双重过滤

## 结论

**AC-P3-18 ✅ PASS** — Event Lake / Feature Store / Decision Memory 三层隔离全部通过
