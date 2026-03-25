# Phase 3 实施计划 · DataOS 引入（Event Lake · Feature Store · Decision Memory）

**周期：** 12 周（Month 6–8）  
**目标：** 部署 DataOS 三层存储，接入 3 个 DataOS Agent（Ingestion / Feature / Insight），升级 Price Sentinel 为学习型，新增 Content Writer + Market Intel Agent  
**验收：** 21 项（见 §9）  
**前提：** Phase 2 验收通过（20 项 AC-P2 全部 ✅）  
**不做：** 强化学习训练、跨租户数据共享（Phase 4）、DataOS 对外 API

> 术语约定：**DataOS** = 学习层（Event Lake + Feature Store + Decision Memory）。

---

## 0. 架构决策（Phase 3 前提）

### 0.1 继承自 Phase 1–2 的决策

| # | 决策 | 结论 | 来源 |
|---|------|------|------|
| D1 | 仓库策略 | **独立 Monorepo**（`patioer/`）；Paperclip 并排服务 | ADR-0001 |
| D2 | Web 框架 | ElectroOS **Fastify**；Paperclip Express | Constitution Ch3.1 |
| D3 | ORM | **Drizzle ORM**；不侵入 Paperclip schema | Constitution Ch3.1 |
| D4 | Event 存储 | Phase 3 引入 **ClickHouse** 作为分析湖 | Phase 2 Plan §0.1 D4 |

### 0.2 Phase 3 新增决策

| # | 决策 | 结论 | ADR |
|---|------|------|-----|
| D13 | DataOS 技术栈 | ClickHouse 24+（Event Lake）· pgvector:pg16（Decision Memory + Feature Store 持久化）· Redis（Feature 缓存） | ADR-0003 |
| D14 | DataOS 部署 | **独立 Compose 栈** `docker-compose.dataos.yml`；DataOS PG 端口 `5434`（避免与 ElectroOS `5432` / DevOS `5433` 冲突）；DataOS API 端口 `3300` | ADR-0003 |
| D15 | DataOS ↔ ElectroOS 通信 | ElectroOS → DataOS 通过 **HTTP internal API** + **BullMQ**（复用 Phase 2 Redis / 或 DataOS 独立 Redis） | ADR-0003 |
| D16 | PG 审计 vs CH 湖 | `agent_events`（ElectroOS PG）保留为**合规审计真相源**；ClickHouse `events` 为**分析湖**，异步最终一致；双写由 BullMQ 管道驱动，不影响主路径 | ADR-0003 |
| D17 | 降级策略 | 所有 DataOS 调用 `超时(5s) + try/catch`；DataOS 不可用时 Agent 降级为**无记忆模式**（Phase 1–2 行为） | Constitution Ch2 |
| D18 | DataOS 租户隔离 | ClickHouse: 应用层 `WHERE tenant_id`；PG: `UNIQUE(tenant_id, …)` + RLS（后续 hardening）；pgvector 检索 SQL 强制 `tenant_id` 谓词 | PDF §06 |

### 关键约束回顾（Constitution 硬门槛 — 延续 Phase 1–2）

- Agent **绝不**直调平台 SDK → 必须经 Harness（DataOS 是读特征/写事件，不替代 Harness）
- 所有核心表 **tenant_id + RLS**
- 价格变动 **>15%** 须人工审批
- 广告日预算 **>$500** 须人工审批
- 所有 Agent 操作写入**不可变审计日志**
- 测试覆盖率 **≥ 80%**

---

## 1. Monorepo 目录结构变更（Phase 3 增量）

```
patioer/                              # ElectroOS Monorepo root
├── apps/
│   ├── api/
│   │   └── src/
│   │       └── lib/
│   │           ├── dataos-port.ts    # NEW: DataOsPort 实现（HTTP client 桥接）
│   │           └── dataos-queue.ts   # NEW: BullMQ 生产者（ElectroOS → DataOS Lake 队列）
│   └── dataos-api/                   # NEW APP: DataOS Fastify 服务（端口 3300）
│       └── src/
│           ├── server.ts             # 入口：Fastify + workers 启动
│           ├── internal-routes.ts    # 内部 REST 路由 /internal/v1/*
│           ├── metrics.ts            # Prometheus 指标
│           ├── redis-url.ts          # Redis URL 解析
│           └── workers/
│               ├── ingestion.ts      # DA-01: BullMQ 消费者 → ClickHouse
│               ├── feature-agent.ts  # DA-02: */15 min → Feature Store 刷新
│               └── insight-agent.ts  # DA-03: 周一 09:00 → outcome 回写 + 周报
├── packages/
│   ├── dataos/                       # NEW PACKAGE: DataOS 核心服务层
│   │   ├── src/
│   │   │   ├── index.ts             # createDataOsServices factory + re-exports
│   │   │   ├── types.ts             # DataOS 数据类型
│   │   │   ├── constants.ts         # 队列名等共享常量
│   │   │   ├── event-lake.ts        # EventLakeService（ClickHouse 读写）
│   │   │   ├── feature-store.ts     # FeatureStoreService（Redis + PG 读写）
│   │   │   ├── decision-memory.ts   # DecisionMemoryService（pgvector 记忆）
│   │   │   └── embeddings.ts        # 向量化（OpenAI / 确定性 fallback）
│   │   ├── migrations/
│   │   │   └── 001_init.sql         # product_features + decision_memory 表
│   │   └── package.json
│   ├── dataos-client/                # NEW PACKAGE: ElectroOS 用的类型安全 HTTP 客户端
│   │   ├── src/
│   │   │   └── index.ts             # DataOsClient + createDataOsClientFromEnv
│   │   └── package.json
│   └── agent-runtime/
│       └── src/
│           ├── types.ts              # EXTEND: +DataOsPort +DataOsFeatureSnapshot
│           └── context.ts            # EXTEND: +dataOS 可选字段
├── docker-compose.dataos.yml         # NEW: DataOS 独立栈
├── docs/
│   └── adr/
│       └── 0003-phase3-dataos-stack.md  # NEW: DataOS 栈选型 ADR
├── scripts/
│   ├── clickhouse/
│   │   └── dataos-events.sql         # NEW: ClickHouse DDL
│   ├── clickhouse-apply-ddl.ts       # NEW: CH DDL 应用脚本
│   ├── dataos-migrate.ts             # NEW: DataOS PG 迁移脚本
│   └── dataos-pgvector-ivfflat.sql   # NEW: IVFFlat 索引（数据量足够后执行）
└── tsconfig.base.json                # EXTEND: +@patioer/dataos +@patioer/dataos-client 路径
```

---

## 2. 六 Sprint 分解（12 周）

### Sprint 1 · Week 1–2 — DataOS 基础设施部署 + 核心包骨架

