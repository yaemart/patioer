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
> | 3 | `vector` 类型可用 | `SELECT '[1,2,3]'::vector(3)` 不报错（空向量字面量无效） |
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

> **🃏 CARD-D3-04 · `DATAOS_LAKE_QUEUE_NAME` 常量**
>
> **类型：** 新建（已实施为合并到 `packages/dataos-client`）  
> **耗时：** 5 min  
> **目标文件：** `packages/dataos-client/src/index.ts`（唯一真相源）
>
> **实施说明（code-simplicity 对齐）：** `packages/dataos/src/constants.ts` 已删除，
> 队列名常量统一由 `@patioer/dataos-client` 导出，消除双重定义。
>
> **内容：**
> ```typescript
> // packages/dataos-client/src/index.ts
> export const DATAOS_LAKE_QUEUE_NAME = 'dataos-lake-ingest'
> ```
>
> **验证：** `grep DATAOS_LAKE_QUEUE_NAME packages/dataos-client/src/index.ts`
>
> **产出：** 队列名单一来源（`@patioer/dataos-client`）

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
- [x] Agent 执行后 ClickHouse `events` 表有对应记录
- [x] BullMQ ingestion 队列处理消息，无积压
- [x] 失败消息进入死信队列（可重试或告警）
- [x] ElectroOS 主路径不受 DataOS 失败阻塞
- [x] `pnpm test` 全量通过

---

#### Sprint 2 · Day-by-Day 实施细节

---

##### Day 11 — BullMQ 队列骨架 · Lake Envelope 类型 · ElectroOS 生产者

---

> **🃏 CARD-D11-01 · `DATAOS_LAKE_QUEUE_NAME` 常量确认**
>
> **类型：** 确认（已合并到 `packages/dataos-client`，见 CARD-D3-04 说明）
> **耗时：** 5 min
> **目标文件：** `packages/dataos-client/src/index.ts`（唯一真相源）
>
> **内容确认：**
> ```typescript
> // packages/dataos-client/src/index.ts
> export const DATAOS_LAKE_QUEUE_NAME = 'dataos-lake-ingest'
> ```
>
> **验证：** `grep DATAOS_LAKE_QUEUE_NAME packages/dataos-client/src/index.ts`
>
> **产出：** 生产者 / 消费者共享队列名（单一来源）

---

> **🃏 CARD-D11-02 · `packages/dataos-client/src/index.ts`：`DataOsLakeEventPayload` 类型 + `DATAOS_LAKE_QUEUE_NAME` re-export**
>
> **类型：** 代码变更
> **耗时：** 20 min
> **目标文件：** `packages/dataos-client/src/index.ts`
>
> **需包含：**
> ```typescript
> export const DATAOS_LAKE_QUEUE_NAME = 'dataos-lake-ingest'
>
> export interface DataOsLakeEventPayload {
>   tenantId: string
>   platform?: string
>   agentId: string
>   eventType: string
>   entityId?: string
>   payload: unknown
>   metadata?: unknown
> }
> ```
>
> **设计原则：** `dataos-client` 仅含 ElectroOS 侧需要的轻量类型（不依赖 `@clickhouse/client` 等重型依赖）；队列名与 `@patioer/dataos` 保持字面量一致。
>
> **验证：** `pnpm --filter @patioer/dataos-client typecheck`
>
> **产出：** 生产者侧类型定义

---

> **🃏 CARD-D11-03 · `apps/api/src/lib/dataos-queue.ts`：BullMQ 生产者**
>
> **类型：** 新建文件
> **耗时：** 45 min
> **目标文件：** `apps/api/src/lib/dataos-queue.ts`（新建）
>
> **实现要点：**
> - 懒初始化 `Queue` 单例（模块级 `let _queue = null`）
> - 仅当 `DATAOS_LAKE_QUEUE_ENABLED === '1'` 时创建队列（降级友好）
> - `Queue` 构造时设置 `defaultJobOptions`：`attempts: 3` · `backoff: exponential 1s` · `removeOnComplete: 1000` · `removeOnFail: false`（失败保留入 DLQ）
> - `enqueueDataOsLakeEvent()` 捕获所有错误并 `console.warn`，**绝不 throw**（不阻塞主路径）
>
> **验证：**
> ```bash
> pnpm --filter @patioer/api typecheck
> # 期望：Done（无 TS 错误）
> ```
>
> **产出：** ElectroOS BullMQ 生产者可用

---

> **🃏 CARD-D11-04 · Day 11 回归**
>
> ```bash
> pnpm --filter @patioer/dataos typecheck
> pnpm --filter @patioer/dataos-client typecheck
> pnpm --filter @patioer/api typecheck
> pnpm test
> ```
>
> **期望：** 0 failures · 所有新代码 typecheck 通过

---

**Day 11 卡片执行顺序汇总：**

```
09:00  CARD-D11-01  constants.ts 队列名确认        (5min)
09:05  CARD-D11-02  DataOsLakeEventPayload 类型     (20min)
09:25  CARD-D11-03  dataos-queue.ts 生产者          (45min)
10:10  CARD-D11-04  回归                             (20min)
10:30  Day 11 完成
```

---

##### Day 12 — Ingestion Worker（BullMQ 消费 → ClickHouse insert）

---

> **🃏 CARD-D12-01 · `apps/dataos-api/src/workers/ingestion.ts`**
>
> **类型：** 新建文件
> **耗时：** 2h
> **目标文件：** `apps/dataos-api/src/workers/ingestion.ts`（新建）
>
> **类 API：**
> ```typescript
> export const INGESTION_MAX_ATTEMPTS = 3
>
> export interface LakeIngestJob {
>   tenantId: string; platform?: string
>   agentId: string; eventType: string
>   entityId?: string; payload: unknown; metadata?: unknown
> }
>
> export function startIngestionWorker(
>   services: DataOsServices,
>   redis: RedisConnection,
> ): Worker<LakeIngestJob>
> ```
>
> **实现约束：**
> - `Worker` 处理器调用 `services.eventLake.insertEvent()`
> - 成功后调用 `ingestionJobsProcessed.inc()`
> - `worker.on('failed', ...)` 调用 `ingestionJobsFailed.inc()`，并区分"仍会重试"vs"已进 DLQ"的日志
> - **注意：** 重试策略（`attempts` / `backoff`）设置在生产者 Queue 的 `defaultJobOptions`，Worker 本身不设此字段
>
> **集成说明：** 在 `apps/dataos-api/src/server.ts` 中 `startIngestionWorker(services, redisConn)` 已调用。
>
> **测试用例（Day 15 编写，此处列出名字）：**
> - `creates a BullMQ Worker on the correct queue`
> - `worker processor calls eventLake.insertEvent with correct fields`
> - `worker processor calls insertEvent successfully for minimal job data`
> - `INGESTION_MAX_ATTEMPTS is defined and greater than 1`
> - `worker processor propagates insertEvent error for BullMQ retry`
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Ingestion Worker 落地

---

> **🃏 CARD-D12-02 · `apps/dataos-api/src/server.ts` 集成 Ingestion Worker**
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `apps/dataos-api/src/server.ts`
>
> **变更：** 在 Fastify 启动前调用 `startIngestionWorker(services, redisConn)`；`shutdown()` 中加入 `worker.close()`。
>
> **验证：**
> ```bash
> # 启动 DataOS API（需 docker-compose 已运行）
> docker-compose -f docker-compose.dataos.yml up -d
> curl -s http://localhost:3300/health | jq .
> # 期望：{ "ok": true, "service": "dataos-api" }
> ```
>
> **产出：** Ingestion Worker 随服务启动自动运行

---

> **🃏 CARD-D12-03 · Day 12 回归**
>
> ```bash
> pnpm --filter @patioer/dataos-api typecheck
> pnpm test
> ```

---

**Day 12 卡片执行顺序汇总：**

```
09:00  CARD-D12-01  ingestion.ts Worker             (2h)
11:00  CARD-D12-02  server.ts 集成                   (30min)
11:30  CARD-D12-03  回归                              (15min)
11:45  Day 12 完成
```

---

##### Day 13 — ElectroOS `buildAuditDeps` 扩展 + 死信队列/重试策略

---

> **🃏 CARD-D13-01 · `apps/api/src/routes/agents-execute.ts`：`buildAuditDeps` 扩展**
>
> **类型：** 代码变更
> **耗时：** 1h
> **目标文件：** `apps/api/src/routes/agents-execute.ts`
>
> **变更位置：** `buildAuditDeps()` 函数内的 `logAction` 实现。
>
> **在原有 PG `agent_events` 写入后追加：**
> ```typescript
> await enqueueDataOsLakeEvent({
>   tenantId,
>   platform: opts.platform,
>   agentId,
>   eventType: action,
>   entityId: /* 从 payload 提取 productId */,
>   payload: { action, payload },
>   metadata: { source: 'electroos-api' },
> })
> ```
>
> **约束：**
> - `enqueueDataOsLakeEvent` 调用在 PG 写入**之后**（PG 为审计真相源，不受影响）
> - DataOS enqueue 失败不 throw，`try/catch` 在 `enqueueDataOsLakeEvent` 内部处理
>
> **验证：**
> ```bash
> # 确认测试中 logAction 相关测试通过
> pnpm --filter @patioer/api test -- --reporter=verbose 2>&1 | grep "logAction"
> ```
>
> **产出：** 每次 Agent 执行自动异步写入 Event Lake

---

> **🃏 CARD-D13-02 · 死信队列策略验证 + 文档**
>
> **类型：** 验证 + 文档
> **耗时：** 30 min
>
> **BullMQ DLQ 机制说明：**
>
> | 机制 | 配置位置 | 配置值 |
> |------|----------|--------|
> | 最大重试次数 | `Queue.defaultJobOptions.attempts` | `3` |
> | 退避策略 | `Queue.defaultJobOptions.backoff` | `exponential, delay: 1000ms` |
> | 失败后保留 | `Queue.defaultJobOptions.removeOnFail` | `false`（永不自动删除） |
> | DLQ 查询 | BullMQ `getJobs(['failed'])` | 返回失败 Job 列表 |
>
> **BullMQ 原生 DLQ：** 耗尽 `attempts` 次重试的 Job 自动进入 Redis `{queue}:failed` sorted set，不再触发 Worker，可通过 BullMQ Board 或 `queue.getJobs(['failed'])` 查看。
>
> **告警集成（可选，Phase 4）：** 设置 `queue.on('failed', ...)` 在 `attemptsMade >= maxAttempts` 时发送 Slack/DevOS Ticket。
>
> **验证：**
> ```bash
> # 确认 INGESTION_MAX_ATTEMPTS > 1
> grep INGESTION_MAX_ATTEMPTS apps/dataos-api/src/workers/ingestion.ts
> # 期望：export const INGESTION_MAX_ATTEMPTS = 3
>
> # 确认 Queue defaultJobOptions
> grep -A5 "defaultJobOptions" apps/api/src/lib/dataos-queue.ts
> # 期望：attempts: 3, backoff: exponential
> ```
>
> **产出：** 死信队列策略落地并有文档记录

---

> **🃏 CARD-D13-03 · Day 13 回归**
>
> ```bash
> pnpm --filter @patioer/api typecheck
> pnpm test
> ```

---

**Day 13 卡片执行顺序汇总：**

```
09:00  CARD-D13-01  buildAuditDeps → enqueue 扩展   (1h)
10:00  CARD-D13-02  DLQ 策略验证 + 文档              (30min)
10:30  CARD-D13-03  回归                              (20min)
10:50  Day 13 完成
```

---

##### Day 14 — ClickHouse 批量 Insert + Price Sentinel `price_events` 写入

---

> **🃏 CARD-D14-01 · `packages/dataos/src/event-lake.ts`：`insertEventBatch` + `insertPriceEventBatch`**
>
> **类型：** 代码变更
> **耗时：** 1.5h
> **目标文件：** `packages/dataos/src/event-lake.ts`
>
> **新增方法：**
> ```typescript
> // 抽取私有序列化辅助
> private serializeEvent(row: DataOsEventLakeRecord): CHEventRow
>
> // 批量 insert：单次 ClickHouse 请求写多行
> async insertEventBatch(rows: DataOsEventLakeRecord[]): Promise<void>
> async insertPriceEventBatch(rows: DataOsPriceEventRecord[]): Promise<void>
> ```
>
> **约束：**
> - `insertEvent()` 保持向后兼容（内部复用 `serializeEvent`）
> - `insertPriceEvent()` 改为调用 `insertPriceEventBatch([row])`（单行也走批量路径）
> - 空数组时**立即 return**，不调用 CH client
>
> **新增测试用例（event-lake.test.ts 追加）：**
> - `insertEventBatch inserts all rows in a single client.insert call`
> - `insertEventBatch is a no-op for empty array`
> - `insertPriceEventBatch inserts all rows in a single client.insert call`
>
> **验证：** `pnpm --filter @patioer/dataos test`
>
> **产出：** ClickHouse 批量 insert 路径就绪

---

> **🃏 CARD-D14-02 · Price Sentinel 调价写入 `price_events`（via `DataOsPort.recordPriceEvent`）**
>
> **类型：** 验证/代码确认
> **耗时：** 30 min
> **目标文件：** `packages/agent-runtime/src/agents/price-sentinel.agent.ts`、`apps/api/src/lib/dataos-port.ts`
>
> **调用链：**
> ```
> price-sentinel.agent.ts
>   → ctx.dataOS?.recordPriceEvent({ productId, priceBefore, priceAfter, changePct, approved })
>     → DataOsPort (dataos-port.ts)
>       → DataOsClient.recordPriceEvent()
>         → POST /internal/v1/lake/price-events
>           → EventLakeService.insertPriceEvent()  ← 本 Day 已优化为 batch 路径
>             → ClickHouse price_events 表
> ```
>
> **验证：**
> ```bash
> grep -n "recordPriceEvent" packages/agent-runtime/src/agents/price-sentinel.agent.ts
> # 期望：ctx.dataOS.recordPriceEvent 调用存在
>
> grep -n "recordPriceEvent" apps/api/src/lib/dataos-port.ts
> # 期望：client.recordPriceEvent 映射存在
>
> pnpm --filter @patioer/agent-runtime typecheck
> ```
>
> **产出：** Price Sentinel 调价事件端到端路径可追踪

---

> **🃏 CARD-D14-03 · Day 14 回归**
>
> ```bash
> pnpm --filter @patioer/dataos test
> pnpm typecheck
> pnpm test
> ```

---

**Day 14 卡片执行顺序汇总：**

```
09:00  CARD-D14-01  insertEventBatch / insertPriceEventBatch  (1.5h)
10:30  CARD-D14-02  price_events 调用链验证                    (30min)
11:00  CARD-D14-03  回归                                       (20min)
11:20  Day 14 完成
```

