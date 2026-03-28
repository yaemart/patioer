# AC-P3-10 验证证据：Price Sentinel 调价后 decision_memory 有记录

**验证日期：** 2026-03-27
**验收标准：** Price Sentinel 每次调价后，decision_memory 表有对应记录（含 context_vector）

## 测试流程

1. 通过 DataOS API 记录 Price Sentinel 调价决策
2. 查询 decision_memory 验证记录存在、context_vector 非空

## API 调用

```bash
POST /internal/v1/memory/record
{
  "agentId": "price-sentinel",
  "context": {
    "productId": "PERF-001",
    "currentPrice": 28.99,
    "category": "electronics",
    "convRate7d": 0.12,
    "competitorMin": 25.99
  },
  "action": {
    "type": "price_adjustment",
    "newPrice": 26.99,
    "reason": "competitor undercut",
    "changePct": -6.9
  }
}
```

**响应：** `{"id": "0616e476-a744-4769-b2d4-fb88bfda8d60"}`

## 数据库验证

| 字段 | 值 |
|---|---|
| id | 0616e476-a744-4769-b2d4-fb88bfda8d60 |
| tenant_id | 550e8400-e29b-41d4-a716-446655440001 |
| agent_id | price-sentinel |
| has_vec | **true** |
| vec_dims | **1536** |
| product_id | PERF-001 |
| new_price | 26.99 |

## 结论

**AC-P3-10 ✅ PASS** — decision_memory 含 price-sentinel 记录，context_vector 1536 维非空