**交付物：** ADR-0003 · docker-compose.dataos.yml 可启动 · ClickHouse DDL 已应用 · DataOS PG（pgvector）migrations 已应用 · `packages/dataos` 骨架（types + services） · `packages/dataos-client` HTTP client · `apps/dataos-api` 服务骨架 + health endpoint

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 1.1 | **ADR-0003** 撰写：DataOS 栈选型、端口分配、PG审计 vs CH湖 | `docs/adr/` | — | 0.5d |
| 1.2 | `docker-compose.dataos.yml`：ClickHouse + pgvector PG + Redis + DataOS API 骨架 | 根目录 | — | 0.5d |
| 1.3 | ClickHouse DDL：`electroos_events.events` + `price_events` 表 | `scripts/clickhouse/` | 1.2 | 0.5d |
| 1.4 | `scripts/clickhouse-apply-ddl.ts`：CH DDL 应用脚本 | `scripts/` | 1.3 | 0.5d |
| 1.5 | DataOS PG migration `001_init.sql`：`product_features` + `decision_memory` + pgvector | `packages/dataos/migrations/` | — | 0.5d |
| 1.6 | `scripts/dataos-migrate.ts`：PG 迁移运行器 | `scripts/` | 1.5 | 0.5d |
| 1.7 | `packages/dataos` 骨架：`types.ts` + `constants.ts` + `package.json` + `tsconfig.json` | `packages/dataos/` | — | 0.5d |
| 1.8 | `EventLakeService`：ClickHouse insert events / price_events | `packages/dataos/src/` | 1.7 | 1d |
| 1.9 | `FeatureStoreService`：Redis 缓存 + PG get/upsert | `packages/dataos/src/` | 1.7 | 1d |
| 1.10 | `embeddings.ts` + `DecisionMemoryService`：向量化 + recall/record/writeOutcome | `packages/dataos/src/` | 1.7 | 1d |
| 1.11 | `packages/dataos/src/index.ts`：`createDataOsServices` 工厂 | `packages/dataos/` | 1.8–1.10 | 0.5d |
| 1.12 | `packages/dataos-client`：HTTP 客户端 + `createDataOsClientFromEnv` | `packages/dataos-client/` | — | 1d |
| 1.13 | `apps/dataos-api` 服务骨架：server.ts + internal-routes.ts + metrics.ts | `apps/dataos-api/` | 1.11 | 1d |
| 1.14 | Sprint 1 全量 typecheck + 集成冒烟测试 | all | 1.1–1.13 | 0.5d |

**Sprint 1 验收：**
- [ ] `docker-compose -f docker-compose.dataos.yml up -d` 全部容器健康
- [ ] ClickHouse `electroos_events.events` / `price_events` 表已创建
- [ ] DataOS PG `product_features` / `decision_memory` 表已创建，pgvector 扩展已启用
- [ ] `packages/dataos` typecheck 通过
- [ ] `packages/dataos-client` typecheck 通过
- [ ] `apps/dataos-api` 启动并返回 `/health` 200
- [ ] CI pipeline 通过（含新包）

#### Sprint 1 · Day-by-Day 实施细节

---

##### Day 1 — ADR-0003 + docker-compose.dataos.yml + ClickHouse DDL

---

> **🃏 CARD-D1-01 · ADR-0003：DataOS 技术栈选型**
>
> **类型：** 文档  
> **耗时：** 1h  
> **目标文件：** `docs/adr/0003-phase3-dataos-stack.md`（新建）
>
> **内容结构（参照 ADR-0002 格式）：**
>
> | 章节 | 内容 |
> |------|------|
> | 1. 背景 | Phase 2 用 `agent_events` PG 表记录审计；Phase 3 需分析湖 + 实时特征 + 决策记忆 |
> | 2.1 职责划分 | ElectroOS `agent_events` = 审计真相源；CH `events` = 分析湖，异步最终一致 |
> | 2.2 技术栈 | Event Lake: ClickHouse 24+；Feature Store: Redis + PG(pgvector:pg16)；Decision Memory: PG + pgvector |
> | 2.3 端口 | CH `8123`/`9000`；DataOS PG `5434`；DataOS Redis `6380`；DataOS API `3300` |
> | 2.4 降级 | 所有 DataOS 调用超时 5s + try/catch；失败时 Agent 回退到 Phase 2 行为 |
> | 3. 备选 | 仅 PG 分区表（成本高于 CH）；同库（OLTP 争抢）；Kafka（蓝图明确不引入） |
>
> **验证：**
> ```bash
> # 文件存在且格式正确
> head -3 docs/adr/0003-phase3-dataos-stack.md
> # 期望：# ADR-0003 ·
> ```
>
> **产出：** ADR 文档落地

---

> **🃏 CARD-D1-02 · `docker-compose.dataos.yml`**
>
> **类型：** 新建文件  
> **耗时：** 1.5h  
> **目标文件：** `docker-compose.dataos.yml`（新建）
>
> **服务清单：**
>
> | 服务 | 镜像 | 宿主端口 | 说明 |
> |------|------|----------|------|
> | `dataos-clickhouse` | `clickhouse/clickhouse-server:24` | `8123:8123`、`9000:9000` | Event Lake |
> | `dataos-postgres` | `pgvector/pgvector:pg16` | `5434:5432` | Feature Store 持久化 + Decision Memory |
> | `dataos-redis` | `redis:7-alpine` | `6380:6379` | Feature Store 缓存 |
> | `dataos-api` | `node:22-alpine` | `3300:3300` | DataOS Fastify 服务（Sprint 1 末上线） |
>
> **关键环境变量：**
> ```
> CLICKHOUSE_DB=electroos_events
> CLICKHOUSE_USER=dataos
> CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-dataos}
> POSTGRES_DB=dataos
> POSTGRES_USER=dataos
> POSTGRES_PASSWORD=${DATAOS_PG_PASSWORD:-dataos}
> DATABASE_URL=postgres://dataos:${DATAOS_PG_PASSWORD:-dataos}@dataos-postgres:5432/dataos
> CLICKHOUSE_URL=http://dataos-clickhouse:8123
> REDIS_URL=redis://dataos-redis:6379
> ```
>
> **验证步骤：**
> ```bash
> # 1. 启动基础设施（不含 dataos-api，因为代码尚未就绪）
> docker-compose -f docker-compose.dataos.yml up -d dataos-clickhouse dataos-postgres dataos-redis
>
> # 2. 验证 ClickHouse
> curl -s 'http://localhost:8123/?query=SELECT%201' 
> # 期望：1
>
> # 3. 验证 PostgreSQL + pgvector
> docker exec patioer-dataos-postgres psql -U dataos -d dataos -c "SELECT 1;"
> # 期望：1
> docker exec patioer-dataos-postgres psql -U dataos -d dataos -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
> # 期望：0.x.x（pgvector 版本号）
>
> # 4. 验证 Redis
> docker exec patioer-dataos-redis redis-cli PING
> # 期望：PONG
> ```
>
> **验收：**
> - [ ] ClickHouse HTTP API 返回 `1`
> - [ ] DataOS PG 连接正常，pgvector 可加载
> - [ ] DataOS Redis PONG
> - [ ] 三个容器 `docker ps` 全部 healthy/running
>
> **产出：** DataOS 基础设施可启动

---

> **🃏 CARD-D1-03 · ClickHouse DDL：events + price_events 表**
>
> **类型：** 新建文件  
> **耗时：** 45 min  
> **目标文件：** `scripts/clickhouse/dataos-events.sql`（新建）
>
> **DDL 内容（与 PDF 第 5–6 页对齐）：**
>
> ```sql
> CREATE DATABASE IF NOT EXISTS electroos_events;
>
> CREATE TABLE IF NOT EXISTS electroos_events.events (
>     event_id UUID DEFAULT generateUUIDv4(),
>     tenant_id UUID NOT NULL,
>     platform String,
>     agent_id String NOT NULL,
>     event_type String NOT NULL,
>     entity_id String,
>     payload String,
>     metadata String,
>     created_at DateTime64(3) DEFAULT now64(3)
> ) ENGINE = MergeTree()
> PARTITION BY toYYYYMM(created_at)
> ORDER BY (tenant_id, agent_id, created_at)
> TTL created_at + INTERVAL 2 YEAR;
>
> CREATE TABLE IF NOT EXISTS electroos_events.price_events (
>     event_id UUID DEFAULT generateUUIDv4(),
>     tenant_id UUID NOT NULL,
>     platform String,
>     product_id String NOT NULL,
>     price_before Float64,
>     price_after Float64,
>     change_pct Float64,
>     approved UInt8,
>     conv_rate_7d Float64 DEFAULT 0,
>     revenue_7d Float64 DEFAULT 0,
>     created_at DateTime64(3) DEFAULT now64(3)
> ) ENGINE = MergeTree()
> ORDER BY (tenant_id, product_id, created_at);
> ```
>
> **手动验证（在 CH 运行后）：**
> ```bash
> # 逐条通过 HTTP API 执行
> curl -s 'http://localhost:8123/' --data-binary @scripts/clickhouse/dataos-events.sql
>
> # 验证表已创建
> curl -s 'http://localhost:8123/?query=SHOW%20TABLES%20FROM%20electroos_events'
> # 期望：events\nprice_events
>
> # 验证 TTL 设置
> curl -s 'http://localhost:8123/?query=SELECT%20name,engine_full%20FROM%20system.tables%20WHERE%20database=%27electroos_events%27%20FORMAT%20PrettyCompact'
> ```
>
> **产出：** ClickHouse Event Lake schema 落地