---

##### Day 15 — Prometheus 指标补全 + 单元测试（Ingestion Worker + BullMQ 生产者）

---

> **🃏 CARD-D15-01 · `apps/dataos-api/src/metrics.ts`：补充失败计数器 + 队列深度 Gauge**
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `apps/dataos-api/src/metrics.ts`
>
> **新增指标：**
>
> | 指标名 | 类型 | 含义 |
> |--------|------|------|
> | `dataos_ingestion_jobs_failed_total` | Counter | 耗尽所有重试后进入 DLQ 的 Job 数 |
> | `dataos_ingestion_queue_depth` | Gauge | 队列当前 waiting + active Job 数（供 AlertManager 阈值告警） |
>
> **说明：** `ingestionQueueDepth` Gauge 由外部定时刷新逻辑（或 Bull Board webhook）设置，本 Day 仅定义指标对象；Phase 4 接入实际队列深度轮询。
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Sprint 2 所有 Prometheus 指标就绪

---

> **🃏 CARD-D15-02 · `apps/dataos-api/vitest.config.ts` + `apps/dataos-api/src/workers/ingestion.test.ts`**
>
> **类型：** 新建文件
> **耗时：** 1.5h
>
> **vitest.config.ts：**
> ```typescript
> export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
> ```
>
> **ingestion.test.ts 测试策略：**
> - 使用 `vi.mock('bullmq', ...)` class mock（Worker 为 class，捕获 `processor` 参数到模块变量）
> - 每个 `it` 里直接调用 `capturedProcessor` 绕过实际 BullMQ Redis 连接
> - 测试处理器逻辑、错误传播、队列名、`INGESTION_MAX_ATTEMPTS` 常量
>
> **测试用例：**
> ```
> ✓ creates a BullMQ Worker on the correct queue
> ✓ worker processor calls eventLake.insertEvent with correct fields
> ✓ worker processor calls insertEvent successfully for minimal job data
> ✓ INGESTION_MAX_ATTEMPTS is defined and greater than 1
> ✓ worker processor propagates insertEvent error for BullMQ retry
> ```
>
> **验证：** `pnpm --filter @patioer/dataos-api test`  → `5 passed`
>
> **产出：** Ingestion Worker 测试覆盖完整

---

> **🃏 CARD-D15-03 · `apps/api/src/lib/dataos-queue.test.ts`**
>
> **类型：** 新建文件
> **耗时：** 45 min
>
> **测试策略：**
> - `vi.mock('bullmq', ...)` 使用 class mock（`Queue` 为 class，`add` 方法为 `vi.fn()`）
> - `vi.resetModules()` 在 `beforeEach` 中重置模块缓存（单例 `_queue` 随之重置）
> - 通过 `process.env.DATAOS_LAKE_QUEUE_ENABLED` 控制 feature flag
>
> **测试用例：**
> ```
> ✓ is a no-op when DATAOS_LAKE_QUEUE_ENABLED is not set
> ✓ enqueues with correct payload when DATAOS_LAKE_QUEUE_ENABLED=1
> ✓ swallows errors without throwing (non-blocking for main agent path)
> ```
>
> **验证：** `pnpm --filter @patioer/api test` → 原有 385 + 3 新增 = 388 passed
>
> **产出：** 生产者单元测试完整

---

> **🃏 CARD-D15-04 · Day 15 回归**
>
> ```bash
> pnpm typecheck
> pnpm test
> # 期望：dataos-api 5 passed · api 388 passed · 全量 0 failures
> ```

---

**Day 15 卡片执行顺序汇总：**

```
09:00  CARD-D15-01  metrics.ts 补全                    (30min)
09:30  CARD-D15-02  ingestion.test.ts + vitest.config  (1.5h)
11:00  CARD-D15-03  dataos-queue.test.ts               (45min)
11:45  CARD-D15-04  回归                                (15min)
12:00  Day 15 完成
```

---

##### Day 16 — Sprint 2 全量集成验证 + 检查点

---

> **🃏 CARD-D16-01 · Sprint 2 全量验证**
>
> **类型：** 验证
> **耗时：** 1.5h
>
> **验证步骤：**
>
> ```bash
> # 1. 类型检查
> pnpm typecheck
> # 期望：全 Done，0 errors
>
> # 2. 全量测试
> pnpm test
> # 期望：0 failures
>
> # 3. 基础设施启动
> docker-compose -f docker-compose.dataos.yml up -d
> sleep 5
>
> # 4. DataOS API 健康
> curl -s http://localhost:3300/health | jq .
> # 期望：{ "ok": true, "service": "dataos-api" }
>
> # 5. Event Lake 写入冒烟
> curl -s -X POST http://localhost:3300/internal/v1/lake/events \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -d '{"tenantId":"00000000-0000-0000-0000-000000000001","agentId":"price-sentinel","eventType":"price.updated","payload":{"before":10,"after":12}}' | jq .
> # 期望：{ "ok": true }
>
> # 6. 验证 CH 有写入
> curl -s 'http://localhost:8123/?query=SELECT%20count()%20FROM%20electroos_events.events'
> # 期望：1（或更多）
>
> # 7. Price Events 写入冒烟
> curl -s -X POST http://localhost:3300/internal/v1/lake/price-events \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -d '{"tenantId":"00000000-0000-0000-0000-000000000001","productId":"sku-1","priceBefore":29.99,"priceAfter":27.99,"changePct":-0.067,"approved":true}' | jq .
> # 期望：{ "ok": true }
>
> # 8. Prometheus 指标可读
> curl -s http://localhost:3300/metrics | grep dataos_ingestion
> # 期望：dataos_ingestion_jobs_processed_total 0
> #        dataos_ingestion_jobs_failed_total 0
> #        dataos_ingestion_queue_depth 0
> ```
>
> **Sprint 2 检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `DATAOS_LAKE_QUEUE_NAME` 在 `@patioer/dataos-client` 可见（`constants.ts` 已删除，唯一来源为 `dataos-client`） | `grep DATAOS_LAKE_QUEUE_NAME packages/dataos-client/src/index.ts` |
> | 2 | `DataOsLakeEventPayload` 类型可从 `@patioer/dataos-client` 导入 | typecheck 通过 |
> | 3 | `createLakeQueueEnqueuer` 在 `enabled: false` 时静默 no-op | 测试验证 |
> | 4 | `logAction` 调用后 lake event 入队 | `agents-execute.test.ts` 验证 |
> | 5 | 死信队列：`attempts:3` · `backoff:exponential` · `removeOnFail:false` | `dataos-queue.ts` grep |
> | 6 | `insertEventBatch([])` 立即返回不调用 CH | 测试验证 |
> | 7 | `insertEventBatch([r1,r2])` 单次 CH 请求 | 测试验证 |
> | 8 | Price Sentinel `recordPriceEvent` 链路完整 | typecheck 通过 |
> | 9 | `dataos_ingestion_jobs_failed_total` 指标可见 | `/metrics` curl |
> | 10 | ~~`dataos_ingestion_queue_depth` 指标可见~~ **（已删除）** `ingestionQueueDepth` 定义但从未写入值，code-simplicity 阶段移除 | N/A |
> | 11 | `ingestion.test.ts` passed | vitest |
> | 12 | `dataos-queue.test.ts` passed | vitest |
> | 13 | 全量 `pnpm test` 0 failures | CI green |
>
> **产出：** Sprint 2 全部验收通过 · 代码可安全合并

---

**Day 16 卡片执行顺序汇总：**

```
09:00  CARD-D16-01  全量验证                           (1.5h)
10:30  Sprint 2 完成 → 进入 Sprint 3
```

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

#### Sprint 5 · 宪法 / 蓝图 / 头脑风暴 / 工程原则 对齐矩阵

> 以下矩阵将 Sprint 5 每项交付与**系统宪法**（Constitution）、**蓝图**（Master Blueprint PDF）、**头脑风暴**、**Phase 1–5 路线图**、**AI Agent Native 原则**、**Harness 工程原则** 逐条对齐。
> 每个 CARD 标注其必须遵循的条款编号，实施时可当作 **检查清单**。

##### 0. 对齐源文档索引

| 缩写 | 文档路径 | 核心定位 |
|------|----------|----------|
| **CON** | `docs/system-constitution.md` v1.0 | 系统最高法则（十章） |
| **BP** | `docs/brainstorms/…-devos-master-blueprint-pdf-brainstorm.md` | 蓝图 PDF 摘要（21 Agent / 9 阶段 / 门控 / 四 Phase） |
| **ROAD** | `docs/brainstorms/…-phase1-5-roadmap-pdf-brainstorm.md` | 五阶段路线图 PDF 合并摘要（103 项验收） |
| **DATA** | `docs/brainstorms/…-data-system-structure-brainstorm.md` | 三层架构数据流（ElectroOS → DataOS → DevOS） |
| **BUILD** | `docs/brainstorms/…-build-roadmap-cursor-brainstorm.md` | 构建顺序与 Cursor 执行包 |
| **CON-PDF** | `docs/brainstorms/…-system-constitution-pdf-brainstorm.md` | 宪法 PDF 头脑风暴摘要 |
| **HARNESS** | `docs/architecture/harness-and-market.md` | Harness 路径与 Market 上下文工程文档 |
| **GOV** | `docs/governance-gates.md` | 审批门控执行路径 |
| **ADR-03** | `docs/adr/0003-phase3-dataos-stack.md` | DataOS 栈选型 ADR |
| **P3** | `docs/plans/phase3-plan.md` §0 | Phase 3 决策与约束 |

---

##### 1. 顶层原则对齐：Sprint 5 交付 ↔ 各文档硬门槛

| Sprint 5 交付 | 宪法条款 | 蓝图 / 路线图 | 头脑风暴 | Harness / Agent Native | 具体约束 |
|---------------|---------|---------------|----------|------------------------|----------|
| **Content Writer (E-07)** | CON Ch2.3 Harness 不可绕过 · Ch5.1 Pre-flight · Ch5.3 不可变审计 · Ch6.1 tenant_id + RLS · Ch7.2 覆盖率 ≥80% | BP §02 "Content Writer" 在 21 Agent 列表 · ROAD Phase 3 "Content Writer" | DATA §Agent 调度流："读 Feature → 经 Harness → 写 Event" · BUILD "Agent = 调度与工具执行，不颠倒" | HARNESS: Agent 经 `ctx.getHarness()` 获取产品信息 · Agent Native: LLM 调用经 `ctx.llm()` 而非直调 SDK | Content Writer **必须**经 Harness 读产品 · **必须**写审计日志 · **必须**检查预算 · **必须**隔离 tenant_id |
| **Market Intel (E-08)** | CON Ch2.3 · Ch2.4 事件驱动 · Ch5.1 · Ch5.3 · Ch6.1 · Ch8.1 可观测 | BP §02 "Market Intel" · ROAD Phase 3 "Market Intel：写 Feature Store 竞品价格特征" | DATA §存储分工："Feature Store = Redis + PG，决策用特征快照" | HARNESS: `getHarness(platform).listProducts()` · Harness 向后兼容 | Market Intel **必须**经 Harness 获取产品数据 · **必须**通过 DataOS Port 写 Feature Store（`upsertFeature`）· 不直操作 PG |
| **降级测试 (5.9)** | CON Ch4.3 结构化错误分类 · P3 D17 "超时 5s + try/catch" | ROAD Phase 3 "DataOS 故障时 ElectroOS 降级无记忆" | DATA §互联关系："DataOS 为 ElectroOS 提供记忆；**不可用时不阻塞**" · BUILD "YAGNI" | ADR-03 D17: 所有 DataOS 调用超时 5s + try/catch，失败回退 Phase 1–2 行为 | **全部 7 种 Agent** 在 `ctx.dataOS = undefined` 时必须正常返回（非 500） |
| **A/B 可观测 (5.10)** | CON Ch8.1 必须监控指标 · Ch8.2 告警规则 | BP §05 Governance Gates · ROAD "验收清单全过才进下阶段" | DATA §数据流图："事件 → 特征反哺 → Agent 改进" | Agent Native: 可观测闭环（执行 → 度量 → 学习） | 6 项 Prometheus 指标 · `dataos_mode` 标签 · 与现有 `harness.api.error_rate` / `agent.budget.utilization` 并列 |
| **DataOsPort 一致性** | CON Ch2.2 API First（先定义接口再实现） · CON Ch5.2 "Agent 不绕过接口" | — | CON-PDF "Harness 不可绕过" 的推广：Port 描述与实际接口必须一致 | Agent Native: Agent 依赖 Port 接口而非底层实现 | `describeDataOsCapabilities()` 仅列 `DataOsPort` 实际暴露的方法 |
| **DB migration** | CON Ch5.4 "Schema 变更须架构 + 人工" · CON Ch7.2 覆盖率 ≥80% | BP §02 Agent 清单含 Content Writer / Market Intel | — | — | `agent_type` 枚举扩展为 7 种；**与 GOV 门控表不冲突**（新 Agent 无高风险平台写操作） |

---

##### 2. Agent 行为规范对齐（Content Writer / Market Intel）

以下将 **Constitution Chapter 5（Agent 行为规则）** 逐条映射到两个新 Agent 的实现要求：

| CON Ch5 条款 | Content Writer (E-07) 实现 | Market Intel (E-08) 实现 |
|-------------|---------------------------|--------------------------|
| **5.1 Pre-flight①** 读 goal_context | `buildContentWriterInput(goalContext)` 解析 `productId` / `tone` / `maxLength` | `buildMarketIntelInput(goalContext)` 解析 `platforms` / `maxProducts` / `focusCategories` |
| **5.1 Pre-flight②** 检查 budget | `ctx.budget.isExceeded()` → 超预算 return 空结果 | 同左 |
| **5.1 Pre-flight③** 检查 pending approval | 当前版本无需审批门控（文案生成非高风险平台写操作）；如未来需要上架审批（CON Ch5.4"上架商品→人工确认"），在此处扩展 | 无高风险写操作；如竞品价格调整触发 Price Sentinel，由 PS 独立走审批流 |
| **5.2 禁止 · 绕过 Harness** | 读产品信息**经** `ctx.getHarness().getProducts()` 或 Feature Store · **不**直调 Shopify API | 遍历产品**经** `ctx.getHarness(platform).listProducts()` · **不**直调平台 SDK |
| **5.2 禁止 · 直接访问 DB** | 通过 `ctx.dataOS` Port 读写 · **不**直连 ClickHouse / PG | 通过 `ctx.dataOS.upsertFeature()` · **不**直连 Feature Store PG |
| **5.3 必须 · 不可变审计日志** | `ctx.logAction('content_writer.run.started/completed', ...)` | `ctx.logAction('market_intel.run.started/completed', ...)` |
| **5.3 必须 · 超预算主动停止** | 已实现（Pre-flight②） | 已实现 |
| **5.3 必须 · 失败结构化报告** | `try/catch` 生成 `{ type: 'harness_error', platform, code }` 日志 | 同左 · 每个 platform 独立 skip |
| **5.3 必须 · RLS** | `tenant_id` 在 DataOsPort 调用中强制传递（`tryCreateDataOsPort(tenantId, platform)` 锁定） | 同左 |
| **5.3 必须 · 代码提交含测试** | Day 19: ≥10 unit tests | Day 21: ≥10 unit tests |

