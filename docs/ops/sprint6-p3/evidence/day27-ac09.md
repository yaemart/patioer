# AC-P3-09 验证证据：ClickHouse 100 万条事件聚合查询 < 2s

**验证日期：** 2026-03-27
**验收标准：** ClickHouse 查询性能：100 万条事件聚合查询 < 2s

## 数据准备

- 批量插入 1,000,000 条测试事件（Node.js 脚本，50K/batch × 20 batches）
- 插入总耗时：2.8s
- 数据分布：10 个租户 × 6 种 Agent × 多种事件类型
- 最终行数确认：**1,000,006**

## 表结构

```sql
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, agent_id, created_at)
TTL toDateTime(created_at) + toIntervalYear(2)
```

## 聚合查询 1：agent_id × event_type 分组

```sql
SELECT agent_id, event_type, count() AS cnt,
       uniqExact(tenant_id) AS tenants,
       min(created_at) AS first_event,
       max(created_at) AS last_event
FROM electroos_events.events
GROUP BY agent_id, event_type
ORDER BY cnt DESC
```

**耗时：0.073s** ✅

结果：6 个 Agent 各 ~166,667 条，分布均匀

## 聚合查询 2：tenant_id 维度分组

```sql
SELECT tenant_id, count() AS total_events,
       uniqExact(agent_id) AS agents,
       max(created_at) AS last_activity
FROM electroos_events.events
GROUP BY tenant_id
ORDER BY total_events DESC
```

**耗时：0.038s** ✅

结果：10 个租户各 100,000 条，分布均匀

## 结论

**AC-P3-09 ✅ PASS** — 100 万条聚合查询:
- 查询 1: 0.073s (< 2s)
- 查询 2: 0.038s (< 2s)
- 性能远超预期（ClickHouse MergeTree 列式存储优势明显）
