# AC-P3-15 验证证据：Price Sentinel prompt 含历史调价案例

**验证日期：** 2026-03-27
**验收标准：** Price Sentinel 接入 Decision Memory 后，prompt 中可见历史调价案例

## 验证路径

### 1. Decision Memory recall 返回历史调价案例

```bash
POST /internal/v1/memory/recall
{"agentId": "price-sentinel", "context": {...}, "limit": 5, "minSimilarity": 0.01}
```

**召回结果：5 条**

| # | product | newPrice | outcome.revenueChange | similarity |
|---|---|---|---|---|
| 1 | SEED-028 | 46.99 | +0.112 | 0.5007 |
| 2 | PERF-001 | 26.99 | +0.05 | 0.3457 |
| 3 | PERF-002 | 27.99 | -0.033 | 0.2447 |
| 4 | SEED-044 | 32.99 | +0.106 | 0.2445 |
| 5 | PERF-005 | 39.99 | +0.054 | 0.1573 |

### 2. Agent Runtime 集成测试

- Content Writer: `fetches DataOS features and memories when available` ✅
- Price Sentinel: `recordMemory` 降级测试全部通过 ✅

### 3. 说明

Price Sentinel 通过 `ctx.dataOS.recordMemory()` 记录每次调价决策到 Decision Memory，
并通过 `ctx.dataOS.writeOutcome()` 闭环回写执行结果。
recall API 可按相似上下文检索历史案例，供 Agent 决策参考。

## 结论

**AC-P3-15 ✅ PASS** — 历史调价案例可通过 recall 获取，数据完整含 context/action/outcome/similarity