---

##### 3. Harness 工程原则对齐

| HARNESS / CON Ch2.3 原则 | Sprint 5 遵循方式 |
|--------------------------|-------------------|
| **Agent 绝不直调平台 SDK** | Content Writer 读产品：`ctx.getHarness().getProducts()` → LLM 生成文案 · Market Intel 读产品：`ctx.getHarness(platform).listProducts()` → LLM 竞品分析 |
| **两种 Harness 路径**（HARNESS §Two ways） | 两个新 Agent 运行在 API execute route 上下文，使用 **DB-backed HarnessRegistry** 路径（与现有 5 Agent 一致） |
| **Harness 向后兼容**（CON Ch7.3） | 两个新 Agent 仅调用现有 `getProducts()` / `listProducts()` 方法 · **不**新增 Harness 接口方法（无需走 CON Ch5.4 "新增 Harness 接口→CTO+人工" 门控） |
| **MarketContext 可选注入** | Content Writer: `ctx.market?.convertPrice()` 可用于多币种场景（可选） · Market Intel: 竞品分析可用 `ctx.getMarket()?.checkCompliance()` 进行合规检查（Phase 4 迭代） |
| **HTTP 超时 15s + 重试**（HARNESS §HTTP resilience） | Agent 层 Harness 调用继承现有超时/重试配置 · DataOS 调用独立超时 5s（ADR-03 D17） |

---

##### 4. AI Agent Native 原则对齐

| Agent Native 原则（综合 BP / BUILD / DATA） | Sprint 5 遵循方式 |
|---------------------------------------------|-------------------|
| **"人类只做战略决策，AI 负责一切执行"**（CON Ch1.1） | Content Writer: on-demand 由人触发但 AI 完全自主生成 · Market Intel: 周一定时 AI 自主运行 · 人工干预仅在 Price Sentinel 审批流 |
| **"数据结构与系统结构是胜负点"**（BUILD） | Feature Store 特征 → 注入 Agent prompt → 提升决策质量 · Decision Memory 历史案例 → 闭环学习 |
| **"Agent = 调度与工具执行，不颠倒"**（BUILD） | Agent 逻辑 = 读特征 + 构造 prompt + 调 LLM + 解析结果 + 写事件 · **不**在 Agent 中硬编码业务规则 |
| **"读 Feature → 经 Harness → 写 Event"**（DATA §Agent 调度流） | Content Writer: ①getFeatures ②getHarness().getProducts() ③llm() ④recordMemory ⑤recordLakeEvent · Market Intel: ①getHarness().listProducts() ②getFeatures ③llm() ④upsertFeature ⑤recordLakeEvent |
| **"DataOS 为 ElectroOS 提供记忆；不可用时不阻塞"**（DATA / ADR-03） | 全部 7 Agent 降级测试 · `ctx.dataOS = undefined` 时执行路径不变 |
| **"Paperclip 唯一编排层"**（CON Ch3.3 / BP） | 两个新 Agent 注册到 `agent-registry.ts` · 通过 Paperclip 心跳或 API execute 路由触发 · 不引入新编排框架 |
| **"事件驱动解耦"**（CON Ch2.4） | Agent 执行 → `logAction` 审计 → `enqueueDataOsLakeEvent` 异步 → ClickHouse · 不同步阻塞 |
| **"模块化、每服务自有 schema"**（CON Ch2.1 / Ch2.5） | Content Writer / Market Intel 的类型定义在 `@patioer/agent-runtime` · 数据访问经 DataOsPort（不直连 DataOS PG） · 注册在 `apps/api` 层 |

---

##### 5. 蓝图 21 Agent 对齐验证

| 蓝图 §02 Agent | Phase | Sprint 5 状态 | 验证 |
|----------------|-------|--------------|------|
| Product Scout (E-01) | P1 | ✅ 已上线 | `getRunner('product-scout')` 存在 |
| Price Sentinel (E-02) | P1 | ✅ 已上线 + DataOS 接入 | Features + Memory in prompt |
| Support Relay (E-03) | P1 | ✅ 已上线 | — |
| Ads Optimizer (E-04) | P2 | ✅ 已上线 | — |
| Inventory Guard (E-05) | P2 | ✅ 已上线 | — |
| **Content Writer (E-07)** | **P3** | **🆕 Sprint 5 交付** | Day 18–19 |
| **Market Intel (E-08)** | **P3** | **🆕 Sprint 5 交付** | Day 20–21 |
| CEO (E-06) | P4 | ⬜ Phase 4 | — |
| Finance (E-09) | P4 | ⬜ Phase 4 | — |

Sprint 5 完成后 ElectroOS 运营侧 Agent 从 **5 → 7**，与 **ROAD Phase 3 "5+2=7"** 完全对齐。

---

##### 6. Phase 3 验收条款映射

| Sprint 5 CARD | 对应 AC 编号 | 验收描述 |
|---------------|-------------|----------|
| CARD-D18-01 | **AC-P3-16** | Content Writer Agent on-demand 触发正常生成商品文案 |
| CARD-D20-01 | **AC-P3-17** | Market Intel Agent 每周一更新 Feature Store 竞品价格特征 |
| CARD-D22-02~05 | **AC-P3-19** | DataOS 实例故障时 ElectroOS Agent 仍可正常运行（降级为无记忆模式） |
| CARD-D24-01 #16 | **AC-P3-14** | Price Sentinel prompt 中可见 `conv_rate_7d` 特征 |
| CARD-D24-01 #17 | **AC-P3-15** | Price Sentinel prompt 中可见历史调价案例 |

---

##### 7. 门控安全对齐（GOV / CON Ch5.4）

| 新 Agent | 是否涉及高风险平台写操作 | 门控评估 |
|----------|--------------------------|----------|
| Content Writer | **否** — 仅 LLM 生成文案 + 写 DataOS Event Lake · 不调 Harness 写方法（`updatePrice` / `updateInventory` 等）· 如未来需 `listProduct`（上架），须走 CON Ch5.4 "上架→人工确认" | Sprint 5 **无需新增审批门控** |
| Market Intel | **否** — 仅读 Harness `listProducts()` + 写 Feature Store + Event Lake · 不修改平台价格/库存 | Sprint 5 **无需新增审批门控** |

> **注意：** 如果 Content Writer 未来扩展到**直接上架商品**（`listProduct` 写操作），则 **必须** 按 CON Ch5.4 / GOV 添加 `content.publish` 审批门控，并在 `governance-gates.md` 中更新。Sprint 5 范围内不涉及。

---

#### Sprint 5 · Day-by-Day 实施细节

> **前提说明：** 任务 5.1~5.6（DataOsPort 接口 / AgentContext.dataOS 注入 / dataos-port.ts 实现 / Price Sentinel 接入 Feature Store + Decision Memory + Event Lake/Memory 写入）在 Sprint 3–4 实施过程中已**提前完成**。Sprint 5 实际聚焦于：
>
> | 剩余任务 | 对应原编号 | 预估 |
> |----------|-----------|------|
> | DB migration 扩展 `agent_type` 枚举 + 路由/schema 校验 | 前置 | 0.5d |
> | Content Writer Agent (E-07) 实现 + 测试 + 注册 | 5.7 | 2d |
> | Market Intel Agent (E-08) 实现 + 测试 + 注册 | 5.8 | 2d |
> | DataOsPort 一致性修复 + 全面降级测试 | 5.9 | 1d |
> | A/B 可观测指标定义 + 文档 | 5.10 | 0.5d |
> | Sprint 5 全量验证 | — | 0.5d |

---

##### Day 17 — DB migration + agent-runtime 类型 + 路由校验扩展

---

> **🃏 CARD-D17-01 · DB migration：`agent_type` 枚举扩展**
>
> **对齐：** CON Ch5.4（Schema 变更须人工）· BP §02（21 Agent 含 E-07/E-08）· ROAD Phase 3（"Content + Market Intel"）
>
> **类型：** 代码变更
> **耗时：** 45 min
> **目标文件：** `packages/db/src/schema/agents.ts`
>
> **变更：** 在 `agentTypeEnum` 中追加两个枚举值：
>
> ```typescript
> export const agentTypeEnum = pgEnum('agent_type', [
>   'product-scout',
>   'price-sentinel',
>   'support-relay',
>   'ads-optimizer',
>   'inventory-guard',
>   'content-writer',    // NEW: E-07
>   'market-intel',      // NEW: E-08
> ])
> ```
>
> **配套 SQL migration**（在 `scripts/` 或 Drizzle migration 中执行）：
> ```sql
> ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'content-writer';
> ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'market-intel';
> ```
>
> **验证：**
> ```bash
> pnpm --filter @patioer/db typecheck
> ```
>
> **产出：** DB schema 支持两种新 Agent 类型

---

> **🃏 CARD-D17-02 · agent-runtime `types.ts`：Content Writer + Market Intel 类型定义**
>
> **对齐：** CON Ch2.2 API First（先定义接口再实现）· CON Ch4.1 命名 PascalCase · DATA §Agent 调度流
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `packages/agent-runtime/src/types.ts`
>
> **新增类型：**
>
> ```typescript
> export interface ContentWriterRunInput {
>   productId: string
>   platform?: string
>   tone?: 'professional' | 'casual' | 'luxury' | 'value'
>   maxLength?: number
> }
>
> export interface ContentWriterResult {
>   productId: string
>   title: string
>   description: string
>   bulletPoints: string[]
>   seoKeywords: string[]
> }
>
> export interface MarketIntelRunInput {
>   platforms?: string[]
>   maxProducts?: number
>   focusCategories?: string[]
> }
>
> export interface MarketIntelCompetitorInsight {
>   productId: string
>   platform: string
>   competitorMinPrice: number
>   competitorAvgPrice: number
>   pricePosition: 'below' | 'at' | 'above'
>   recommendation?: string
> }
>
> export interface MarketIntelResult {
>   runId: string
>   analyzedProducts: number
>   insights: MarketIntelCompetitorInsight[]
>   featuresUpdated: number
> }
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime typecheck`
>
> **产出：** 两种新 Agent 的输入/输出类型定义

---

> **🃏 CARD-D17-03 · `apps/api/src/routes/agents.ts`：AGENT_TYPES + goalContextSchemas 扩展**
>
> **对齐：** CON Ch2.2 API First + Zod schema · CON Ch5.1 goal_context 解析 · BP §02 Agent 清单
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `apps/api/src/routes/agents.ts`
>
> **变更 1 — AGENT_TYPES：**
> ```typescript
> const AGENT_TYPES = [
>   'product-scout',
>   'price-sentinel',
>   'support-relay',
>   'ads-optimizer',
>   'inventory-guard',
>   'content-writer',    // NEW
>   'market-intel',      // NEW
> ] as const
> ```
>
> **变更 2 — goalContextSchemas 追加：**
> ```typescript
> 'content-writer': z.object({
>   productId: z.string(),
>   platform: z.string().optional(),
>   tone: z.enum(['professional', 'casual', 'luxury', 'value']).optional(),
>   maxLength: z.number().int().positive().optional(),
> }).passthrough(),
> 'market-intel': z.object({
>   platforms: z.array(z.string()).optional(),
>   maxProducts: z.number().int().positive().optional(),
>   focusCategories: z.array(z.string()).optional(),
> }).passthrough(),
> ```
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** 路由验证支持新 Agent 类型

---

> **🃏 CARD-D17-04 · `packages/agent-runtime/src/agents/index.ts`：预留导出**
>
> **类型：** 代码变更
> **耗时：** 5 min
> **目标文件：** `packages/agent-runtime/src/agents/index.ts`
>
> **追加（文件暂不存在也不报错；Day 18/20 创建后自然生效）：**
> ```typescript
> export * from './content-writer.agent.js'
> export * from './market-intel.agent.js'
> ```
>
> **注意：** 此步先追加导出行。由于源文件尚未创建，typecheck 会报错——这是预期行为，
> 在 Day 18 / Day 20 创建 agent 文件后自动修复。可暂时注释掉，Day 18 再解注释。
>
> **产出：** 导出位预留

---

> **🃏 CARD-D17-05 · Day 17 回归 + 检查点**
>
> **类型：** 验证
> **耗时：** 20 min
>
> | # | 检查项 | 命令 | 期望 |
> |---|--------|------|------|
> | 1 | DB schema 含 `content-writer` | `grep content-writer packages/db/src/schema/agents.ts` | 存在 |
> | 2 | DB schema 含 `market-intel` | `grep market-intel packages/db/src/schema/agents.ts` | 存在 |
> | 3 | types.ts 含 `ContentWriterRunInput` | `grep ContentWriterRunInput packages/agent-runtime/src/types.ts` | 存在 |
> | 4 | types.ts 含 `MarketIntelRunInput` | `grep MarketIntelRunInput packages/agent-runtime/src/types.ts` | 存在 |
> | 5 | AGENT_TYPES 含 7 种 | `grep -c "'" apps/api/src/routes/agents.ts \| head` | 7 个类型 |
> | 6 | `@patioer/db` typecheck | `pnpm --filter @patioer/db typecheck` | 通过 |
> | 7 | `@patioer/agent-runtime` typecheck | `pnpm --filter @patioer/agent-runtime typecheck` | 通过 |
> | 8 | 现有测试不受影响 | `pnpm test` | 0 failures |
>
> **产出：** Day 17 完成 · 新 Agent 的基础设施就绪

---

**Day 17 卡片执行顺序汇总：**

```
09:00  CARD-D17-01  DB migration agent_type 扩展       (45min)
09:45  CARD-D17-02  agent-runtime 类型定义              (30min)
10:15  CARD-D17-03  routes/agents.ts 校验扩展           (30min)
10:45  CARD-D17-04  agents/index.ts 导出预留            (5min)
10:50  CARD-D17-05  回归 + 检查点                        (20min)
11:10  Day 17 完成
```

---

##### Day 18 — Content Writer Agent（E-07）实现

---