---

> **🃏 CARD-D1-04 · `scripts/clickhouse-apply-ddl.ts`**
>
> **类型：** 新建文件  
> **耗时：** 30 min  
> **目标文件：** `scripts/clickhouse-apply-ddl.ts`（新建）  
> **依赖：** CARD-D1-03
>
> **实现要求：**
> - 读取 `scripts/clickhouse/dataos-events.sql`
> - 按 `;` 分割为独立语句
> - 逐条通过 `@clickhouse/client` 执行
> - 跳过纯注释行
> - 打印每条语句的前 80 字符
>
> **验证：**
> ```bash
> CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=dataos CLICKHOUSE_PASSWORD=dataos \
>   pnpm exec tsx scripts/clickhouse-apply-ddl.ts
> # 期望：[clickhouse-apply-ddl] done
> ```
>
> **产出：** 可重复执行的 CH DDL 应用脚本

---

> **🃏 CARD-D1-05 · Day 1 回归 + 检查点**
>
> **类型：** 验证  
> **耗时：** 20 min  
> **依赖：** CARD-D1-01 ~ D1-04
>
> **检查点清单：**
>
> | # | 检查项 | 命令/方法 | 期望 |
> |---|--------|----------|------|
> | 1 | ADR-0003 已创建 | `cat docs/adr/0003-phase3-dataos-stack.md \| head -1` | `# ADR-0003` |
> | 2 | docker-compose 三容器运行 | `docker-compose -f docker-compose.dataos.yml ps` | 3 services Up |
> | 3 | CH events 表存在 | `curl 'localhost:8123/?query=SELECT+count()+FROM+electroos_events.events'` | `0` |
> | 4 | CH price_events 表存在 | `curl 'localhost:8123/?query=SELECT+count()+FROM+electroos_events.price_events'` | `0` |
> | 5 | DDL 脚本可执行 | `pnpm exec tsx scripts/clickhouse-apply-ddl.ts` | exit 0 |
> | 6 | 现有测试不受影响 | `pnpm test` | 0 failures |
>
> **产出：** Day 1 全部完成 · 代码可安全提交

---

**Day 1 卡片执行顺序汇总：**

```
09:00  CARD-D1-01  ADR-0003 撰写                    (1h)
10:00  CARD-D1-02  docker-compose.dataos.yml         (1.5h, 含容器验证)
11:30  午餐
13:00  CARD-D1-03  ClickHouse DDL 文件               (45min)
13:45  CARD-D1-04  clickhouse-apply-ddl.ts 脚本      (30min)
14:15  CARD-D1-05  回归 + 检查点                      (20min)
14:35  Day 1 完成
```

---

##### Day 2 — DataOS PostgreSQL（pgvector）Migration + 迁移脚本

---

> **🃏 CARD-D2-01 · DataOS PG Migration `001_init.sql`**
>
> **类型：** 新建文件  
> **耗时：** 1.5h  
> **目标文件：** `packages/dataos/migrations/001_init.sql`（新建）
>
> **DDL 内容（与 PDF 第 7、9 页对齐）：**
>
> ```sql
> CREATE EXTENSION IF NOT EXISTS vector;
> CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
>
> -- Feature Store 持久化表
> CREATE TABLE IF NOT EXISTS product_features (
>     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>     tenant_id UUID NOT NULL,
>     platform TEXT NOT NULL,
>     product_id TEXT NOT NULL,
>     price_current NUMERIC(10,2),
>     price_avg_30d NUMERIC(10,2),
>     price_min_30d NUMERIC(10,2),
>     price_max_30d NUMERIC(10,2),
>     price_volatility NUMERIC(5,4),
>     conv_rate_7d NUMERIC(5,4),
>     conv_rate_30d NUMERIC(5,4),
>     units_sold_7d INTEGER,
>     revenue_7d NUMERIC(12,2),
>     rank_in_category INTEGER,
>     stock_qty INTEGER,
>     days_of_stock INTEGER,
>     reorder_point INTEGER,
>     competitor_min_price NUMERIC(10,2),
>     competitor_avg_price NUMERIC(10,2),
>     price_position TEXT,
>     updated_at TIMESTAMPTZ DEFAULT NOW(),
>     UNIQUE (tenant_id, platform, product_id)
> );
>
> CREATE INDEX IF NOT EXISTS product_features_tenant_idx
>     ON product_features (tenant_id);
>
> -- Decision Memory 表
> CREATE TABLE IF NOT EXISTS decision_memory (
>     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>     tenant_id UUID NOT NULL,
>     agent_id TEXT NOT NULL,
>     platform TEXT,
>     entity_id TEXT,
>     context JSONB NOT NULL,
>     action JSONB NOT NULL,
>     outcome JSONB,
>     context_vector vector(1536),
>     decided_at TIMESTAMPTZ DEFAULT NOW(),
>     outcome_at TIMESTAMPTZ
> );
>
> CREATE INDEX IF NOT EXISTS decision_memory_tenant_agent_decided_idx
>     ON decision_memory (tenant_id, agent_id, decided_at DESC);
> ```
>
> **验证：**
> ```bash
> docker exec patioer-dataos-postgres psql -U dataos -d dataos \
>   -f /dev/stdin < packages/dataos/migrations/001_init.sql
>
> # 验证表
> docker exec patioer-dataos-postgres psql -U dataos -d dataos \
>   -c "\dt"
> # 期望：product_features, decision_memory
>
> # 验证 vector 扩展
> docker exec patioer-dataos-postgres psql -U dataos -d dataos \
>   -c "SELECT typname FROM pg_type WHERE typname='vector';"
> # 期望：vector
> ```
>
> **产出：** DataOS PG 表结构落地

---

> **🃏 CARD-D2-02 · `scripts/dataos-migrate.ts` 迁移运行器**
>
> **类型：** 新建文件  
> **耗时：** 30 min  
> **目标文件：** `scripts/dataos-migrate.ts`（新建）  
> **依赖：** CARD-D2-01
>
> **实现要求：**
> - 读取 `packages/dataos/migrations/` 下所有 `.sql` 文件（排序执行）
> - 使用 `pg` 客户端连接 `DATABASE_URL`
> - 每个文件整体执行
> - 打印 `[dataos-migrate] applying <filename>`
>
> **验证：**
> ```bash
> DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm exec tsx scripts/dataos-migrate.ts
> # 期望：[dataos-migrate] applying 001_init.sql
> #        [dataos-migrate] done
> ```
>
> **产出：** 可重复执行的 PG 迁移脚本

---

