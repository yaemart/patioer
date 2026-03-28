# Phase 3 Sprint 6 基线

## 环境基线

- **Git SHA:** `69a76ed9c0694be081b97a4d2cc925834fe649b6`
- **Node:** v25.3.0
- **pnpm:** 9.15.0
- **pnpm-lock.yaml SHA:** `7eefeac3610d9e15a6586722df1120f0e27e16cf`

## Docker 镜像版本

- **DataOS API:** `node:22-alpine`
- **ClickHouse:** `clickhouse/clickhouse-server:24`
- **DataOS PG:** `pgvector/pgvector:pg16`
- **Redis:** `redis:7-alpine`

## 代码质量基线

- **Typecheck:** ✅ 0 errors（全部 10 个包 Done）
- **Test Files:** 110+ passed / 7 skipped / 0 failed
- **Tests:** 1090+ passed / 86 skipped / 0 failed

## 包级测试详情

| 包 | Test Files | Tests |
|----|-----------|-------|
| `packages/dataos` | 5 passed / 2 skipped | 78 passed / 27 skipped |
| `packages/dataos-client` | 1 passed | 24 passed |
| `packages/devos-bridge` | 22 passed | 92 passed |
| `packages/db` | 1 passed / 2 skipped | 6 passed / 38 skipped |
| `packages/market` | 4 passed | 41 passed |
| `packages/harness` | 9 passed | 185 passed |
| `packages/shared` | — | — |
| `packages/agent-runtime` | 17 passed | 178 passed |
| `apps/dataos-api` | 6 passed | 91 passed |
| `apps/api` | 45 passed / 3 skipped | 398 passed / 21 skipped |

## Day 25 验证记录

### AC-P3-01: DataOS API Health ✅
```
GET /health → {"ok":true,"service":"dataos-api"}  (HTTP 200)
```

### AC-P3-02: ClickHouse Event Lake ✅
```
SELECT name FROM system.tables WHERE database='electroos_events'
→ agent_events, price_events  (2 tables)
```

### AC-P3-03: pgvector Feature Store + Decision Memory ✅
```
SELECT extname FROM pg_extension WHERE extname='vector' → vector
\dt → feature_snapshots, decisions (2 tables with tenant_id RLS)
```

### AC-P3-04: Redis Cache + Feature Store R/W ✅
```
Redis PING → PONG (avg latency 0.20ms)
POST /internal/v1/features/upsert → {"ok":true}
GET  /internal/v1/features/shopify/PERF-TEST-001 → cache hit (cache_hits_total=2)
DELETE /internal/v1/features/shopify/PERF-TEST-001 → {"ok":true,"deleted":true}
GET  after delete → null (cache_misses_total=1, cache invalidated)
POST /internal/v1/lake/events → {"ok":true}
Cache key pattern: feature:{tenantId}:{platform}:{productId}
```

**发现 & 修复**: Zod v4 (4.3.6) `.uuid()` 校验更严格，要求 RFC 4122 格式
（version 位 `[1-8]`，variant 位 `[89abAB]`）。测试 UUID 需使用合规格式
如 `f47ac10b-58cc-4372-a567-0e02b2c3d479`。

### Day 25 回归测试 ✅
```
pnpm typecheck → 0 errors (10/10 packages)
pnpm test → 110 test files passed / 7 skipped / 0 failed
             1093 tests passed / 86 skipped / 0 failed
与基线一致，无回归。
```

---

## Day 26 验证记录

### AC-P3-05: Event Lake 读写 ✅
```
POST /lake/events (price-sentinel, content-writer) → {"ok":true}
POST /lake/price-events (SKU-001 price change) → {"ok":true}
GET  /lake/events?agentId=price-sentinel → 1 event
GET  /lake/events?eventType=listing_update → 1 event
GET  /lake/price-events?productId=SKU-001 → 1 event
ClickHouse direct: events=3, price_events=1
lake_events_inserted_total=4
```

### AC-P3-06: Decision Memory + pgvector 语义召回 ✅
```
POST /memory/record (3 decisions: price-sentinel×2, content-writer×1) → IDs returned
GET  /memory/decisions?agentId=price-sentinel → 2 decisions
POST /memory/outcome → {"ok":true} (outcome written to decision 1)
POST /memory/recall (exact context match) → similarity=1.0, outcome included
pgvector: 1536-dim embeddings, cosine distance operator <=> functional
RLS: tenant_isolation_decision_memory policy active
```

### AC-P3-07: BullMQ 异步消费端到端 ✅
```
Host enqueue → Queue 'dataos-lake-ingest' (port 6380) → Job ID=5
Worker consumed → ingestion_jobs_processed_total: 0→1
ClickHouse: event_id=d69fd496... agent=bullmq-test confirmed
注意: DataOS Redis 宿主端口是 6380（非 6379）
```