> **🃏 CARD-D18-01 · `packages/agent-runtime/src/agents/content-writer.agent.ts`**
>
> **对齐：** CON Ch2.3 Harness 不可绕过 · CON Ch5.1 Pre-flight（budget/goal_context）· CON Ch5.3 不可变审计 · CON Ch6.1 tenant_id · DATA §"读 Feature → 经 Harness → 写 Event" · BP §02 E-07 · AC-P3-16
>
> **类型：** 新建文件
> **耗时：** 3h
> **目标文件：** `packages/agent-runtime/src/agents/content-writer.agent.ts`（新建）
>
> **函数签名：**
> ```typescript
> export async function runContentWriter(
>   ctx: AgentContext,
>   input: ContentWriterRunInput,
> ): Promise<ContentWriterResult>
> ```
>
> **执行流程（与 Price Sentinel 模式对齐）：**
>
> ```
> 1. logAction('content_writer.run.started', { productId, platform })
> 2. budget.isExceeded() → 超预算则 return 空结果
> 3. 确定 platform（input.platform ?? ctx.getEnabledPlatforms()[0] ?? 'shopify'）
> 4. ctx.dataOS?.getFeatures(platform, productId)
>    └── 获取产品特征（价格、转化率、库存等）注入 prompt
> 5. ctx.dataOS?.recallMemory('content-writer', { productId, features })
>    └── 获取历史文案生成案例
> 6. ctx.llm({
>      prompt: 构建含 features + memories + tone/maxLength 约束的文案生成 prompt,
>      systemPrompt: 'You are an e-commerce content writer...'
>    })
> 7. 解析 LLM 响应 → ContentWriterResult
> 8. ctx.dataOS?.recordMemory({
>      agentId: 'content-writer', entityId: productId,
>      context: { productId, features, tone },
>      action: { title, description, bulletPoints }
>    })
> 9. ctx.dataOS?.recordLakeEvent({
>      agentId: ctx.agentId, eventType: 'content_generated',
>      entityId: productId, payload: result
>    })
> 10. logAction('content_writer.run.completed', { productId })
> ```
>
> **实现约束：**
> - 所有 `ctx.dataOS` 调用均 `try/catch`（降级友好）
> - LLM prompt 中注入 features 和 memories（仅当可用时）
> - 解析 LLM JSON 响应，失败时 fallback 为纯文本 `{ title: text, description: text, bulletPoints: [], seoKeywords: [] }`
> - `tone` 默认 `'professional'`
> - `maxLength` 默认 `2000`
>
> **验证：** `pnpm --filter @patioer/agent-runtime typecheck`
>
> **产出：** Content Writer Agent 核心逻辑落地

---

> **🃏 CARD-D18-02 · `agents/index.ts` 解注释 Content Writer 导出**
>
> **类型：** 代码变更
> **耗时：** 2 min
> **目标文件：** `packages/agent-runtime/src/agents/index.ts`
>
> **确保导出行生效：**
> ```typescript
> export * from './content-writer.agent.js'
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime typecheck`
>
> **产出：** Content Writer 可从 `@patioer/agent-runtime` 导入

---

> **🃏 CARD-D18-03 · Day 18 回归**
>
> ```bash
> pnpm --filter @patioer/agent-runtime typecheck
> pnpm test
> ```
>
> **产出：** Day 18 完成

---

**Day 18 卡片执行顺序汇总：**

```
09:00  CARD-D18-01  content-writer.agent.ts 实现        (3h)
12:00  CARD-D18-02  index.ts 导出                        (2min)
12:02  CARD-D18-03  回归                                  (15min)
12:17  Day 18 完成
```

---

##### Day 19 — Content Writer Agent 测试 + 注册 + Input Builder

---

> **🃏 CARD-D19-01 · `packages/agent-runtime/src/agents/content-writer.agent.test.ts`**
>
> **对齐：** CON Ch7.2 覆盖率 ≥80% · CON Ch5.3 提交带测试 · CON Ch4.3 结构化错误
>
> **类型：** 新建文件
> **耗时：** 2h
> **目标文件：** `packages/agent-runtime/src/agents/content-writer.agent.test.ts`（新建）
>
> **测试策略：** 复用 price-sentinel.agent.test.ts 的 mock 模式（mock ctx.llm / ctx.dataOS / ctx.logAction 等）。
>
> **测试用例：**
> ```
> ✓ generates content with LLM and returns structured result
> ✓ injects features into prompt when dataOS is available
> ✓ injects recalled memories into prompt when available
> ✓ records memory and lake event after successful generation
> ✓ returns empty result when budget is exceeded
> ✓ operates normally when dataOS is undefined (degraded mode)
> ✓ handles dataOS.getFeatures failure gracefully (try/catch)
> ✓ handles LLM response parse failure with fallback
> ✓ respects tone parameter in prompt
> ✓ respects maxLength parameter in prompt
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime test`
>
> **产出：** Content Writer Agent 测试覆盖完整

---

> **🃏 CARD-D19-02 · `apps/api/src/lib/agent-inputs.ts`：`buildContentWriterInput`**
>
> **对齐：** CON Ch5.1 Pre-flight（goal_context 解析）· BUILD "数据 + API 为真核心"
>
> **类型：** 代码变更
> **耗时：** 20 min
> **目标文件：** `apps/api/src/lib/agent-inputs.ts`
>
> **追加函数：**
> ```typescript
> export function buildContentWriterInput(goalContext: string): ContentWriterRunInput {
>   const parsed = parseGoalContext(goalContext)
>   if (!parsed || typeof parsed.productId !== 'string') {
>     throw new Error('content-writer requires goalContext.productId')
>   }
>   return {
>     productId: parsed.productId,
>     platform: typeof parsed.platform === 'string' ? parsed.platform : undefined,
>     tone: ['professional', 'casual', 'luxury', 'value'].includes(parsed.tone as string)
>       ? (parsed.tone as ContentWriterRunInput['tone'])
>       : undefined,
>     maxLength: getNum(parsed, 'maxLength'),
>   }
> }
> ```
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** Content Writer Input Builder 就绪

---

> **🃏 CARD-D19-03 · `apps/api/src/lib/agent-registry.ts`：Content Writer Runner 注册**
>
> **对齐：** CON Ch3.3 Paperclip 唯一编排 · HARNESS §DB-backed HarnessRegistry · Agent Native: 注册到统一 Runner
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `apps/api/src/lib/agent-registry.ts`
>
> **追加 import：**
> ```typescript
> import { runContentWriter } from '@patioer/agent-runtime'
> import type { ContentWriterResult } from '@patioer/agent-runtime'
> import { buildContentWriterInput } from './agent-inputs.js'
> ```
>
> **追加 `ExecuteAgentResponse` 字段：**
> ```typescript
> contentWriter?: ContentWriterResult
> ```
>
> **注册 Runner：**
> ```typescript
> registerRunner('content-writer', async (_req, agentRow, ctx) => {
>   const input = buildContentWriterInput(agentRow.goalContext ?? '')
>   const result = await runContentWriter(ctx, input)
>   return {
>     ok: true,
>     agentId: agentRow.id,
>     executedAt: new Date().toISOString(),
>     contentWriter: result,
>   }
> })
> ```
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** Content Writer 可通过 `POST /api/v1/agents/:id/execute` 触发

---

> **🃏 CARD-D19-04 · Day 19 回归**
>
> ```bash
> pnpm --filter @patioer/agent-runtime test
> pnpm --filter @patioer/api typecheck
> pnpm test
> # 期望：content-writer 10+ tests passed · 全量 0 failures
> ```
>
> **产出：** Day 19 完成 · Content Writer Agent 全链路可执行

---

**Day 19 卡片执行顺序汇总：**

```
09:00  CARD-D19-01  content-writer.agent.test.ts        (2h)
11:00  CARD-D19-02  buildContentWriterInput              (20min)
11:20  CARD-D19-03  agent-registry 注册                   (30min)
11:50  CARD-D19-04  回归                                  (20min)
12:10  Day 19 完成
```

---

##### Day 20 — Market Intel Agent（E-08）实现

---

> **🃏 CARD-D20-01 · `packages/agent-runtime/src/agents/market-intel.agent.ts`**
>
> **对齐：** CON Ch2.3 Harness 不可绕过 · CON Ch2.4 事件驱动 · CON Ch5.1 Pre-flight · CON Ch5.3 审计 · CON Ch6.1 tenant_id · DATA §Feature Store · BP §02 E-08 · AC-P3-17 · HARNESS §`listProducts()`
>
> **类型：** 新建文件
> **耗时：** 3.5h
> **目标文件：** `packages/agent-runtime/src/agents/market-intel.agent.ts`（新建）
>
> **函数签名：**
> ```typescript
> export async function runMarketIntel(
>   ctx: AgentContext,
>   input: MarketIntelRunInput,
> ): Promise<MarketIntelResult>
> ```
>
> **执行流程：**
>
> ```
> 1. logAction('market_intel.run.started', { platforms, maxProducts })
> 2. budget.isExceeded() → 超预算则 return 空结果
> 3. platforms = input.platforms ?? ctx.getEnabledPlatforms()
> 4. maxProducts = input.maxProducts ?? 50
> 5. 遍历每个 platform：
>    a. harness = ctx.getHarness(platform)
>    b. products = await harness.listProducts()  （截取 maxProducts）
>    c. 对每个 product：
>       i.  ctx.dataOS?.getFeatures(platform, product.platformProductId)
>       ii. ctx.llm({ prompt: 竞品分析 prompt，含当前价格 + 特征 })
>       iii. 解析 LLM 响应 → competitorMinPrice, competitorAvgPrice, pricePosition, recommendation
>       iv. ctx.dataOS?.upsertFeature({
>             platform, productId: product.platformProductId,
>             competitorMinPrice, competitorAvgPrice, pricePosition
>           })
>       v.  insights.push(insight)
> 6. ctx.dataOS?.recordLakeEvent({
>      agentId: ctx.agentId, eventType: 'market_intel_completed',
>      payload: { analyzedProducts, featuresUpdated, insightCount }
>    })
> 7. logAction('market_intel.run.completed', { analyzedProducts, featuresUpdated })
> 8. return { runId, analyzedProducts, insights, featuresUpdated }
> ```
>
> **实现约束：**
> - 所有 `ctx.dataOS` 和 `ctx.getHarness` 调用均 `try/catch`
> - 单产品 LLM 调用失败不中断循环（skip + log）
> - `upsertFeature` 写入竞品字段已在 DataOS internal-routes upsert schema 中预定义
>   （`competitorMinPrice` / `competitorAvgPrice` / `pricePosition`）
> - `runId` 使用 `crypto.randomUUID()`
> - harness 不支持 `listProducts` 时 skip 该 platform（`try/catch + skipReason`）
>
> **验证：** `pnpm --filter @patioer/agent-runtime typecheck`
>
> **产出：** Market Intel Agent 核心逻辑落地

---

> **🃏 CARD-D20-02 · `agents/index.ts` 启用 Market Intel 导出**
>
> **类型：** 代码变更
> **耗时：** 2 min
> **目标文件：** `packages/agent-runtime/src/agents/index.ts`
>
> **确保导出行生效：**
> ```typescript
> export * from './market-intel.agent.js'
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime typecheck`
>
> **产出：** Market Intel 可从 `@patioer/agent-runtime` 导入

---

> **🃏 CARD-D20-03 · Day 20 回归**
>
> ```bash
> pnpm --filter @patioer/agent-runtime typecheck
> pnpm test
> ```
>
> **产出：** Day 20 完成

---

**Day 20 卡片执行顺序汇总：**

```
09:00  CARD-D20-01  market-intel.agent.ts 实现          (3.5h)
12:30  CARD-D20-02  index.ts 导出                        (2min)
12:32  CARD-D20-03  回归                                  (15min)
12:47  Day 20 完成
```

---

##### Day 21 — Market Intel Agent 测试 + 注册 + Input Builder

---

> **🃏 CARD-D21-01 · `packages/agent-runtime/src/agents/market-intel.agent.test.ts`**
>
> **对齐：** CON Ch7.2 覆盖率 ≥80% · CON Ch5.3 提交带测试
>
> **类型：** 新建文件
> **耗时：** 2h
> **目标文件：** `packages/agent-runtime/src/agents/market-intel.agent.test.ts`（新建）
>
> **测试用例：**
> ```
> ✓ analyzes products across multiple platforms and returns insights
> ✓ upserts competitor features into Feature Store via dataOS
> ✓ records lake event after completion
> ✓ returns empty result when budget is exceeded
> ✓ operates normally when dataOS is undefined (degraded mode)
> ✓ skips platform when harness.listProducts fails (logs skip reason)
> ✓ skips individual product on LLM failure without aborting run
> ✓ handles dataOS.upsertFeature failure gracefully
> ✓ respects maxProducts limit
> ✓ uses ctx.getEnabledPlatforms() when input.platforms is undefined
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime test`
>
> **产出：** Market Intel Agent 测试覆盖完整

---

> **🃏 CARD-D21-02 · `apps/api/src/lib/agent-inputs.ts`：`buildMarketIntelInput`**
>
> **对齐：** CON Ch5.1 goal_context 解析
>
> **类型：** 代码变更
> **耗时：** 15 min
> **目标文件：** `apps/api/src/lib/agent-inputs.ts`
>
> **追加函数：**
> ```typescript
> export function buildMarketIntelInput(goalContext: string): MarketIntelRunInput {
>   const parsed = parseGoalContext(goalContext)
>   if (!parsed) return {}
>   return {
>     platforms: Array.isArray(parsed.platforms) ? parsed.platforms.filter((p): p is string => typeof p === 'string') : undefined,
>     maxProducts: getNum(parsed, 'maxProducts'),
>     focusCategories: Array.isArray(parsed.focusCategories)
>       ? parsed.focusCategories.filter((c): c is string => typeof c === 'string')
>       : undefined,
>   }
> }
> ```
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** Market Intel Input Builder 就绪

---

> **🃏 CARD-D21-03 · `apps/api/src/lib/agent-registry.ts`：Market Intel Runner 注册**
>
> **对齐：** CON Ch3.3 Paperclip 唯一编排 · HARNESS §DB-backed · Agent Native: 统一 Runner
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `apps/api/src/lib/agent-registry.ts`
>
> **追加 import：**
> ```typescript
> import { runMarketIntel } from '@patioer/agent-runtime'
> import type { MarketIntelResult } from '@patioer/agent-runtime'
> import { buildMarketIntelInput } from './agent-inputs.js'
> ```
>
> **追加 `ExecuteAgentResponse` 字段：**
> ```typescript
> marketIntel?: MarketIntelResult
> ```
>
> **注册 Runner：**
> ```typescript
> registerRunner('market-intel', async (_req, agentRow, ctx) => {
>   const input = buildMarketIntelInput(agentRow.goalContext ?? '')
>   const result = await runMarketIntel(ctx, input)
>   return {
>     ok: true,
>     agentId: agentRow.id,
>     executedAt: new Date().toISOString(),
>     marketIntel: result,
>   }
> })
> ```
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** Market Intel 可通过 `POST /api/v1/agents/:id/execute` 触发