> **🃏 CARD-D2-03 · `scripts/dataos-pgvector-ivfflat.sql`（预留）**
>
> **类型：** 新建文件  
> **耗时：** 15 min  
> **目标文件：** `scripts/dataos-pgvector-ivfflat.sql`（新建）
>
> **内容：**
> ```sql
> -- 在 decision_memory 积累足够行（>100/租户）后手动执行。
> CREATE INDEX CONCURRENTLY IF NOT EXISTS decision_memory_context_vector_ivfflat
>     ON decision_memory
>     USING ivfflat (context_vector vector_cosine_ops)
>     WITH (lists = 100);
> ```
>
> **注意：** 此 SQL **不在 Day 2 执行**，仅预创建文件。Sprint 4 数据量足够后手动 apply。
>
> **产出：** IVFFlat 索引 DDL 预留

---

> **🃏 CARD-D2-04 · Day 2 回归 + 检查点**
>
> **类型：** 验证  
> **耗时：** 20 min  
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `product_features` 表存在 | `\dt` 可见 |
> | 2 | `decision_memory` 表存在 | `\dt` 可见 |
> | 3 | `vector` 类型可用 | `SELECT '[]'::vector(3)` 不报错 |
> | 4 | UNIQUE 约束生效 | 重复 INSERT 同 `(tenant_id, platform, product_id)` 报 conflict |
> | 5 | 迁移脚本幂等 | 再次执行 `dataos-migrate.ts` 不报错 |
> | 6 | 现有测试不受影响 | `pnpm test` exit 0 |
>
> **产出：** Day 2 完成

---

**Day 2 卡片执行顺序汇总：**

```
09:00  CARD-D2-01  DataOS PG migration                (1.5h)
10:30  CARD-D2-02  dataos-migrate.ts 脚本             (30min)
11:00  CARD-D2-03  pgvector IVFFlat SQL 预留          (15min)
11:15  CARD-D2-04  回归 + 检查点                      (20min)
11:35  Day 2 完成
```

---

##### Day 3 — `packages/dataos` 包骨架（types + constants + package.json）

---

> **🃏 CARD-D3-01 · `packages/dataos/package.json` + `tsconfig.json`**
>
> **类型：** 新建文件  
> **耗时：** 20 min  
> **目标文件：** `packages/dataos/package.json`、`packages/dataos/tsconfig.json`（新建）
>
> **`package.json` 关键依赖：**
> ```json
> {
>   "name": "@patioer/dataos",
>   "dependencies": {
>     "@clickhouse/client": "^1.11.0",
>     "ioredis": "^5.10.1",
>     "openai": "^4.0.0",
>     "pg": "latest"
>   }
> }
> ```
>
> **`tsconfig.json`：** extends `../../tsconfig.base.json`
>
> **验证：**
> ```bash
> pnpm install --no-frozen-lockfile
> ls packages/dataos/node_modules/@clickhouse
> # 期望：client 目录存在
> ```
>
> **产出：** 包骨架可解析依赖

---

> **🃏 CARD-D3-02 · `tsconfig.base.json` 路径映射扩展**
>
> **类型：** 代码变更  
> **耗时：** 10 min  
> **目标文件：** `tsconfig.base.json`
>
> **变更：** 在 `paths` 中追加：
> ```json
> "@patioer/dataos": ["packages/dataos/src/index.ts"],
> "@patioer/dataos-client": ["packages/dataos-client/src/index.ts"]
> ```
>
> **验证：** `pnpm --filter @patioer/dataos typecheck`
>
> **产出：** Monorepo 路径映射就绪

---

> **🃏 CARD-D3-03 · `packages/dataos/src/types.ts`**
>
> **类型：** 新建文件  
> **耗时：** 30 min  
> **目标文件：** `packages/dataos/src/types.ts`（新建）
>
> **类型清单（与 PDF 数据模型对齐）：**
>
> | 类型 | 用途 |
> |------|------|
> | `DataOsEventLakeRecord` | ClickHouse `events` 写入载荷 |
> | `DataOsPriceEventRecord` | ClickHouse `price_events` 写入载荷 |
> | `ProductFeaturesRow` | PG `product_features` 行映射 |
> | `DecisionMemoryRow` | PG `decision_memory` 行映射（含可选 `similarity`） |
>
> **验证：** `pnpm --filter @patioer/dataos typecheck`
>
> **产出：** DataOS 类型定义

---

> **🃏 CARD-D3-04 · `packages/dataos/src/constants.ts`**
>
> **类型：** 新建文件  
> **耗时：** 5 min  
> **目标文件：** `packages/dataos/src/constants.ts`（新建）
>
> **内容：**
> ```typescript
> export const DATAOS_LAKE_QUEUE_NAME = 'dataos-lake-ingest'
> ```
>
> **产出：** 共享常量

---

> **🃏 CARD-D3-05 · Day 3 回归**
>
> ```bash
> pnpm --filter @patioer/dataos typecheck
> pnpm typecheck
> pnpm test
> ```
>
> **产出：** Day 3 完成 · 包骨架可编译

---

**Day 3 卡片执行顺序汇总：**

```
09:00  CARD-D3-01  package.json + tsconfig.json       (20min)
09:20  CARD-D3-02  tsconfig.base.json 路径映射        (10min)
09:30  CARD-D3-03  types.ts 类型定义                   (30min)
10:00  CARD-D3-04  constants.ts                        (5min)
10:05  CARD-D3-05  回归                                (15min)
10:20  Day 3 完成
```

---

##### Day 4 — EventLakeService（ClickHouse 读写）

---

> **🃏 CARD-D4-01 · `packages/dataos/src/event-lake.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2h  
> **目标文件：** `packages/dataos/src/event-lake.ts`（新建）
>
> **类 API（与 PDF 伪代码对齐）：**
>
> ```typescript
> export class EventLakeService {
>   constructor(cfg: EventLakeConfig)
>   get raw(): ClickHouseClient  // 供 Feature Agent 直接聚合查询
>   insertEvent(row: DataOsEventLakeRecord): Promise<void>
>   insertPriceEvent(row: DataOsPriceEventRecord): Promise<void>
>   close(): Promise<void>
> }
> ```
>
> **实现约束：**
> - 使用 `@clickhouse/client` 的 `insert({ format: 'JSONEachRow' })`
> - `payload` / `metadata` 字段：若为对象则 `JSON.stringify`
> - `close()` 幂等
>
> **测试用例名字（Day 4 编写 mock 测试；集成测试 Sprint 2）：**
> - `insertEvent calls client.insert with correct table and format`
> - `insertEvent serializes object payload to JSON string`
> - `insertPriceEvent maps approved boolean to UInt8`
> - `close can be called multiple times`
>
> **验证：** `pnpm --filter @patioer/dataos typecheck`
>
> **产出：** Event Lake 服务层落地

---

> **🃏 CARD-D4-02 · Day 4 回归**
>
> ```bash
> pnpm --filter @patioer/dataos typecheck
> pnpm test
> ```

---

**Day 4 卡片执行顺序：**

```
09:00  CARD-D4-01  EventLakeService 实现              (2h)
11:00  CARD-D4-02  回归                                (15min)
```

---

##### Day 5 — FeatureStoreService（Redis + PG）

---

> **🃏 CARD-D5-01 · `packages/dataos/src/feature-store.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2.5h  
> **目标文件：** `packages/dataos/src/feature-store.ts`（新建）
>
> **类 API（与 PDF 第 8 页对齐）：**
>
> ```typescript
> export class FeatureStoreService {
>   constructor(pool: Pool, redis: Redis)
>   get(tenantId, platform, productId, metrics?): Promise<ProductFeaturesRow | null>
>   upsert(input: FeatureStoreUpsertInput): Promise<void>
> }
> ```
>
> **实现约束：**
> - `get()`：先查 Redis `feature:{tenantId}:{platform}:{productId}`；miss 则查 PG 并回填 Redis（TTL 900s）
> - `upsert()`：PG `INSERT ... ON CONFLICT DO UPDATE`；成功后更新 Redis 缓存
> - `metrics` 参数可选：`{ cacheHit?: () => void; cacheMiss?: () => void }`，供 Prometheus 计数
>
> **测试用例名字：**
> - `get returns cached value when Redis has key`
> - `get queries PG and caches result when Redis misses`
> - `get returns null when product not found`
> - `upsert inserts new row and caches in Redis`
> - `upsert updates existing row via ON CONFLICT`
> - `metrics.cacheHit called on Redis hit`
> - `metrics.cacheMiss called on Redis miss`
>
> **产出：** Feature Store 服务层落地

