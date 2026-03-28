# AC-P3-08 验证证据：Feature Store Redis 缓存命中率 > 90%

**验证日期：** 2026-03-27
**验收标准：** Feature Store Redis 缓存命中率 > 90%（Prometheus 指标验证）

## 测试环境

- DataOS API: `localhost:3300`
- Redis: `patioer-dataos-redis` (host port 6380)
- 测试租户: `550e8400-e29b-41d4-a716-446655440001`

## 前置准备

1. FLUSHDB 清空 Redis 缓存
2. Upsert 5 个产品 (PERF-001 ~ PERF-005) 到 Feature Store

## 测试流程

### Round 1: 同一产品 PERF-001 读取 20 次

| 序号 | 结果 |
|---|---|
| 第 1 次 | Cache MISS（首次加载） |
| 第 2~20 次 | Cache HIT × 19 |

### Round 2: 5 产品各读取 10 次

| 产品 | Miss | Hit | 说明 |
|---|---|---|---|
| PERF-001 | 0 | 10 | Round 1 已缓存 |
| PERF-002 | 1 | 9 | 首次 miss |
| PERF-003 | 1 | 9 | 首次 miss |
| PERF-004 | 1 | 9 | 首次 miss |
| PERF-005 | 1 | 9 | 首次 miss |

## Prometheus 指标

```
dataos_feature_cache_hits_total   65
dataos_feature_cache_misses_total  5
```

## 计算

- 总请求数 = 65 + 5 = **70**
- 命中率 = 65 / 70 = **92.86%**

## 结论

**AC-P3-08 ✅ PASS** — 缓存命中率 92.86% > 90% 阈值