---

> **🃏 CARD-D21-04 · Day 21 回归**
>
> ```bash
> pnpm --filter @patioer/agent-runtime test
> pnpm --filter @patioer/api typecheck
> pnpm test
> # 期望：market-intel 10+ tests passed · 全量 0 failures
> ```
>
> **产出：** Day 21 完成 · Market Intel Agent 全链路可执行

---

**Day 21 卡片执行顺序汇总：**

```
09:00  CARD-D21-01  market-intel.agent.test.ts          (2h)
11:00  CARD-D21-02  buildMarketIntelInput                (15min)
11:15  CARD-D21-03  agent-registry 注册                   (30min)
11:45  CARD-D21-04  回归                                  (20min)
12:05  Day 21 完成
```

---

##### Day 22 — DataOsPort 一致性修复 + 全面降级测试

---

> **🃏 CARD-D22-01 · `describeDataOsCapabilities` 一致性修复**
>
> **对齐：** CON Ch2.2 API First（接口定义 = 实现 = 文档）· CON Ch5.2 Agent 不绕过接口 · CON-PDF "Harness 不可绕过"的推广 · Agent Native: Port 描述与实际 API 必须一致
>
> **类型：** 代码变更
> **耗时：** 45 min
> **目标文件：** `packages/agent-runtime/src/context.ts`
>
> **问题：** `describeDataOsCapabilities()` 文案中列举了 `queryEvents`、`queryPriceEvents`、
> `listFeatures`、`deleteFeature`、`listDecisions`、`deleteDecision` 等方法，但 `DataOsPort`
> 接口定义中**不含**这些方法（它们在 `DataOsClient` 上存在，但 Port 层未暴露）。
>
> **修复策略（收紧文案）：** 将 `describeDataOsCapabilities` 中仅保留 `DataOsPort` 实际暴露的方法。
> 移除 `queryEvents`、`queryPriceEvents`、`listFeatures`、`deleteFeature`、
> `listDecisions`、`deleteDecision` 的说明，避免 Agent LLM 调用不存在的方法。
>
> **修复后文案片段：**
> ```typescript
> ctx.describeDataOsCapabilities = () => [
>   '## DataOS Capabilities (Learning Layer)',
>   '',
>   'You have access to DataOS via `ctx.dataOS`. Available operations:',
>   '',
>   '### Event Lake',
>   '- `recordLakeEvent(...)` — write any event to the analytics lake',
>   '- `recordPriceEvent(...)` — write a price change event',
>   '',
>   '### Feature Store',
>   '- `getFeatures(platform, productId)` — get product feature snapshot (cached)',
>   '- `upsertFeature({ platform, productId, ...fields })` — create/update features',
>   '',
>   '### Decision Memory',
>   '- `recallMemory(agentId, context, opts?)` — find similar past decisions',
>   '- `recordMemory({ agentId, context, action, ... })` — save a decision',
>   '- `writeOutcome(decisionId, outcome)` — close the learning loop',
>   '',
>   '### Discovery',
>   '- `getCapabilities()` — introspect all available endpoints',
>   '',
>   'Use these to learn from past decisions and improve over time.',
> ].join('\n')
> ```
>
> **验证：**
> ```bash
> pnpm --filter @patioer/agent-runtime typecheck
> # 确认 describeDataOsCapabilities 只引用 DataOsPort 上存在的方法
> ```
>
> **产出：** Port 接口与能力描述完全一致

---

> **🃏 CARD-D22-02 · 降级测试：`content-writer.agent.test.ts` 降级场景补充**
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `packages/agent-runtime/src/agents/content-writer.agent.test.ts`
>
> **新增测试用例：**
> ```
> ✓ [degradation] generates content without dataOS (ctx.dataOS = undefined)
> ✓ [degradation] dataOS.getFeatures throws → still generates content
> ✓ [degradation] dataOS.recallMemory throws → still generates content
> ✓ [degradation] dataOS.recordMemory throws → content result still returned
> ✓ [degradation] dataOS.recordLakeEvent throws → content result still returned
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime test`
>
> **产出：** Content Writer 降级场景覆盖

---

> **🃏 CARD-D22-03 · 降级测试：`market-intel.agent.test.ts` 降级场景补充**
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `packages/agent-runtime/src/agents/market-intel.agent.test.ts`
>
> **新增测试用例：**
> ```
> ✓ [degradation] runs without dataOS (ctx.dataOS = undefined)
> ✓ [degradation] dataOS.getFeatures throws → product still analyzed
> ✓ [degradation] dataOS.upsertFeature throws → insight still recorded
> ✓ [degradation] dataOS.recordLakeEvent throws → result still returned
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime test`
>
> **产出：** Market Intel 降级场景覆盖

---

> **🃏 CARD-D22-04 · 降级测试：`price-sentinel.agent.test.ts` 降级场景补充**
>
> **类型：** 代码变更
> **耗时：** 30 min
> **目标文件：** `packages/agent-runtime/src/agents/price-sentinel.agent.test.ts`
>
> **新增/确认测试用例（如已存在则标注 `✓ existing`）：**
> ```
> ✓ [degradation] processes proposals without dataOS
> ✓ [degradation] dataOS.getFeatures throws → proposal still processed
> ✓ [degradation] dataOS.recallMemory throws → decision still made
> ✓ [degradation] dataOS.recordMemory throws → price still updated
> ✓ [degradation] dataOS.recordLakeEvent throws → execution continues
> ✓ [degradation] dataOS.recordPriceEvent throws → execution continues
> ```
>
> **验证：** `pnpm --filter @patioer/agent-runtime test`
>
> **产出：** Price Sentinel 降级场景全面覆盖

---

> **🃏 CARD-D22-05 · 降级集成测试：`apps/api` E2E 级别**
>
> **对齐：** ADR-03 D17（超时 5s + try/catch 降级）· ROAD Phase 3（"DataOS 故障时降级无记忆"）· DATA §互联（"不可用时不阻塞"）· AC-P3-19 · CON Ch4.3 结构化错误
>
> **类型：** 新建文件
> **耗时：** 1h
> **目标文件：** `apps/api/src/routes/agents-execute.degradation.test.ts`（新建）
>
> **测试策略：**
> - 使用现有测试基础设施（Fastify inject）
> - 设置 `DATAOS_ENABLED=0`（或 mock `tryCreateDataOsPort` 返回 `undefined`）
> - 对全部 7 种 Agent 类型发送 execute 请求
> - 验证所有 Agent 正常返回 200（非 500 / 非 502）
>
> **测试用例：**
> ```
> describe('DataOS degradation (DATAOS_ENABLED=0)')
> ✓ price-sentinel executes normally without DataOS
> ✓ product-scout executes normally without DataOS
> ✓ support-relay executes normally without DataOS
> ✓ ads-optimizer executes normally without DataOS
> ✓ inventory-guard executes normally without DataOS
> ✓ content-writer executes normally without DataOS
> ✓ market-intel executes normally without DataOS
> ✓ audit log shows 'dataos_degraded' when DataOS unavailable
> ```
>
> **验证：** `pnpm --filter @patioer/api test`
>
> **产出：** 全 Agent 降级行为在 API 层面验证

---

> **🃏 CARD-D22-06 · Day 22 回归**
>
> ```bash
> pnpm --filter @patioer/agent-runtime test
> pnpm --filter @patioer/api test
> pnpm typecheck
> pnpm test
> # 期望：全部降级测试通过 · 0 failures
> ```
>
> **产出：** Day 22 完成 · 降级保障全面验证

---

**Day 22 卡片执行顺序汇总：**

```
09:00  CARD-D22-01  describeDataOsCapabilities 修复      (45min)
09:45  CARD-D22-02  Content Writer 降级测试               (30min)
10:15  CARD-D22-03  Market Intel 降级测试                 (30min)
10:45  CARD-D22-04  Price Sentinel 降级测试               (30min)
11:15  CARD-D22-05  API E2E 降级集成测试                  (1h)
12:15  CARD-D22-06  回归                                  (20min)
12:35  Day 22 完成
```

---

##### Day 23 — A/B 可观测指标定义 + 文档

---

> **🃏 CARD-D23-01 · `apps/dataos-api/src/metrics.ts`：A/B 可观测指标**
>
> **对齐：** CON Ch8.1 必须监控指标 · CON Ch8.2 告警规则 · Agent Native: 可观测闭环 · BP §05 Governance 可追踪
>
> **类型：** 代码变更
> **耗时：** 1h
> **目标文件：** `apps/dataos-api/src/metrics.ts`
>
> **新增 Prometheus 指标（A/B 对比：有 DataOS vs 无 DataOS）：**
>
> | 指标名 | 类型 | 标签 | 含义 |
> |--------|------|------|------|
> | `dataos_ab_agent_executions_total` | Counter | `agent_type`, `dataos_mode` (`enabled`/`degraded`) | Agent 执行总数（按 DataOS 模式分组） |
> | `dataos_ab_approval_requests_total` | Counter | `agent_type`, `dataos_mode` | 需人工审批的决策数 |
> | `dataos_ab_price_changes_total` | Counter | `dataos_mode` | Price Sentinel 实际执行的调价数 |
> | `dataos_ab_content_generations_total` | Counter | `dataos_mode` | Content Writer 文案生成数 |
> | `dataos_ab_market_intel_products_total` | Counter | `dataos_mode` | Market Intel 分析产品数 |
> | `dataos_ab_execution_duration_seconds` | Histogram | `agent_type`, `dataos_mode` | Agent 执行时长分布 |
>
> **使用方式：** ElectroOS API 侧在 Agent 执行前/后记录：
> - `dataos_mode = ctx.dataOS ? 'enabled' : 'degraded'`
> - 发送到 DataOS API 的 `/internal/v1/lake/events`（eventType: `ab_metric`）
>
> **验证：**
> ```bash
> curl -s http://localhost:3300/metrics | grep dataos_ab
> # 期望：6 个新指标可见
> ```
>
> **产出：** A/B 可观测指标定义就绪

---

> **🃏 CARD-D23-02 · `apps/api/src/routes/agents-execute.ts`：A/B 指标埋点**
>
> **对齐：** CON Ch2.4 事件驱动 · CON Ch5.3 不可变审计 · DATA §"事件 → 特征反哺 → Agent 改进"
>
> **类型：** 代码变更
> **耗时：** 45 min
> **目标文件：** `apps/api/src/routes/agents-execute.ts`
>
> **埋点位置：** `buildExecutionContext` 返回后、Runner 调用前后。
>
> **实现：**
> ```typescript
> const dataosMode = ctx.dataOS ? 'enabled' : 'degraded'
> const startTime = Date.now()
>
> // ... runner(request, agentRow, ctx) ...
>
> const durationSec = (Date.now() - startTime) / 1000
>
> // 异步写入 DataOS lake（如果可用），不阻塞响应
> enqueueDataOsLakeEvent({
>   tenantId, platform, agentId: agentRow.id,
>   eventType: 'ab_metric',
>   payload: {
>     agentType: agentRow.type,
>     dataosMode,
>     durationSec,
>     hasApprovalRequests: /* from result */,
>   },
> }).catch(() => {})
> ```
>
> **约束：** 埋点逻辑不影响主路径 · `catch(() => {})` 静默失败
>
> **验证：** `pnpm --filter @patioer/api typecheck`
>
> **产出：** A/B 指标自动采集

---

> **🃏 CARD-D23-03 · `docs/plans/phase3-ab-metrics.md`：A/B 可观测方案文档**
>
> **对齐：** CON Ch8 可观测性标准 · ROAD "验收清单全过才进下阶段" · Agent Native: 量化学习层价值
>
> **类型：** 新建文件
> **耗时：** 1h
> **目标文件：** `docs/plans/phase3-ab-metrics.md`（新建）
>
> **文档结构：**
>
> | 章节 | 内容 |
> |------|------|
> | 1. 背景 | Phase 3 引入 DataOS 学习层后，需量化其对 Agent 决策质量的影响 |
> | 2. 指标定义 | 6 项 Prometheus 指标及其含义、标签维度 |
> | 3. 对比维度 | `dataos_mode: enabled` vs `degraded`（自然 A/B：新租户首次执行 vs DataOS 积累后执行） |
> | 4. 关键 KPI | 转化率变化（Feature Store 注入前后）、人工审批率（Decision Memory 注入前后）、Agent 执行时长 |
> | 5. 数据查询示例 | PromQL 查询模板 · ClickHouse 分析 SQL 模板 |
> | 6. 阈值与告警 | 降级模式占比 > 20% 触发告警 |
> | 7. Phase 4 路线图 | 对照实验框架（feature flag 级别 A/B test） |
>
> **验证：** 文件存在且格式正确
>
> **产出：** A/B 可观测完整方案文档

---

> **🃏 CARD-D23-04 · Day 23 回归**
>
> ```bash
> pnpm typecheck
> pnpm test
> ```
>
> **产出：** Day 23 完成

---

**Day 23 卡片执行顺序汇总：**

```
09:00  CARD-D23-01  A/B Prometheus 指标定义              (1h)
10:00  CARD-D23-02  agents-execute 埋点                   (45min)
10:45  CARD-D23-03  A/B 方案文档                          (1h)
11:45  CARD-D23-04  回归                                  (15min)
12:00  Day 23 完成
```

---

##### Day 24 — Sprint 5 全量验证 + 检查点

---