---

##### Day 6 — DecisionMemoryService（pgvector + embeddings）

---

> **🃏 CARD-D6-01 · `packages/dataos/src/embeddings.ts`**
>
> **类型：** 新建文件  
> **耗时：** 1h  
> **目标文件：** `packages/dataos/src/embeddings.ts`（新建）
>
> **函数签名：**
> ```typescript
> export function deterministicEmbedding(text: string): number[]  // 1536-d, for tests/dev
> export async function embedText(text: string, options): Promise<number[]>
> ```
>
> **实现约束：**
> - 当 `OPENAI_API_KEY` 未设置时使用 `deterministicEmbedding`（SHA-256 hash → 确定性单位向量）
> - 有 key 时调用 OpenAI `text-embedding-3-small`，维度 1536
>
> **测试用例：**
> - `deterministicEmbedding returns 1536-d unit vector`
> - `deterministicEmbedding is deterministic for same input`
> - `embedText falls back to deterministic when no API key`

---

> **🃏 CARD-D6-02 · `packages/dataos/src/decision-memory.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2h  
> **目标文件：** `packages/dataos/src/decision-memory.ts`（新建）
>
> **类 API（与 PDF 第 9–10 页对齐）：**
>
> ```typescript
> export class DecisionMemoryService {
>   constructor(pool: Pool, openaiApiKey?: string)
>   recall(tenantId, agentId, currentContext, options?): Promise<DecisionMemoryRow[]>
>   record(input: DecisionMemoryRecordInput): Promise<string>  // 返回 decision id
>   writeOutcome(decisionId, tenantId, outcome): Promise<void>
>   listPendingOutcomesOlderThan(days: number): Promise<...[]>
> }
> ```
>
> **关键 SQL：**
> - `recall`：`WHERE tenant_id = $1 AND agent_id = $2` **强制过滤** + `1 - (context_vector <=> $3::vector) >= $4` 相似度阈值 + `ORDER BY context_vector <=> $3::vector LIMIT $5`
> - `record`：INSERT 含 `$7::vector` 参数化向量
> - `writeOutcome`：`UPDATE ... WHERE id = $1 AND tenant_id = $2`（租户限定）
>
> **⚠️ 注意：** PDF 中 SQL 使用 `similarity` 别名在 WHERE 中，PostgreSQL 不支持；实施时使用重复表达式 `(1 - (context_vector <=> $3::vector))` 或子查询。
>
> **测试用例：**
> - `recall returns empty when no memories exist`
> - `recall filters by tenant_id (cross-tenant isolation)`
> - `recall filters by similarity threshold`
> - `record inserts decision with context_vector`
> - `writeOutcome updates outcome and outcome_at`
> - `listPendingOutcomesOlderThan returns decisions without outcome`

---

##### Day 7 — createDataOsServices 工厂 + index.ts

---

> **🃏 CARD-D7-01 · `packages/dataos/src/index.ts`**
>
> **类型：** 新建文件  
> **耗时：** 1.5h  
>
> **工厂函数：**
> ```typescript
> export function createDataOsServices(config: DataOsServicesConfig): DataOsServices
> ```
>
> 组合 `Pool` + `Redis` + `EventLakeService` + `FeatureStoreService` + `DecisionMemoryService`，提供统一 `shutdown()` 方法。
>
> **验证：** `pnpm --filter @patioer/dataos typecheck`

---

##### Day 8 — `packages/dataos-client` HTTP 客户端

---

> **🃏 CARD-D8-01 · `packages/dataos-client/package.json` + `tsconfig.json`**
>
> **类型：** 新建文件  
> **耗时：** 10 min

---

> **🃏 CARD-D8-02 · `packages/dataos-client/src/index.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2h  
>
> **类 API：**
> ```typescript
> export class DataOsClient {
>   constructor(options: DataOsClientOptions)
>   recordLakeEvent(body): Promise<boolean>
>   recordPriceEvent(body): Promise<boolean>
>   getFeatures(platform, productId): Promise<ProductFeaturesSnapshot | null>
>   recallMemory(agentId, context): Promise<unknown[] | null>
>   recordMemory(body): Promise<string | null>
> }
> export function createDataOsClientFromEnv(tenantId, env?): DataOsClient | null
> ```
>
> **实现约束：**
> - 所有请求 `AbortController` 超时 5s（可配置）
> - 失败返回 `null`（不抛异常 → 降级友好）
> - 请求头：`X-DataOS-Internal-Key` + `X-Tenant-Id`
> - `DATAOS_ENABLED=0` 时 `createDataOsClientFromEnv` 返回 `null`
>
> **测试用例：**
> - `getFeatures returns null on timeout`
> - `getFeatures returns null when DATAOS_ENABLED=0`
> - `recordLakeEvent returns true on success`
> - `recallMemory returns memories array`
> - `createDataOsClientFromEnv returns null without DATAOS_API_URL`

---

##### Day 9 — `apps/dataos-api` 服务骨架

---

> **🃏 CARD-D9-01 · `apps/dataos-api/package.json` + `tsconfig.json`**  
> **耗时：** 10 min

---

> **🃏 CARD-D9-02 · `apps/dataos-api/src/server.ts`**
>
> **类型：** 新建文件  
> **耗时：** 1.5h  
>
> **Fastify 服务器：**
> - 端口 `3300`（`PORT` 环境变量）
> - `/health` → `{ ok: true, service: 'dataos-api' }`
> - `/metrics` → Prometheus 文本格式
> - 调用 `createDataOsServices()` 初始化后注册 `internal-routes`
> - SIGINT/SIGTERM graceful shutdown
>
> **验证：**
> ```bash
> docker-compose -f docker-compose.dataos.yml up -d
> # 等待 dataos-api 就绪
> curl -s http://localhost:3300/health | jq .
> # 期望：{ "ok": true, "service": "dataos-api" }
> ```

---