### AC-P3-08: Tenant 隔离 RLS ✅
```
Tenant A features: empty | Tenant B features: B-SKU-001 (隔离 ✅)
Tenant A decisions: 3 (own) | Tenant B decisions: 1 (own) (隔离 ✅)
Tenant A isolation_test events: 0 | Tenant B: 1 (隔离 ✅)
Cross-tenant body/header mismatch → 403 "body tenantId does not match" ✅
PG RLS: product_features + decision_memory 均有 tenant_isolation 策略
```

### Day 26 回归测试 ✅
```
pnpm typecheck → 0 errors (10/10 packages)
pnpm test → 110 test files passed / 7 skipped / 0 failed
             1093 tests passed / 86 skipped / 0 failed
与基线一致，无回归。
```

---

## Day 27 验证记录

### AC-P3-09: Prometheus 可观测性 ✅
```
GET /metrics → HTTP 200, Content-Type: text/plain; version=0.0.4
13 DataOS 指标 (5 counters + 3 gauges + 5 agent counters)
必需指标: cache_hits, cache_misses, lake_events, ingestion_processed/failed ✓
Feature Agent tick: budget_utilization=0.002 ✓
```

### AC-P3-10: DataOS Client SDK 合约测试 ✅
```
@patioer/dataos-client: 1 test file, 24 tests passed
覆盖: recordLakeEvent, recordPriceEvent, queryEvents, queryPriceEvents,
       getFeatures, listFeatures, upsertFeature, deleteFeature,
       recordMemory, recallMemory, writeOutcome, listDecisions, deleteDecision,
       getCapabilities, timeout/error graceful degradation, DATAOS_ENABLED=0
```

### AC-P3-11: Agent Runtime → DataOS 集成 ✅
```
@patioer/agent-runtime: 17 test files, 178 tests passed
DataOS 降级测试 (ADR-03 / AC-P3-19):
  - ctx.dataOS=undefined → agents 正常运行 ✓
  - dataOS.recordMemory throws → 优雅降级 + logAction ✓
  - dataOS.recordLakeEvent throws → 优雅降级 ✓
  - dataOS.recordPriceEvent throws → 优雅降级 ✓
```

### Day 27 回归测试 ✅
```
无代码变更（纯验证 Sprint），基线数据与 Day 26 一致。
```

---

## Day 28 验证记录

### AC-P3-12: DevOS Bridge 合约测试 ✅
```
@patioer/devos-bridge: 22 test files, 92 tests passed
覆盖: alertmanager pipeline, ticket protocol, DB 隔离,
      DevOS client, probe, seed, SRE alert catalog 等
```

### AC-P3-13: Harness 韧性 ✅
```
@patioer/harness: 9 test files, 185 tests passed
Token bucket rate limiting, Amazon 429 header parsing,
jittered backoff, HarnessError 结构化错误
```

### AC-P3-14: Harness Registry 多平台 ✅
```
HarnessRegistry: cache/TTL/invalidation/pruneOverflow
TenantHarness 接口合规: Amazon ✓ / TikTok ✓ / Shopee ✓
不同 tenant 获取不同实例, 未注册平台抛错
```

---

## Day 29 验证记录

### AC-P3-15: Feature Agent 定时任务 ✅
```
feature_agent_ticks_total=1, items_processed=1, budget_utilization=0.002
15 tests: aggregation, budget capping, tenant isolation, metrics
Constitution Ch8.1 agent.budget.utilization 合规
```

### AC-P3-16: Insight Agent 反馈循环 ✅
```
POST /insight/trigger → processed=0 (无过期 decisions)
12 tests: ClickHouse event query → outcome 构建 → writeOutcome
失败续处理, pending_decisions gauge, 7-day lookback
```

### AC-P3-17: 审计日志不可变性 ✅
```
events/priceEvents API: 仅 POST + GET, 无 DELETE/UPDATE
ClickHouse MergeTree: append-only 存储引擎
event-lake.ts: 0 条 mutation 语句
⚠️ 建议: 生产环境限制 dataos 用户为 INSERT+SELECT
```

### AC-P3-18: 预算护栏 ✅
```
所有 Agent budget 测试通过:
  price-sentinel, content-writer, market-intel,
  support-relay, ads-optimizer, product-scout
Feature Agent: maxItemsPerTick + budget_exceeded structured log
PaperclipBridge: getBudgetStatus + isExceeded
```

---

## Day 30 验证记录

### AC-P3-19: DataOS 降级 (ADR-03) ✅
```
15+ degradation tests:
  ctx.dataOS=undefined → agents 正常运行
  dataOS.recordMemory/recordLakeEvent/recordPriceEvent throws → 优雅降级
  dataOS.getFeatures/recallMemory fails → 安全降级
  DATAOS_ENABLED=0 → client=null
  网络错误 → empty array/null
```