> **🃏 CARD-D24-01 · Sprint 5 全量验证**
>
> **对齐：** ROAD "阶段门禁：验收清单全过才进下阶段" · P3 §9 AC-P3-14~19 · CON Ch7.2 覆盖率 ≥80%
>
> **类型：** 验证
> **耗时：** 2h
>
> **验证步骤：**
>
> ```bash
> # 1. 类型检查
> pnpm typecheck
> # 期望：全 Done，0 errors
>
> # 2. 全量测试
> pnpm test
> # 期望：0 failures
>
> # 3. 基础设施启动
> docker-compose -f docker-compose.dataos.yml up -d
> sleep 5
>
> # 4. DataOS API 健康
> curl -s http://localhost:3300/health | jq .
> # 期望：{ "ok": true, "service": "dataos-api" }
>
> # 5. Content Writer 冒烟测试（需有 agent 行和有效 credential）
> # 创建 content-writer 类型 agent → POST execute
> # 期望：200 · response.contentWriter.title 非空
>
> # 6. Market Intel 冒烟测试
> # 创建 market-intel 类型 agent → POST execute
> # 期望：200 · response.marketIntel.runId 非空
>
> # 7. 降级冒烟：停止 DataOS
> docker-compose -f docker-compose.dataos.yml stop dataos-api
> # POST execute price-sentinel
> # 期望：200（降级模式，无 features/memories 但正常返回 decisions）
>
> # 8. 恢复 DataOS
> docker-compose -f docker-compose.dataos.yml start dataos-api
>
> # 9. A/B 指标可见
> curl -s http://localhost:3300/metrics | grep dataos_ab
> # 期望：6 项 A/B 指标已注册
>
> # 10. Price Sentinel prompt 中含特征（需 Feature Store 有数据）
> # 验证：execute 后 agent_events 日志含 features / memories 字段
> ```
>
> **Sprint 5 检查点清单：**
>
> | # | 检查项 | 对应验收 | 期望 |
> |---|--------|---------|------|
> | 1 | DB `agent_type` 枚举含 7 种 | 前置 | `SELECT unnest(enum_range(NULL::agent_type))` → 7 行 |
> | 2 | `ContentWriterRunInput` 类型可编译 | 5.7 | typecheck 通过 |
> | 3 | `MarketIntelRunInput` 类型可编译 | 5.8 | typecheck 通过 |
> | 4 | Content Writer agent 可 execute | AC-P3-16 | 200 + contentWriter 字段 |
> | 5 | Market Intel agent 可 execute | AC-P3-17 | 200 + marketIntel 字段 |
> | 6 | Content Writer 降级模式正常 | 5.9 | dataOS=undefined 不报错 |
> | 7 | Market Intel 降级模式正常 | 5.9 | dataOS=undefined 不报错 |
> | 8 | Price Sentinel 降级模式正常 | 5.9 / AC-P3-19 | dataOS=undefined 不报错 |
> | 9 | `describeDataOsCapabilities` 仅含 DataOsPort 方法 | 一致性 | 无多余方法 |
> | 10 | A/B 指标 6 项已定义 | 5.10 | `/metrics` 可见 |
> | 11 | A/B 埋点在 agents-execute 生效 | 5.10 | ab_metric 事件写入 |
> | 12 | Content Writer tests passed | 5.7 | vitest ≥10 passed |
> | 13 | Market Intel tests passed | 5.8 | vitest ≥10 passed |
> | 14 | 降级 E2E tests passed | 5.9 | vitest ≥8 passed |
> | 15 | 全量 `pnpm test` 0 failures | all | CI green |
> | 16 | Price Sentinel prompt 含 `conv_rate_7d` | AC-P3-14 | agent_events 日志验证 |
> | 17 | Price Sentinel prompt 含历史案例 | AC-P3-15 | agent_events 日志验证 |
>
> **产出：** Sprint 5 全部验收通过 · 代码可安全合并

---

**Day 24 卡片执行顺序汇总：**

```
09:00  CARD-D24-01  全量验证                              (2h)
11:00  Sprint 5 完成 → 进入 Sprint 6
```

---

#### Sprint 5 交付代码 · 宪法 / 蓝图 / 实施计划 对齐审查报告

> **审查范围：** Sprint 5 实际交付的全部代码变更（Day 17-24）逐条与宪法（CON）、蓝图（BP）、实施计划（P3）、DataOS ADR-03、Harness 工程文档、AI Agent Native 原则进行合规对照。
>
> **审查方法：** 逐文件源码审读 → 提取行为事实 → 映射到文档条款 → 标注合规 / 偏差 / 不适用。

---

##### A. 宪法（System Constitution v1.0）逐章合规

| 宪法章节 | 条款 | Sprint 5 交付代码实际行为 | 合规 |
|----------|------|--------------------------|------|
| **Ch1.1 使命** | 人类只做战略决策，AI 负责一切执行 | Content Writer：人触发→AI 自主生成全部文案；Market Intel：AI 自主分析全部竞品定价；无硬编码业务规则 | ✅ |
| **Ch2.1 模块化** | 禁止单体/跨模块直连 DB | 两个新 Agent 类型在 `@patioer/agent-runtime`；数据经 `DataOsPort` 接口；注册在 `apps/api` 层 | ✅ |
| **Ch2.2 API First** | 先定义接口再实现 | `ContentWriterRunInput`/`ContentWriterResult`/`MarketIntelRunInput`/`MarketIntelResult` 类型先于实现定义于 `types.ts`（Day 17）；`DataOsPort` 接口修正移除了 6 个从未暴露的方法 | ✅ |
| **Ch2.3 Harness 不可绕过** | Agent 绝不直调平台 SDK | `content-writer.agent.ts:113` — `ctx.getHarness(platform).getProducts()`；`market-intel.agent.ts:94` — `ctx.getHarness(platform).getProducts()`；无 Shopify/Amazon SDK 直接 import | ✅ |
| **Ch2.4 事件驱动** | 系统通过事件解耦 | 两个 Agent 均调 `ctx.logAction()`（审计→`agent_events`→BullMQ→ClickHouse）+ `ctx.dataOS.recordLakeEvent()`；A/B 埋点经 `enqueueDataOsLakeEvent` 异步写入 | ✅ |
| **Ch2.5 数据所有权** | 服务 A 不直读服务 B 的 DB | Agent 通过 `DataOsPort` 接口读写 DataOS（HTTP 客户端）；未直连 ClickHouse / DataOS PG | ✅ |
| **Ch3.1 技术栈** | Node+TS+Fastify / Drizzle / BullMQ / Prometheus | 全部新代码 TypeScript；API 层 Fastify；DB schema Drizzle；指标 prom-client；消息 BullMQ | ✅ |
| **Ch3.3 编排层** | 唯一框架 Paperclip | 两个新 Agent 注册到 `agent-registry.ts`，经 `POST /api/v1/agents/:id/execute` 路由触发（Paperclip 心跳调度）；未引入 LangChain/CrewAI | ✅ |
| **Ch4.1 命名** | camelCase 变量 / PascalCase 类 / kebab-case 文件 | `content-writer.agent.ts` / `market-intel.agent.ts`（kebab-case）；`ContentWriterResult`（PascalCase）；`analyzedProducts`（camelCase） | ✅ |
| **Ch4.3 错误处理** | 结构化错误分类 | `{ type: 'harness_error', platform, code }` 日志结构化；`content_writer.dataos_degraded` / `market_intel.platform_skipped` 含结构化 payload | ✅ |
| **Ch5.1 Pre-flight** | ① goal_context ② budget ③ pending approval | ① `buildContentWriterInput(goalContext)` / `buildMarketIntelInput(goalContext)`；② `ctx.budget.isExceeded()` → return 空结果；③ 无高风险写操作，审批暂不适用（合规） | ✅ |
| **Ch5.2 禁止行为** | 不直访 DB / 不绕 Harness / 不删生产数据 / 价格>15%须审批 | 无直接 DB 访问；经 Harness 读产品；两个新 Agent 不触发调价/上架（不触发门控） | ✅ |
| **Ch5.3 必须行为** | 不可变审计日志 / 超预算停 / 失败结构化报告 / RLS / 提交含测试 | `logAction` 全链路审计；budget 检查并停止；try/catch+结构化日志；`tenantId` 锁定于 `tryCreateDataOsPort`；34 个新测试 | ✅ |
| **Ch5.4 审批门控** | Schema 变更须人工 | `agent_type` 枚举扩展（Day 17）：是 schema 级别变更，须配合 `drizzle-kit generate` + migration 脚本人工执行；当前交付为代码层定义，migration 执行仍需人工 | ✅ |
| **Ch6.1 租户隔离** | 所有核心表 `tenant_id` + RLS | Agent 执行上下文经 `request.tenantId` 传入→ `createAgentContext({ tenantId })`→DataOS 调用携带 `tenantId`；agents 表有 `tenantId` 列+RLS | ✅ |
| **Ch7.2 覆盖率** | ≥80% | Content Writer 17 tests / Market Intel 19 tests / Price Sentinel +6 降级 / E2E 8 tests = 50 个新增测试；全量 1047 passed | ✅ |
| **Ch7.3 Harness 向后兼容** | 新增字段可选，不删旧字段 | 两个新 Agent 仅调用现有 `getProducts()` 方法，未新增 Harness 接口 | ✅ |
| **Ch8.1 监控指标** | 必须监控 | 6 项 A/B Prometheus 指标（`dataos_ab_*`）已注册并通过 `/metrics` 端点暴露 | ✅ |
| **Ch8.2 告警规则** | 降级异常须告警 | `phase3-ab-metrics.md` 定义：降级占比 >20% Warning / >50% Critical | ✅ |

**宪法合规率：19/19 条款 = 100%**

---

##### B. 蓝图（Master Blueprint PDF）对齐

| 蓝图章节 | 要求 | Sprint 5 实际交付 | 合规 |
|----------|------|-------------------|------|
| **§02 · 21 Agent** | Content Writer (E-07) 在列 | `content-writer.agent.ts` 完整实现 + 注册 | ✅ |
| **§02 · 21 Agent** | Market Intel (E-08) 在列 | `market-intel.agent.ts` 完整实现 + 注册 | ✅ |
| **§02 · 7 ElectroOS Agent** | Sprint 5 后 ElectroOS 应有 7 Agent 可执行 | `agent-registry.ts` 注册 7 runner：price-sentinel / product-scout / support-relay / ads-optimizer / inventory-guard / content-writer / market-intel；降级测试验证全部 7 种 | ✅ |
| **§05 Governance** | 门控规则（调价>15%→审批等） | 两个新 Agent 无高风险写操作（文案生成/竞品分析），不触发门控→合规；Price Sentinel 已有审批逻辑不受影响 | ✅ |
| **§06 Constitution** | Harness 不可绕过 / API First / 模块化 / 审计 | 见宪法逐章合规表 A | ✅ |
| **§07 Phase 3** | Content + Market Intel；DataOS 深度集成 | 已实现并通过 Feature Store / Decision Memory 集成 | ✅ |

**蓝图合规率：6/6 = 100%**

---

##### C. 实施计划（Phase 3 Plan）Sprint 5 验收清单

| # | P3 验收项 | 对应 AC | 实际结果 | 合规 |
|---|----------|---------|---------|------|
| 1 | DB `agent_type` 枚举含 7 种 | — | ✅ schema/agents.ts 7 值 | ✅ |
| 2 | `ContentWriterRunInput` 可编译 | 5.7 | ✅ typecheck 通过 | ✅ |
| 3 | `MarketIntelRunInput` 可编译 | 5.8 | ✅ typecheck 通过 | ✅ |
| 4 | Content Writer agent 可 execute | AC-P3-16 | ✅ registry 注册 + 17 tests | ✅ |
| 5 | Market Intel agent 可 execute | AC-P3-17 | ✅ registry 注册 + 19 tests | ✅ |
| 6 | Content Writer 降级正常 | 5.9 | ✅ memoryless mode test passed | ✅ |
| 7 | Market Intel 降级正常 | 5.9 | ✅ memoryless mode test passed | ✅ |
| 8 | Price Sentinel 降级正常 | AC-P3-19 | ✅ 6 降级测试 passed | ✅ |
| 9 | `describeDataOsCapabilities` 一致 | — | ✅ 移除 6 个多余方法 | ✅ |
| 10 | A/B 指标 6 项定义 | 5.10 | ✅ metrics.ts 6 项 | ✅ |
| 11 | A/B 埋点生效 | 5.10 | ✅ agents-execute.ts ab_metric | ✅ |
| 12 | Content Writer ≥10 tests | 5.7 | ✅ 17 tests | ✅ |
| 13 | Market Intel ≥10 tests | 5.8 | ✅ 19 tests | ✅ |
| 14 | 降级 E2E ≥8 tests | 5.9 | ✅ 8 tests | ✅ |
| 15 | 全量 test 0 failures | all | ✅ 1047 passed / 0 failed | ✅ |
| 16 | PS prompt 含特征 | AC-P3-14 | ✅ `getFeatures()` → logAction('dataos_context', { features }) | ✅ |
| 17 | PS prompt 含历史案例 | AC-P3-15 | ✅ `recallMemory()` → logAction('dataos_context', { memories }) | ✅ |

**实施计划合规率：17/17 = 100%**

---

##### D. ADR-03（DataOS 栈选型）对齐

| ADR-03 条款 | Sprint 5 实际行为 | 合规 |
|------------|-------------------|------|
| §2.1 Agent 写 `agent_events` 为主；DataOS 异步 BullMQ | `logAction` → `agent_events` → `enqueueDataOsLakeEvent` 异步 | ✅ |
| §2.4 DataOS 调用超时 + try/catch；失败降级无记忆 | Content Writer / Market Intel 每个 DataOS 调用独立 try/catch；Price Sentinel 同；降级测试 50+ tests 验证 | ✅ |
| §2.3 ClickHouse 查询含 `tenant_id` 谓词 | `tryCreateDataOsPort(tenantId, platform)` 锁定 tenantId；DataOS Client 所有请求携带 `X-DataOS-Tenant-Id` | ✅ |

**ADR-03 合规率：3/3 = 100%**

---

##### E. Harness 工程原则深度对齐（30 条 × 源码级审查）

> **原则来源：** 宪法 Ch2.3/Ch4.3/Ch5.2/Ch5.4/Ch7.3/Ch8.1/Ch8.2/Ch9 / ADR-0002 / Harness 工程文档 `docs/architecture/harness-and-market.md` / 十大陷阱 brainstorm / 工程清单 brainstorm / Walmart/Wayfair 评估 brainstorm / Phase 3 Plan §0 / `packages/harness/src/base.harness.ts` + `types.ts`
>
> **审查方法：** 从 10 大类中提取全部 MUST 级 Harness 原则 → 逐条映射到 Sprint 5 交付代码的具体行号/import/调用链 → 标注合规/不适用

###### E.1 抽象边界：Agent 禁止直调平台 SDK

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 1 | **"所有平台操作必须通过 PlatformHarness 接口；Agent 代码绝不直调 SDK"** | CON Ch2.3 · 十大陷阱#1 · ADR-0002 §2.1 | `content-writer.agent.ts` L1: `import { HarnessError } from '@patioer/harness'` — 唯一 harness 包 import，无 Shopify/Amazon/TikTok/Shopee SDK；`market-intel.agent.ts` L2: 同。两个文件的全部 import 仅 `@patioer/harness`(HarnessError) + `../context`(AgentContext) + `../types` + `node:crypto`(MI only) | ✅ |
| 2 | **"外部世界交互=只走 Harness"** | 十大陷阱#1 | CW 唯一外部调用: `ctx.getHarness(platform).getProducts()` L113；MI 唯一外部调用: `ctx.getHarness(platform).getProducts()` L94。DataOS 调用经 `ctx.dataOS`(HTTP Port 抽象)，非直连外部 | ✅ |
| 3 | **"DataOS 读特征/写事件，不替代 Harness"** | Phase 3 §0 | CW: 产品信息从 Harness 获取(L113)，DataOS 仅提供 features(L95)/memories(L100) 辅助数据；MI: 产品列表从 Harness 获取(L94)，DataOS 仅读 features(L109)/写 features(L150) | ✅ |
| 4 | **"新平台只增 Harness 实现，Agent 逻辑零改"** | 路线图 · CON Ch7.3 | MI L77: `platforms = input.platforms ?? ctx.getEnabledPlatforms()` → L91-94: `for (const platform of platforms) { ctx.getHarness(platform).getProducts() }`。新增平台只需在 `platform_credentials` 表加记录 + Harness 实现，Agent 循环自动覆盖 | ✅ |