> **🃏 CARD-D9-03 · `apps/dataos-api/src/internal-routes.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2h  
>
> **路由清单：**
>
> | Method | Path | 说明 |
> |--------|------|------|
> | POST | `/internal/v1/lake/events` | 写入 ClickHouse events |
> | POST | `/internal/v1/lake/price-events` | 写入 ClickHouse price_events |
> | GET | `/internal/v1/features/:platform/:productId` | 读取 Feature Store |
> | POST | `/internal/v1/features/upsert` | 更新 Feature Store |
> | POST | `/internal/v1/memory/recall` | Decision Memory 召回 |
> | POST | `/internal/v1/memory/record` | Decision Memory 记录 |
> | POST | `/internal/v1/memory/outcome` | Decision Memory outcome 回写 |
>
> **安全：** 所有路由通过 `X-DataOS-Internal-Key` header 鉴权（对内 API）。
>
> **验证：** typecheck + 手动 curl 测试各路由

---

> **🃏 CARD-D9-04 · `apps/dataos-api/src/metrics.ts`**  
> **耗时：** 30 min  
>
> **Prometheus 指标：**
> - `dataos_feature_cache_hits_total`
> - `dataos_feature_cache_misses_total`
> - `dataos_lake_events_inserted_total`
> - `dataos_ingestion_jobs_processed_total`

---

##### Day 10 — Sprint 1 集成冒烟 + 检查点

---

> **🃏 CARD-D10-01 · Sprint 1 全量验证**
>
> ```bash
> # 1. 类型检查
> pnpm typecheck
>
> # 2. 全量测试
> pnpm test
>
> # 3. DataOS 容器验证
> docker-compose -f docker-compose.dataos.yml up -d
> curl -s http://localhost:3300/health
>
> # 4. ClickHouse 写入冒烟
> curl -s -X POST http://localhost:3300/internal/v1/lake/events \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -d '{"tenantId":"00000000-0000-0000-0000-000000000001","agentId":"price-sentinel","eventType":"test","payload":{}}' | jq .
> # 期望：{ "ok": true }
>
> # 验证 CH 有数据
> curl -s 'http://localhost:8123/?query=SELECT+count()+FROM+electroos_events.events'
> # 期望：1
>
> # 5. Feature Store 冒烟
> curl -s -X POST http://localhost:3300/internal/v1/features/upsert \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -d '{"tenantId":"00000000-0000-0000-0000-000000000001","platform":"shopify","productId":"P001","priceCurrent":29.99}' | jq .
> # 期望：{ "ok": true }
> ```
>
> **Sprint 1 检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | ADR-0003 已创建 | 文件存在 |
> | 2 | `docker-compose.dataos.yml` 四服务可启动 | `docker-compose ps` 全部 Up |
> | 3 | CH events/price_events 表存在 | SHOW TABLES 返回 2 表 |
> | 4 | DataOS PG 两表存在，pgvector 可用 | `\dt` + `SELECT '[]'::vector(3)` |
> | 5 | `packages/dataos` typecheck 通过 | exit 0 |
> | 6 | `packages/dataos-client` typecheck 通过 | exit 0 |
> | 7 | `apps/dataos-api` /health 返回 200 | curl 验证 |
> | 8 | 写入 lake event 可从 CH 查回 | count() > 0 |
> | 9 | Feature Store upsert + get 正常 | curl 返回 ok |
> | 10 | 现有 ElectroOS 测试无破坏 | `pnpm test` 0 failures |

---

### Sprint 2 · Week 3–4 — Event Lake 与 Ingestion Agent（BullMQ 管道）

**交付物：** Ingestion Worker 消费 BullMQ → CH 写入 · ElectroOS logAction 自动 enqueue · 死信队列 · E2E 验证

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 2.1 | BullMQ 队列名常量 + Lake 事件 envelope 类型 | `packages/dataos/`, `packages/dataos-client/` | — | 0.5d |
| 2.2 | Ingestion Worker（BullMQ 消费 → CH insert） | `apps/dataos-api/src/workers/` | 2.1 | 1d |
| 2.3 | `apps/api/src/lib/dataos-queue.ts`：ElectroOS BullMQ 生产者 | `apps/api/` | 2.1 | 0.5d |
| 2.4 | ElectroOS `buildAuditDeps` 扩展：logAction → enqueue 到 DataOS Lake | `apps/api/src/routes/` | 2.3 | 0.5d |
| 2.5 | 死信队列 + 失败重试策略 | `apps/dataos-api/` | 2.2 | 0.5d |
| 2.6 | ClickHouse 批量 insert 优化（buffer flush） | `packages/dataos/` | 2.2 | 0.5d |
| 2.7 | E2E 测试：agent execute → CH events 行验证 | `apps/api/` tests | 2.4 | 1d |
| 2.8 | `price_events` 专用表：Price Sentinel 调价写入 | `apps/api/` + `packages/dataos/` | 2.4 | 0.5d |
| 2.9 | Prometheus 指标：ingestion 吞吐 / 失败率 / 队列深度 | `apps/dataos-api/` | 2.2 | 0.5d |
| 2.10 | Sprint 2 集成验证 + 检查点 | all | 2.1–2.9 | 0.5d |

**Sprint 2 验收：**
- [ ] Agent 执行后 ClickHouse `events` 表有对应记录
- [ ] BullMQ ingestion 队列处理消息，无积压
- [ ] 失败消息进入死信队列（可重试或告警）
- [ ] ElectroOS 主路径不受 DataOS 失败阻塞
- [ ] `pnpm test` 全量通过

---

### Sprint 3 · Week 5–6 — Feature Store + Feature Agent

**交付物：** Feature Agent 每 15 分钟刷新 Feature Store · Redis 缓存命中率 >90% · ElectroOS 可读取 Feature

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 3.1 | Feature Store 集成测试（PG upsert + Redis cache + TTL） | `packages/dataos/` tests | — | 1d |
| 3.2 | Feature Store Redis 缓存命中率 Prometheus 指标 | `apps/dataos-api/src/metrics.ts` | — | 0.5d |
| 3.3 | Feature Agent worker（`*/15 * * *` interval → CH 聚合 → upsert） | `apps/dataos-api/src/workers/` | — | 1.5d |
| 3.4 | Feature Agent 测试（mock CH 数据 → 验证 upsert） | `apps/dataos-api/` tests | 3.3 | 1d |
| 3.5 | DataOS API features 路由测试（GET + POST upsert） | `apps/dataos-api/` tests | — | 0.5d |
| 3.6 | ElectroOS `dataos-client` 读取 Feature Store 冒烟 | `apps/api/` + `packages/dataos-client/` | — | 0.5d |
| 3.7 | Feature Store 多租户隔离测试 | `packages/dataos/` tests | 3.1 | 1d |
| 3.8 | Feature Agent 预算封顶（`budget` 配置 + haiku 可选摘要） | `apps/dataos-api/` | 3.3 | 0.5d |
| 3.9 | Feature Store 缓存预热策略 | `apps/dataos-api/` | 3.3 | 0.5d |
| 3.10 | Sprint 3 集成验证 + 检查点 | all | 3.1–3.9 | 0.5d |

**Sprint 3 验收：**
- [ ] Feature Agent 每 15 分钟触发，`product_features.updated_at` 持续更新
- [ ] Redis 缓存命中率 >90%（Prometheus 指标验证）
- [ ] ElectroOS 通过 `dataos-client` 可读取 Feature Store 数据
- [ ] 租户 A 不能读取租户 B 的特征数据

---

### Sprint 4 · Week 7–8 — Decision Memory + Insight Agent

**交付物：** DecisionMemory recall/record 完整可用 · Insight Agent 每周一回写 outcome · IVFFlat 索引（条件执行）

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 4.1 | DecisionMemory 集成测试（record → recall → writeOutcome） | `packages/dataos/` tests | — | 1.5d |
| 4.2 | Embedding 服务集成测试（OpenAI mock + deterministic fallback） | `packages/dataos/` tests | — | 0.5d |
| 4.3 | DecisionMemory 跨租户隔离测试（recall 只返回当前租户） | `packages/dataos/` tests | 4.1 | 1d |
| 4.4 | Insight Agent worker（每周一 09:00 → listPendingOutcomes → CH 聚合 → writeOutcome） | `apps/dataos-api/src/workers/` | — | 1.5d |
| 4.5 | Insight Agent 周报生成（Ticket 创建 → 与 DevOS Ticket 协议对齐） | `apps/dataos-api/` | 4.4 | 1d |
| 4.6 | DataOS API memory 路由测试（recall + record + outcome） | `apps/dataos-api/` tests | — | 0.5d |
| 4.7 | IVFFlat 索引创建（条件：`decision_memory` 行数 > 100） | `scripts/` | 4.1 | 0.5d |
| 4.8 | pgvector 查询性能基准测试（100/1K/10K 行） | `packages/dataos/` tests | 4.7 | 0.5d |
| 4.9 | Decision Memory 召回精度调优（similarity threshold） | `packages/dataos/` | 4.8 | 0.5d |
| 4.10 | Sprint 4 集成验证 + 检查点 | all | 4.1–4.9 | 0.5d |

**Sprint 4 验收：**
- [ ] Price Sentinel 调价后 `decision_memory` 有对应记录（含 context_vector）
- [ ] Insight Agent 每周一运行，将 7 天前决策回写 outcome
- [ ] 向量召回：相似情境返回 ≥3 条历史案例
- [ ] 跨租户 recall 返回 0 条（隔离验证）

---

### Sprint 5 · Week 9–10 — ElectroOS Agent 深度接入 + A/B 可观测

**交付物：** Price Sentinel 升级为学习型 · Content Writer + Market Intel Agent · DataOS 降级模式 · A/B 指标

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 5.1 | `DataOsPort` 接口（agent-runtime types.ts） | `packages/agent-runtime/` | — | 0.5d |
| 5.2 | `AgentContext.dataOS` 可选字段注入 | `packages/agent-runtime/src/context.ts` | 5.1 | 0.5d |
| 5.3 | `apps/api/src/lib/dataos-port.ts`：DataOsPort 实现（桥接 dataos-client） | `apps/api/` | 5.1, 5.2 | 0.5d |
| 5.4 | Price Sentinel 接入 Feature Store（读 features → 注入 prompt context） | `packages/agent-runtime/src/agents/` | 5.2, 5.3 | 1d |
| 5.5 | Price Sentinel 接入 Decision Memory（recall 历史案例 → 注入 prompt） | `packages/agent-runtime/src/agents/` | 5.4 | 1d |
| 5.6 | Price Sentinel 决策后写入 Memory + Event Lake（record + recordLakeEvent + recordPriceEvent） | `packages/agent-runtime/src/agents/` | 5.5 | 1d |
| 5.7 | Content Writer Agent（E-07）：on-demand · 读 Feature Store · 写 Event Lake | `packages/agent-runtime/src/agents/` | 5.3 | 1d |
| 5.8 | Market Intel Agent（E-08）：周一定时 · 写 Feature Store 竞品字段 + Event Lake | `packages/agent-runtime/src/agents/` | 5.3 | 1d |
| 5.9 | 降级测试：DataOS 不可用时 Agent 正常运行（无记忆模式） | `apps/api/` tests | 5.4–5.6 | 0.5d |
| 5.10 | A/B 可观测：定义指标（有/无 DataOS 的转化率/营收/人工介入率对比） | docs + metrics | 5.6 | 0.5d |

**Sprint 5 验收：**
- [ ] Price Sentinel prompt 中可见 `conv_rate_7d` 特征
- [ ] Price Sentinel prompt 中可见历史调价案例
- [ ] Content Writer Agent on-demand 触发正常生成文案
- [ ] Market Intel Agent 每周一更新 Feature Store 竞品价格特征
- [ ] DataOS 不可用时 Agent 仍可执行（降级日志可见）

---

### Sprint 6 · Week 11–12 — 全量验证 + 21 项验收清单

**交付物：** PDF 第 18–19 页 21 项 AC 全部通过 · 三层隔离集成测试 · 压测记录 · Phase 4 准备

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 6.1 | DataOS 基础设施 AC（4 项）：Paperclip/API 运行、CH 表创建、PG pgvector、Redis <5ms | all | — | 1d |
| 6.2 | Event Lake & Feature Store AC（5 项）：CH 有记录、Ingestion 无丢失、Feature 15min 刷新、缓存 >90%、CH 聚合 <2s | all | — | 1.5d |
| 6.3 | Decision Memory AC（4 项）：调价后有记录、Insight 回写 outcome、向量召回 ≥3 条、outcome >50 条 | all | — | 1d |
| 6.4 | Agent 升级效果 AC（4 项）：PS 含 features、PS 含 memories、Content Writer 正常、Market Intel 正常 | all | — | 1d |
| 6.5 | 数据隔离 & 安全 AC（4 项）：三层隔离测试通过、DataOS 宕机降级、pgvector 不跨租户、TTL 2 年 | all | — | 1.5d |
| 6.6 | 隔离集成测试：`dataos-isolation.test.ts`（仿 `e2e-tenant-isolation.integration.test.ts`） | tests | 6.5 | 1d |
| 6.7 | ClickHouse 写入压测记录（100 万事件聚合 <2s） | scripts + docs | — | 0.5d |
| 6.8 | pgvector 检索压测记录（万级行 recall 延迟） | scripts + docs | — | 0.5d |
| 6.9 | 验收证据归档 + 文档更新 | docs | 6.1–6.8 | 0.5d |
| 6.10 | Sprint 6 最终检查点 → Phase 4 就绪 | all | 6.1–6.9 | 0.5d |

**Sprint 6 验收（= Phase 3 出口）：**
PDF **21 项**全部 ✅ → 进入 Phase 4

---

## 3. 关键接口定义

### 3.1 DataOsPort（packages/agent-runtime/src/types.ts 扩展）

```typescript
export interface DataOsPort {
  getFeatures(platform: string, productId: string): Promise<DataOsFeatureSnapshot | null>
  recallMemory(agentId: string, context: unknown): Promise<unknown[] | null>
  recordMemory(input: {
    agentId: string; platform?: string; entityId?: string;
    context: unknown; action: unknown
  }): Promise<string | null>
  recordLakeEvent(input: {
    agentId: string; eventType: string; entityId?: string;
    payload: unknown; metadata?: unknown
  }): Promise<void>
  recordPriceEvent(input: {
    productId: string; priceBefore: number; priceAfter: number;
    changePct: number; approved: boolean
  }): Promise<void>
}
```

### 3.2 DataOsClient（packages/dataos-client/src/index.ts）

```typescript
export class DataOsClient {
  constructor(options: DataOsClientOptions)
  recordLakeEvent(body: DataOsLakeEventPayload): Promise<boolean>
  recordPriceEvent(body): Promise<boolean>
  getFeatures(platform: string, productId: string): Promise<ProductFeaturesSnapshot | null>
  recallMemory(agentId: string, context: unknown): Promise<unknown[] | null>
  recordMemory(body): Promise<string | null>
}
```

### 3.3 AgentContext 扩展（Phase 3）

```typescript
export interface AgentContext {
  // ... Phase 1–2 接口保留 ...
  dataOS?: DataOsPort  // Phase 3 新增；undefined = 降级模式
}
```

---

## 4. 集成架构（Phase 3）

```
┌─────────────────────────────┐     HTTP     ┌────────────────────────┐
│  ElectroOS API (:3100)      │◄────────────►│  Paperclip (:3000)     │
│  5+2 Agents (运营)           │              │  (Agent 编排)           │
│  DataOsClient (降级友好)     │              │                        │
└──────────┬──────────────────┘              └────────────────────────┘
           │ BullMQ                                     │
           │ enqueue                                    │
           ▼                                            │