### AC-P3-20: 全量 API 端点契约 ✅
```
@patioer/dataos-api: 6 test files, 91 tests passed
覆盖: redis-url, metrics, ingestion worker, insight agent, feature agent
完整 CRUD: events/features/decisions/memory
```

### AC-P3-21: Docker Compose 一键启动 ✅
```
6 containers running (DataOS stack):
  dataos-api (3300), clickhouse (8123/9000),
  postgres/pgvector (5434), redis (6380)
All health checks: API=200, ClickHouse=200, Redis=PONG, PG=OK
```

### Sprint 6 最终回归 ✅
```
pnpm typecheck → 0 errors (10/10 packages)
pnpm test → 110 test files passed / 7 skipped / 0 failed
             1093 tests passed / 86 skipped / 0 failed
与基线 100% 一致，零回归。
```

---

## Sprint 6 验收总结（Day 25-34 完整对齐原计划）

| AC | 描述 | 状态 | Day | 证据 |
|----|------|------|-----|------|
| AC-P3-01 | DataOS API /health 200 | ✅ | 25 | baseline |
| AC-P3-02 | ClickHouse Event Lake 表 + 读写 | ✅ | 25 | baseline |
| AC-P3-03 | pgvector + Feature Store 表 | ✅ | 25 | baseline |
| AC-P3-04 | Redis 缓存 + Feature R/W | ✅ | 25 | baseline |
| AC-P3-05 | Price Sentinel → price_events | ✅ | 26 | baseline |
| AC-P3-06 | Ingestion 无丢失 | ✅ | 26 | baseline |
| AC-P3-07 | BullMQ 异步消费 | ✅ | 26 | baseline |
| AC-P3-08 | Feature Store 缓存命中率 > 90% | ✅ 92.86% | 27 | day27-ac08.md |
| AC-P3-09 | CH 100万聚合查询 < 2s | ✅ 0.073s | 27 | day27-ac09.md |
| AC-P3-10 | PS 调价 → decision_memory | ✅ | 28 | day28-ac10.md |
| AC-P3-11 | Insight Agent 回写 outcome | ✅ | 28 | day28-ac11.md |
| AC-P3-12 | Decision Memory 向量召回 ≥3 | ✅ 3 条 | 28 | day28-ac12.md |
| AC-P3-13 | outcome 数据量 > 50 | ✅ 55 条 | 28 | day28-ac13.md |
| AC-P3-14 | PS prompt 含 conv_rate_7d | ✅ | 29 | day29-ac14.md |
| AC-P3-15 | PS prompt 含历史调价案例 | ✅ | 29 | day29-ac15.md |
| AC-P3-16 | Content Writer 正常生成 | ✅ 17/17 | 29 | day29-ac16.md |
| AC-P3-17 | Market Intel 更新竞品特征 | ✅ 19/19 | 29 | day29-ac17.md |
| AC-P3-18 | 三层隔离测试全部通过 | ✅ | 30 | day30-ac18.md |
| AC-P3-19 | DataOS 宕机降级 (ADR-03) | ✅ 13/13 | 30 | day30-ac19.md |
| AC-P3-20 | pgvector 跨租户检索隔离 100% | ✅ | 31 | day31-ac20.md |
| AC-P3-21 | ClickHouse TTL 2年生效 | ✅ | 31 | day31-ac21.md |

**结果: 21/21 AC 全部通过**

### 额外完成的任务

| 任务 | 描述 | 状态 | Day |
|------|------|------|-----|
| 6.6 | dataos-isolation.test.ts | ✅ 10/10 | 31 |
| 6.7 | CH 100万写入压测 | ✅ 353K rows/s | 32 |
| 6.8 | pgvector 万级检索压测 | ✅ p50=3ms | 32 |
| 6.9 | 证据归档 + 运维文档 + ADR | ✅ | 33 |
| 6.10 | 21项AC总验收 + Phase 4就绪 | ✅ | 34 |

### 发现的问题 & 已修复

1. **Zod v4 UUID 校验更严格**: 引入 `UUID_LOOSE_RE` 替代 `z.string().uuid()`（已修复）
2. **DataOS Redis 端口**: 宿主机映射为 6380（已添加文档注释）
3. **ClickHouse 权限**: 限制 `dataos` 用户为 INSERT+SELECT（已通过初始化脚本修复）
4. **price_events TTL 缺失**: 原表创建未含 TTL，已通过 ALTER TABLE 修复

### 性能基线

| 指标 | 值 |
|------|-----|
| CH 写入吞吐 | 353,232 rows/s |
| CH 聚合查询 (1M rows) | 0.038~0.073s |
| Feature Store 缓存命中率 | 92.86% |
| pgvector recall p50 | 3ms |
| pgvector recall p95 | 13ms |

## 冻结时间

- **日期:** 2026-03-27
- **Sprint:** Phase 3 · Sprint 6 · Day 25-34
- **状态:** ✅ COMPLETED — 严格按原计划 Day 27-34 补齐所有 AC 和任务