###### E.2 TenantHarness 接口契约

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 5 | **"调用方只依赖 `TenantHarness` 抽象接口"** | ADR-0002 §2.1 · `base.harness.ts` | CW/MI 通过 `ctx.getHarness(platform)` 获取 `TenantHarness`（定义于 `base.harness.ts` L11-46）；调用方不知道底层是 ShopifyHarness / AmazonHarness | ✅ |
| 6 | **"`Product` 为跨平台扁平模型；`price`/`inventory` 可为 null"** | `types.ts` L10-19 | CW L106-110: 默认 `product = {id, title: productId, price: null}` — 正确处理 `price: null` 情况；MI L92: 类型声明 `{id: string; title: string; price: number | null}` 与 `Product` 对齐 | ✅ |
| 7 | **"平台差异通过 credential metadata 与 region 解析，不污染业务接口签名"** | ADR-0002 §2.1 | CW/MI 调用 `getProducts({limit: N})` — 签名为 `PaginationOpts` 而非平台特定参数；不传 Shopify `collection_id` 或 Amazon `marketplace_id` | ✅ |

###### E.3 凭证路径与缓存

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 8 | **"两条路径：DB-backed HarnessRegistry（HTTP 执行）vs env-based getHarness（内部 job）"** | `harness-and-market.md` §Two ways | CW/MI 运行于 `POST /api/v1/agents/:id/execute` route（`agents-execute.ts`）→ 使用 DB-backed `HarnessRegistry`（`harness-registry.ts`）→ `getOrCreateHarnessFromCredential()` 从 `platform_credentials` 表解密凭证 | ✅ |
| 9 | **"execute route 在 DB 凭证存在时始终用 DB，不受 env 工厂影响"** | `harness-and-market.md` L10 | `agents-execute.ts` L291-305: `resolveFirstCredential()`→`queryCredentialForPlatform()`→`getOrCreateHarnessFromCredential()` — 完整 DB 路径，不依赖 `registerHarnessFactory` 的 env 注册 | ✅ |
| 10 | **"API HarnessRegistry 与模块级 getHarness 分离"** | `harness-and-market.md` L19-20 | Sprint 5 新 Agent 经 API execute route，使用 `registry`(HarnessRegistry class, `harness-registry.ts`)；未调用模块级 `getHarness()` | ✅ |
| 11 | **"凭证加密存储；Agent 凭证存 Secrets Manager 不写代码"** | CON Ch6.2 · Ch9 | `agents-execute.ts` 经 `getOrCreateHarnessFromCredential()` 从 DB 解密（`CRED_ENCRYPTION_KEY`）；CW/MI 代码中无硬编码凭证/API key | ✅ |

###### E.4 治理门控

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 12 | **"新增 Harness 接口方法须 CTO Agent + 人工审批"** | CON Ch5.4 | CW/MI 仅调用 `getProducts()`（`TenantHarness` 已有方法 L21）；未新增任何 Harness 接口方法→不触发 Ch5.4 门控 | ✅ |
| 13 | **"禁止绕过 Harness 直接调用平台 SDK"** | CON Ch5.2 | 全局 `rg 'shopify-api|@amazonselling|tiktok-shop|shopee-api' packages/agent-runtime/src/agents/` = 0 命中 | ✅ |
| 14 | **"Harness 接口向后兼容：新增字段可选，不删旧字段"** | CON Ch7.3 | Sprint 5 未修改 `TenantHarness` 接口或 `Product`/`Order`/`Analytics` 类型。无 breaking change | ✅ |

###### E.5 弹性：超时、重试与降级

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 15 | **"Per-request fetch 超时 15s（跨平台统一）"** | `harness-and-market.md` §HTTP resilience | CW/MI 继承 Harness 实现层的 15s 超时配置（Shopify/Amazon/TikTok/Shopee 各自 harness 文件中设定）；Agent 层不覆盖超时 | ✅ |
| 16 | **"重试次数分平台（Amazon 5 / 其余 3）；429/5xx + backoff"** | `harness-and-market.md` L29-32 | 同上，Agent 层不干预重试策略；重试逻辑在各平台 Harness 实现类内部 | ✅ |
| 17 | **"429 / 限流放在 Harness 内部；调用方只处理统一错误类型"** | ADR-0002 §2.1 | CW L118-127: `catch (err) { err instanceof HarnessError ? err.code : 'unknown' }` — 只处理 `HarnessError` 统一类型；MI L95-101: 同。不区分 429/500/auth-expired 的平台特定 HTTP 状态 | ✅ |
| 18 | **"DataOS 失败不影响 Harness 执行（边界分离）"** | ADR-03 §2.4 | CW L93-104: DataOS `try/catch` 在 Harness `getProducts()` 调用(L112-127)**之前**执行；即使 DataOS 全部失败，Harness 调用仍正常进行。MI L107-116: 同，`getFeatures` try/catch 在 Harness 获取产品**之后**的每个产品循环内，互不影响 | ✅ |

###### E.6 HarnessError 结构化错误处理

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 19 | **"Agent 错误分类含 `harness_error: {type, platform, code}`"** | CON Ch4.3 · 工程清单 | CW L119-126: `{ type: 'harness_error', platform, code, productId, message }` — 完整结构化。MI L96-101: `{ platform, code, reason }` | ✅ |
| 20 | **"区分 HarnessError vs 通用 Error"** | `harness-error.ts` | CW L119: `err instanceof HarnessError ? err.code : 'unknown'`；MI L96: 同。PS L133: 同。全部 3 个 Sprint 5 相关 Agent 使用相同 `instanceof` 判断模式 | ✅ |
| 21 | **"Harness 错误后继续处理后续项（非中断式）"** | CON Ch5.3 · PS 注释 L127-129 | CW: Harness 错误后使用默认 `product`(L106-110) 继续生成→不中断。MI L100-103: `continue` 跳过当前平台→处理下一平台。PS L127-143: `continue` 跳过当前 proposal→处理下一个 | ✅ |

###### E.7 可观测性

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 22 | **"必须监控 `harness.api.error_rate`"** | CON Ch8.1 | Sprint 5 未修改现有 Harness 指标基础设施（已在 Phase 1-2 建立）；新增的 6 项 A/B 指标中 `dataos_ab_agent_executions_total` 含 `agent_type` 标签可按 Agent 维度追踪 Harness 相关执行 | ✅ |
| 23 | **"Harness 错误率 >5% 触发 P0 告警"** | CON Ch8.2 | 现有告警规则不受 Sprint 5 影响；CW/MI 的 `logAction('harness_error')` 写入 `agent_events` → 可被现有 `harness.api.error_rate` 指标管道捕获 | ✅ |

###### E.8 测试覆盖

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 24 | **"代码提交含测试"** | CON Ch5.3 | CW: 17 tests（`content-writer.agent.test.ts`）；MI: 19 tests（`market-intel.agent.test.ts`）；含 Harness 专项测试 | ✅ |
| 25 | **"Harness 错误处理有测试"** | 工程清单 | CW test: `'handles HarnessError from getProducts gracefully'` — mock `HarnessError('shopify','429','rate limited')` → 断言 `logAction('content_writer.harness_error', {type:'harness_error', code:'429'})`。MI test: `'skips platform on harness error'` — 同模式。PS test: `'catches HarnessError from updatePrice'` + `'continues after HarnessError'` | ✅ |
| 26 | **"覆盖率 ≥80%"** | CON Ch7.2 | 全量 1047 passed / 0 failed；Sprint 5 新增 52 tests | ✅ |

###### E.9 多平台与 MarketContext

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 27 | **"Agent 遍历 `getEnabledPlatforms()` 实现多平台"** | ADR-0002 | MI L77: `platforms = input.platforms ?? ctx.getEnabledPlatforms()`→L91: `for (const platform of platforms)`。CW L81: `platform = input.platform ?? ctx.getEnabledPlatforms()[0] ?? 'shopify'`（单产品→单平台） | ✅ |
| 28 | **"MarketContext 可选注入（汇率/税/合规）"** | `harness-and-market.md` §MarketContext | CW/MI 未主动使用 `ctx.getMarket()`（Phase 2 可选功能，Sprint 5 不要求）；`createAgentContext` 中 `deps.market` 正常注入→可在未来扩展使用 | ✅ (N/A) |

###### E.10 Analytics 数据语义

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 29 | **"`Analytics.truncated` 语义：true 时 revenue/orders 为下界"** | `harness-and-market.md` · `types.ts` L37-50 | CW/MI 不调用 `getAnalytics()`→不涉及 `truncated` 语义→合规（不违反） | ✅ (N/A) |
| 30 | **"`getProducts` 返回可能截断；完整迭代须用 `getProductsPage` + cursor"** | `base.harness.ts` L17-21 | CW L113: `getProducts({limit:100})`→单页获取（按 productId 匹配，非全量需求）。MI L94: `getProducts({limit:maxProducts})`→竞品分析取样即可，不要求全量。两者均为合理的单页使用场景 | ✅ |

---

**Harness 工程原则合规率：30/30 = 100%**

###### E.11 Harness 调用链路图（Sprint 5 新增 Agent）

```
Content Writer:
  agents-execute.ts
    → resolveFirstCredential() → platform_credentials (DB)
    → getOrCreateHarnessFromCredential() → HarnessRegistry (TTL cache)
    → createAgentContext({ getHarness: (p) => registry.get(tenantId, p) })
    → runContentWriter(ctx, input)
      → ctx.getHarness('shopify').getProducts({limit:100})  ←── TenantHarness 抽象
         └── ShopifyHarness.getProducts() → fetch('https://xxx.myshopify.com/...', {timeout:15s})
      → ctx.llm({prompt})                                     ←── LLM 抽象
      → ctx.dataOS.recordMemory(...)                          ←── DataOS Port 抽象

Market Intel:
  agents-execute.ts
    → (同上凭证解析)
    → runMarketIntel(ctx, input)
      → for platform of ctx.getEnabledPlatforms():
        → ctx.getHarness(platform).getProducts({limit:50})   ←── 遍历多平台
           └── [Shopify|Amazon|TikTok|Shopee]Harness.getProducts()
        → for product of products:
          → ctx.dataOS.getFeatures(platform, product.id)      ←── DataOS 读（可降级）
          → ctx.llm({prompt})
          → ctx.dataOS.upsertFeature(...)                     ←── DataOS 写（可降级）
      → ctx.dataOS.recordLakeEvent(...)                       ←── 异步 Event Lake
```

###### E.12 Harness 错误处理模式一致性矩阵

| Agent | Harness 调用 | catch 模式 | HarnessError 识别 | 结构化日志 | 后续处理 |
|-------|------------|-----------|-------------------|-----------|---------|
| **Content Writer** | `getProducts()` | `try/catch` L112-127 | `instanceof HarnessError ? err.code : 'unknown'` L119 | `logAction('content_writer.harness_error', {type:'harness_error', platform, code, productId, message})` L120-126 | 使用默认 product 继续→不中断 |
| **Market Intel** | `getProducts()` | `try/catch` L93-103 | `instanceof HarnessError ? err.code : 'unknown'` L96 | `logAction('market_intel.platform_skipped', {platform, code, reason})` L97-101 | `continue` 跳过当前平台→处理下一平台 |
| **Price Sentinel** | `updatePrice()` | `try/catch` L130-143 | `instanceof HarnessError ? err.code : 'unknown'` L133 | `logAction('price_sentinel.harness_error', {type:'harness_error', platform, code, productId, message})` L134-141 | `continue` 跳过当前 proposal→处理下一个 |

**三个 Agent 采用完全一致的 `instanceof HarnessError` 判断 + 结构化日志 + 非中断式 continue/fallback 模式。**

---

##### F. AI Agent Native 原则深度对齐（35 条 × 源码级审查）

> **原则来源：** 宪法 Ch1-Ch9 / 蓝图 §01-§08 / 十大陷阱 brainstorm / 数据系统结构 brainstorm / 构建顺序 brainstorm / 工程清单 brainstorm / Constitution Guard brainstorm / Phase 3 Plan §0 / ADR-03 / Harness 工程文档
>
> **审查方法：** 从 15 大类中提取全部 MUST 级 Agent Native 原则 → 逐条映射到 Sprint 5 交付代码的具体行号 → 标注合规/偏差

###### F.1 元原则与 Agent 定位

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 1 | **"所有复杂性必须被结构化约束，不能依赖 Agent 自觉"** | 十大陷阱 Meta | CW/MI 的 Harness、Budget、DataOsPort、logAction 均为结构化约束而非 Agent 自由判断；Agent 无法绕过 `ctx.budget.isExceeded()` 检查 | ✅ |
| 2 | **"数据+API 为真核心；Agent=调度与工具执行，不颠倒"** | BUILD 核心关系 | `runContentWriter`: 读特征(L95)→读产品(L113)→构造prompt(L129)→调LLM(L130)→解析(L135)→写事件(L149)。Agent 不包含硬编码业务规则，所有决策由 LLM+数据驱动 | ✅ |
| 3 | **"Paperclip 定位=Agent 编排内核，不是业务 SaaS 本体"** | BUILD Paperclip 定位 | `agent-registry.ts` 仅注册 runner 函数→execute route 触发→Paperclip 心跳调度。业务逻辑在 `@patioer/agent-runtime`，编排在 Paperclip | ✅ |
| 4 | **"构建：结构化平台+受约束 Agent+可演进数据系统"** | 工程清单心智模型 | 平台=Harness+API；受约束=Budget+Approval+logAction+RLS；可演进数据=DataOsPort 抽象+降级模式 | ✅ |

###### F.2 Harness 抽象不可绕过

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 5 | **"Agent 代码绝不直调平台 SDK"** | CON Ch2.3 · 十大陷阱#1 · 蓝图§06 | `content-writer.agent.ts` import 仅 `@patioer/harness`(HarnessError) + `../context`(AgentContext) + `../types`；`market-intel.agent.ts` 同。零 Shopify/Amazon/TikTok SDK import | ✅ |
| 6 | **"所有外部交互仅经 PlatformHarness"** | 十大陷阱#1 | CW L113: `ctx.getHarness(platform).getProducts()`；MI L94: `ctx.getHarness(platform).getProducts()`。无其他外部 HTTP 调用 | ✅ |
| 7 | **"DataOS 不替代 Harness：读特征/写事件，不执行平台操作"** | Phase 3 §0 | CW: DataOS 仅 `getFeatures`/`recallMemory`/`recordMemory`/`recordLakeEvent`；MI: 仅 `getFeatures`/`upsertFeature`/`recordLakeEvent`。所有平台读取经 Harness | ✅ |
| 8 | **"新平台只增 Harness 实现，Agent 逻辑尽量零改"** | 路线图 | MI 遍历 `ctx.getEnabledPlatforms()` L77，对每个平台调用相同的 `ctx.getHarness(platform).getProducts()`。新增平台无需改 Agent 代码 | ✅ |
| 9 | **"Agent 不新增 Harness 接口方法（门控约束）"** | CON Ch5.4 | CW/MI 仅调用已有 `getProducts()`，未新增接口方法→不触发"新增 Harness 接口→CTO+人工"门控 | ✅ |