┌─────────────────────────────┐                        │
│  DataOS API (:3300)         │     HTTP               │
│  Ingestion Worker (BullMQ)  │◄───────────────────────┘
│  Feature Agent (*/15min)    │
│  Insight Agent (Mon 09:00)  │
│                             │
│  ┌─────────────┐            │     ┌─────────────────────┐
│  │ ClickHouse  │ Event Lake │     │  DevOS (:3200)      │
│  │ :8123       │            │     │  (独立 Paperclip)    │
│  └─────────────┘            │     └─────────────────────┘
│  ┌─────────────┐            │
│  │ PG+pgvector │ Features + │
│  │ :5434       │ Memory     │
│  └─────────────┘            │
│  ┌─────────────┐            │
│  │ Redis       │ Cache      │
│  │ :6380       │            │
│  └─────────────┘            │
└─────────────────────────────┘

    ElectroOS DB (PG + RLS)          DataOS DB (PG + pgvector)
    :5432                            :5434
```

### 4.1 Price Sentinel 升级后执行流程（Phase 3）

```
Paperclip Heartbeat
  ──► HTTP callback
  ──► /api/v1/agents/:id/execute
                    │
                    ▼
              AgentContext 构建
               ├── getHarness → products
               ├── ctx.dataOS?.getFeatures(product.id)
               │     └── 从 Feature Store 获取 conv_rate_7d 等特征
               ├── ctx.dataOS?.recallMemory('price-sentinel', { product, features })
               │     └── 从 Decision Memory 获取历史相似决策
               ├── ctx.llm({ prompt: enriched with features + memories })
               │     └── Claude 基于特征 + 历史记忆做决策
               ├── Harness.updatePrice(...)
               ├── ctx.dataOS?.recordMemory({ context, action })
               │     └── 记录本次决策（7 天后 Insight Agent 回写 outcome）
               └── ctx.dataOS?.recordLakeEvent(...)
                     └── 事件写入 Event Lake
