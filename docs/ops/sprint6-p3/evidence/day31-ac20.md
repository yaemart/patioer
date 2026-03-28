# AC-P3-20 验证证据：pgvector 向量检索不跨租户验证

**验证日期：** 2026-03-27
**验收标准：** pgvector 向量检索不跨租户验证：100% 通过

## 测试租户

- ISO-A: `11111111-1111-4111-8111-111111111111`
- ISO-B: `22222222-2222-4222-8222-222222222222`

## 测试流程

### Step 1: 租户 A 写入 5 条 decision_memory（含 context_vector + outcome）

5 条记录全部写入成功，每条含 outcome。

### Step 2: 租户 B recall → 0 条

```
租户 B recall 结果: 0 条 ✅（无数据泄露）
```

### Step 3: 租户 A recall → 3 条

```
租户 A recall 结果: 3 条 ✅
  ISO-P001  similarity=1.0000（完全匹配）
  ISO-P003  similarity=0.1299
  ISO-P002  similarity=0.0346
```

### 隔离机制

1. SQL WHERE `tenant_id = $1`（应用层过滤）
2. PostgreSQL RLS policy `tenant_isolation_decision_memory`（数据库层强制）
3. pgvector 向量检索仅在已过滤的行上执行

## 结论

**AC-P3-20 ✅ PASS** — pgvector 向量检索完全隔离，跨租户零泄露