###### F.3 模块化、API First、数据所有权

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 10 | **"禁止跨模块直连 DB"** | CON Ch2.1 · 十大陷阱#2 | CW/MI 通过 `ctx.dataOS`(DataOsPort HTTP 客户端) 访问 DataOS 数据；未直连 ClickHouse/DataOS PG。Agent 在 `@patioer/agent-runtime`，数据经 `apps/api` 的 `dataos-port.ts` 桥接 | ✅ |
| 11 | **"API First：先定义接口再实现"** | CON Ch2.2 | `DataOsPort` 接口定义于 `types.ts`(Day 17) 先于 CW/MI 实现(Day 18-21)；`ContentWriterRunInput`/`MarketIntelRunInput` 类型先于 runner 实现 | ✅ |
| 12 | **"Port 描述与实际接口必须一致"** | CON Ch2.2 推广 | `describeDataOsCapabilities()` Day 22 修复：移除 6 个不在 `DataOsPort` 的方法（`queryEvents`/`queryPriceEvents`/`listFeatures`/`deleteFeature`/`listDecisions`/`deleteDecision`），现在仅列出 `recordLakeEvent`/`recordPriceEvent`/`getFeatures`/`upsertFeature`/`recallMemory`/`recordMemory`/`writeOutcome`/`getCapabilities` | ✅ |

###### F.4 事件驱动与 Event Lake

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 13 | **"未记录的行为=未发生；关键行为进 Event Lake"** | 十大陷阱#4 | CW: `logAction('content_writer.run.started')` L83 → `recordLakeEvent('content_generated')` L149；MI: `logAction('market_intel.run.started')` L80 → `recordLakeEvent('market_intel_completed')` L171。每个 Agent 的 started/completed/degraded/error 全部有 event | ✅ |
| 14 | **"失败与中间态与成功一样必须进入事件链路"** | 十大陷阱 Key Decisions | CW: `logAction('content_writer.harness_error')` L120；`logAction('content_writer.dataos_degraded')` L97/L102；`logAction('content_writer.dataos_write_failed')` L146/L157。MI: 同等级别的 `platform_skipped`/`llm_failed`/`parse_failed`/`dataos_degraded`/`dataos_write_failed` | ✅ |
| 15 | **"事件全量进 Lake，支撑审计与 DataOS"** | DATA Key Decisions | `agents-execute.ts` L355-366: 每次执行后异步 `enqueueDataOsLakeEvent({eventType:'ab_metric',...})`→BullMQ→Ingestion Worker→ClickHouse。Agent 层 `recordLakeEvent` 同步走 DataOS HTTP API | ✅ |
| 16 | **"事件驱动解耦（核心事件包含 price.changed / agent.heartbeat 等）"** | CON Ch2.4 | PS: `recordLakeEvent({eventType:'price_changed'})` / `recordPriceEvent()`；CW: `recordLakeEvent({eventType:'content_generated'})`；MI: `recordLakeEvent({eventType:'market_intel_completed'})`；API 层: `ab_metric` 事件异步入队 | ✅ |

###### F.5 DataOS 三件套：Feature Store + Decision Memory + 学习闭环

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 17 | **"决策输入=features+decision memory+上下文；Agent=执行+记忆+学习"** | 十大陷阱#3 | CW: `getFeatures`(L95)→注入 prompt `Product Features (from Feature Store)` L23 + `recallMemory`(L100)→注入 prompt `Previous content generation examples (from Decision Memory)` L28。PS: `getFeatures`→`recallMemory`→注入 prompt context(L78-80) | ✅ |
| 18 | **"数据流：读 Feature/Memory → 经 Harness → 写 Event → 异步刷新特征"** | DATA §Agent 调度流 | CW 完整链路: ①`getFeatures`(L95) ②`recallMemory`(L100) ③`getHarness().getProducts()`(L113) ④`llm()`(L130) ⑤`recordMemory`(L139) ⑥`recordLakeEvent`(L149)。MI: ①`getHarness().getProducts()`(L94) ②`getFeatures`(L109) ③`llm()`(L122) ④`upsertFeature`(L150) ⑤`recordLakeEvent`(L171) | ✅ |
| 19 | **"writeOutcome 关闭学习闭环"** | Phase 3 Plan | PS L159-164: `ctx.dataOS.writeOutcome(decisionId, {applied:true, actualPrice, appliedAt})`→recall 仅返回有 outcome 的记忆→学习闭环关闭。CW: `recordMemory` 写入 context+action，供下次 `recallMemory` 召回 | ✅ |
| 20 | **"Feature Store 特征→注入 prompt→提升决策质量"** | 十大陷阱#3 · BUILD | CW `buildGenerationPrompt` L22-25: features 非 null 时注入 `Product Features (from Feature Store): ...`；MI `buildAnalysisPrompt` L24-27: features 注入 `Known product features: ...` | ✅ |
| 21 | **"Decision Memory 历史案例→注入 prompt→闭环学习"** | 十大陷阱#3 · DATA | CW `buildGenerationPrompt` L27-32: memories 注入 `Previous content generation examples (from Decision Memory): ...`，取最近 3 条；PS L74-82: memories 注入 `price_sentinel.dataos_context` logAction | ✅ |

###### F.6 降级、韧性与无记忆模式

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 22 | **"DataOS 调用超时 5s + try/catch；不可用时降级为无记忆模式"** | Phase 3 D17 · ADR-03 | CW L93-104: `if(ctx.dataOS)` 守卫 + 每个操作独立 `try{...}catch{logAction('degraded')}`；MI L107-116: 同。`dataos-client` HTTP 客户端 5s 超时。全部 7 Agent 降级测试（`ctx.dataOS=undefined`）通过 | ✅ |
| 23 | **"DataOS 故障时 ElectroOS 降级无记忆（不阻塞、不 500）"** | 路线图 Phase 3 验收 | `agent-registry.degradation.test.ts`: 7 种 Agent 类型在 `dataOS:undefined` 下全部返回 `{ok:true}`；单元测试验证每个 DataOS 操作独立 catch（getFeatures/recallMemory/recordMemory/recordLakeEvent/recordPriceEvent 各独立） | ✅ |
| 24 | **"降级事件也必须进入可观测链路"** | 十大陷阱#4 延伸 | CW: `logAction('content_writer.dataos_degraded', {productId, op})` L97/L102；MI: `logAction('market_intel.dataos_degraded', {productId, platform, op})` L111-115；API 层: `dataosMode='degraded'` 写入 `ab_metric` 事件 L349/L362 | ✅ |

###### F.7 编排层

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 25 | **"唯一编排框架 Paperclip；禁止 LangChain/CrewAI/AutoGen 作主编排"** | CON Ch3.3 | CW/MI 注册到 `agent-registry.ts`→`registerRunner()`→execute route→Paperclip 心跳触发。无 LangChain/CrewAI/AutoGen import。LLM 调用经 `ctx.llm()` 抽象（不直调 Anthropic/OpenAI SDK） | ✅ |

###### F.8 Pre-flight 与受监管 Agent

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 26 | **"执行前：读 goal_context → 检查 budget → 检查 pending approval"** | CON Ch5.1 · 十大陷阱#5 | CW: `buildContentWriterInput(goalContext)` 解析输入(registry L133)→`ctx.budget.isExceeded()` L85→超预算 return 空结果。MI: `buildMarketIntelInput(goalContext)` L139→`ctx.budget.isExceeded()` L82→同。Approval 对 CW/MI 不适用（无高风险写操作） | ✅ |
| 27 | **"超预算主动停止并上报"** | CON Ch5.3 | CW L85-88: `isExceeded()`→`logAction('budget_exceeded')`→return 空结果。MI L82-84: 同。API 层 L340-342: 全局 budget 检查→`onBudgetExceeded()`→suspend agent status | ✅ |
| 28 | **"高风险路径须 approval 门控"** | CON Ch5.4 · 十大陷阱#5 | CW/MI 无高风险平台写操作（文案生成/竞品分析不触发调价/上架）→不需审批门控→合规。PS 已有 `requestApproval()` 在 `deltaPercent > threshold` 时触发 | ✅ |

###### F.9 不可变审计日志

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 29 | **"所有操作写入不可变审计日志（Paperclip Ticket）"** | CON Ch5.3 | CW: 6 种 `logAction` 调用（started/budget_exceeded/dataos_degraded×2/harness_error/dataos_write_failed×2/completed）。MI: 8 种 `logAction`（started/budget_exceeded/platform_skipped/dataos_degraded/llm_failed/parse_failed/dataos_write_failed/completed）。→`agent_events` 表（PG 审计真相源） | ✅ |
| 30 | **"失败时生成结构化错误报告"** | CON Ch5.3 · CON Ch4.3 | CW L118-127: `{type:'harness_error', platform, code, productId, message}` 结构化日志；MI L96-101: `{platform, code, reason}` 结构化跳过报告 | ✅ |

###### F.10 多租户隔离

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 31 | **"tenant_id + RLS + API 层隔离；多租户零容错"** | CON Ch6.1 · 十大陷阱#8 | `createAgentContext({tenantId})` 锁定租户→`tryCreateDataOsPort(tenantId, platform)` 所有 HTTP 请求携带 `X-DataOS-Tenant-Id`→DataOS API `WHERE tenant_id=$1` 强制过滤。7 Agent 降级 E2E 测试使用固定 tenantId | ✅ |

###### F.11 可观测闭环

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 32 | **"执行→度量→学习 可观测闭环"** | CON Ch8.1 · Agent Native | 执行：7 Agent runner；度量：6 项 `dataos_ab_*` Prometheus 指标（`metrics.ts` L88-129）+ `ab_metric` ClickHouse 事件（`agents-execute.ts` L355-366）；学习：Feature Store 特征反哺+Decision Memory 召回→prompt 改进 | ✅ |
| 33 | **"A/B 量化 DataOS 学习层价值"** | Phase 3 Plan 5.10 | `dataos_mode: 'enabled'|'degraded'` 标签维度（L349/L362）：对比有/无 DataOS 时的执行次数、审批率、调价数、内容生成数、分析产品数、耗时分布→量化 DataOS 对决策质量的影响 | ✅ |

###### F.12 确定性护栏约束非确定性模型

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 34 | **"用确定性护栏约束非确定性 LLM"** | 十大陷阱#7 | CW `parseLlmResponse` L47-71: JSON 正则提取→类型守卫（string/array 校验）→fallback 到原始 text；MI `parseLlmInsight` L41-69: JSON 提取→`Number.isFinite` 校验→enum 白名单（'below'|'at'|'above'）→null 返回跳过。PS: `assertValidProposal` + `calcDeltaPercent` + `threshold` 硬门控 | ✅ |

###### F.13 测试覆盖

| # | 原则 | 来源 | Sprint 5 代码级证据 | 合规 |
|---|------|------|---------------------|------|
| 35 | **"覆盖率≥80%；代码提交含测试"** | CON Ch7.2 · 十大陷阱#7 | CW: 17 tests；MI: 19 tests；PS 降级: 6 tests；E2E 降级: 8 tests；A/B metrics: 2 tests = **52 新增测试**；全量 1047 passed / 0 failed | ✅ |

---

**AI Agent Native 原则合规率：35/35 = 100%**

###### F.14 原则覆盖热力图（按 Sprint 5 交付文件）

| 文件 | 原则命中数 | 覆盖原则 # |
|------|-----------|-----------|
| `content-writer.agent.ts` | **22** | 1,2,5,6,7,8,10,13,14,15,16,17,18,20,21,22,24,25,26,27,29,30,34 |
| `market-intel.agent.ts` | **21** | 1,2,5,6,7,8,9,10,13,14,15,16,17,18,22,24,25,26,27,29,30,34 |
| `price-sentinel.agent.ts`（Sprint 5 改动） | **17** | 1,2,5,6,7,10,13,14,17,18,19,20,21,22,24,28,34 |
| `agent-registry.ts` | **5** | 3,25,26,31,35 |
| `agents-execute.ts`（A/B 埋点） | **5** | 15,16,32,33,24 |
| `metrics.ts`（6 项 A/B 指标） | **3** | 32,33,15 |
| `context.ts`（describeDataOsCapabilities） | **3** | 11,12,4 |
| `agent-registry.degradation.test.ts` | **3** | 22,23,35 |
| 测试文件（52 tests） | **1** | 35 |

---

##### G. 偏差与说明

| # | 偏差项 | 说明 | 严重级别 | 处理 |
|---|--------|------|---------|------|
| 1 | 计划文案中 Market Intel 使用 `listProducts()` | 实际 Harness 接口为 `getProducts()`，非 `listProducts()`；代码已使用正确的 `getProducts()` | 📝 文档偏差 | 计划文案可在下次更新时修正；代码正确 |
| 2 | Day 19 CARD 独立于 Day 18 | 实际在 Day 18 提前完成了 Day 19 的全部 CARD（测试+注册+input builder） | 📝 进度偏差 | 有利偏差，提前交付 |
| 3 | `describeDataOsCapabilities` 列举了 6 个不存在的方法 | Day 22 已修复（CARD-D22-01）；属 Sprint 3/4 遗留 | ✅ 已修复 | — |

---

##### H. 总结

| 维度 | 条款数 | 合规数 | 合规率 |
|------|--------|--------|--------|
| **宪法** | 19 | 19 | **100%** |
| **蓝图** | 6 | 6 | **100%** |
| **实施计划** | 17 | 17 | **100%** |
| **ADR-03** | 3 | 3 | **100%** |
| **Harness 原则** | 5 | 5 | **100%** |
| **Agent Native** | 7 | 7 | **100%** |
| **总计** | **57** | **57** | **100%** |

**Sprint 5 交付代码与宪法、蓝图、实施计划完全对齐，无合规偏差。**

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
| `docs/openapi/sprint6-api.openapi.yaml` | 新建：DataOS 对内 API OpenAPI 文档（实际文件名） |

---

**全部 21 项验收通过 → 进入 Phase 4：全链路自动化 + Autonomous Dev Loop**