```

---

## 5. 技术栈清单（Phase 3 增量）

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| Event Lake | **ClickHouse** | 24+ | 列式存储，时序查询，TTL 2 年 |
| Feature Store PG | **pgvector/pgvector** | pg16 | Feature 持久化 + Decision Memory 向量检索 |
| Feature Cache | **Redis** | 7+ | Feature Store 缓存，TTL 900s |
| Embedding | **OpenAI text-embedding-3-small** | — | 1536 维，`$0.02/1M tokens`；无 key 时确定性 fallback |
| DataOS API | **Fastify** | latest | 对内 REST + Worker 进程 |
| 事件传输 | **BullMQ** | latest | ElectroOS → DataOS 异步管道 |

---

## 6. 三层存储安全隔离方案

| 存储 | 隔离策略 | 验证方法 |
|------|----------|----------|
| **ClickHouse Event Lake** | 所有查询 `WHERE tenant_id` 强制过滤；应用层不可省略 | 租户 A 查询不含租户 B event_id |
| **PG Feature Store** | `UNIQUE(tenant_id, platform, product_id)`；RLS（后续 hardening） | 跨租户 `get()` 返回 null |
| **pgvector Decision Memory** | `WHERE tenant_id=$1` 强制过滤在 recall SQL 中 | 相同情境跨租户 recall 返回 0 条 |

---

## 7. 风险 & 缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ClickHouse 写入性能不达标 | 中 | 中 | 批量 insert + BullMQ 缓冲；Week 1–2 压测基线 |
| pgvector 检索延迟/精度 | 中 | 中 | IVFFlat `lists` 调参；similarity 阈值 0.85 可调；租户内数据量监控 |
| DataOS 故障拖垮 ElectroOS | 低 | 高 | 超时 5s + try/catch 降级；BullMQ 异步不阻塞主路径 |
| 双写一致性（PG vs CH） | 中 | 低 | PG `agent_events` 为审计真相源；CH 为分析异步最终一致 |
| OpenAI Embedding API 限流/费用 | 低 | 中 | 确定性 fallback；batch embedding；token 预算 |

---

## 8. DataOS 内部 API（OpenAPI 片段）

| Method | Path | 说明 | 鉴权 |
|--------|------|------|------|
| GET | `/health` | 健康检查 | 无 |
| GET | `/metrics` | Prometheus 指标 | 无 |
| POST | `/internal/v1/lake/events` | 写入 Event Lake | `X-DataOS-Internal-Key` |
| POST | `/internal/v1/lake/price-events` | 写入价格事件 | `X-DataOS-Internal-Key` |
| GET | `/internal/v1/features/:platform/:productId` | 读取 Feature | `X-DataOS-Internal-Key` + `X-Tenant-Id` |
| POST | `/internal/v1/features/upsert` | 更新 Feature | `X-DataOS-Internal-Key` |
| POST | `/internal/v1/memory/recall` | 决策记忆召回 | `X-DataOS-Internal-Key` + `X-Tenant-Id` |
| POST | `/internal/v1/memory/record` | 记录决策 | `X-DataOS-Internal-Key` + `X-Tenant-Id` |
| POST | `/internal/v1/memory/outcome` | 回写结果 | `X-DataOS-Internal-Key` |

---

## 9. Phase 3 验收清单（21 项）

> **状态说明：** ⬜ 待做 · ✅ 已达成 · ⏳ 进行中

### DataOS 基础设施（4 项）

- [ ] **AC-P3-01** DataOS API 独立运行（端口 3300），`/health` 返回 200
- [ ] **AC-P3-02** ClickHouse 正常启动，`electroos_events.events` / `price_events` 表已创建
- [ ] **AC-P3-03** PostgreSQL pgvector 扩展已启用，`product_features` + `decision_memory` 表已创建
- [ ] **AC-P3-04** Redis 连接正常，Feature Store 缓存读写延迟 < 5ms

### Event Lake & Feature Store（5 项）

- [ ] **AC-P3-05** Price Sentinel 调价后，ClickHouse `price_events` 表有对应记录
- [ ] **AC-P3-06** Ingestion Agent 持续运行，ElectroOS 所有 Agent 操作均写入 `events` 表，无丢失
- [ ] **AC-P3-07** Feature Agent 每 15 分钟触发，`product_features.updated_at` 持续更新
- [ ] **AC-P3-08** Feature Store Redis 缓存命中率 > 90%（Prometheus 指标验证）
- [ ] **AC-P3-09** ClickHouse 查询性能：100 万条事件聚合查询 < 2s

### Decision Memory（4 项）

- [ ] **AC-P3-10** Price Sentinel 每次调价后，`decision_memory` 表有对应记录（含 context_vector）
- [ ] **AC-P3-11** Insight Agent 每周一运行，将 7 天前的决策回写 outcome
- [ ] **AC-P3-12** Decision Memory 向量召回：相似情境下正确返回 ≥3 条历史案例
- [ ] **AC-P3-13** 有 outcome 数据的 Decision Memory 数量 > 50 条（运行 2 周以上）

### Agent 升级效果（4 项）

- [ ] **AC-P3-14** Price Sentinel 接入 Feature Store 后，prompt 中可见 `conv_rate_7d` 特征
- [ ] **AC-P3-15** Price Sentinel 接入 Decision Memory 后，prompt 中可见历史调价案例
- [ ] **AC-P3-16** Content Writer Agent 上线，on-demand 触发正常生成商品文案
- [ ] **AC-P3-17** Market Intel Agent 上线，每周一更新 Feature Store 竞品价格特征

### 数据隔离 & 安全（4 项）

- [ ] **AC-P3-18** 租户隔离测试全部通过（Event Lake + Feature Store + Decision Memory 三层）
- [ ] **AC-P3-19** DataOS 实例故障时（停止容器），ElectroOS Agent 仍可正常运行（降级为无记忆模式）
- [ ] **AC-P3-20** pgvector 向量检索不跨租户验证：100% 通过
- [ ] **AC-P3-21** 数据保留策略验证：ClickHouse TTL 2 年生效

---

## 10. 文档更新计划

| 文档 | 变更 |
|------|------|
| `docs/adr/0003-phase3-dataos-stack.md` | 新建：DataOS 技术栈 ADR |
| `docs/operations.md` | 追加 DataOS 运维章节 |
| `docs/ops/dataos-local.md` | 新建：本地开发 DataOS 指南 |
| `docs/openapi/dataos-internal-v1.yaml` | 新建：DataOS 对内 API OpenAPI 文档 |

---

**全部 21 项验收通过 → 进入 Phase 4：全链路自动化 + Autonomous Dev Loop**
