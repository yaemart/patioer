# DataOS 本地开发（Sprint 1）

与 [`docs/ops/devos-local.md`](devos-local.md) 类似，DataOS 使用**独立 Compose 栈**，避免与 ElectroOS / DevOS 端口冲突。

## 端口一览

| 服务 | 宿主端口 | 说明 |
|------|----------|------|
| ClickHouse HTTP | `8123` | Event Lake |
| ClickHouse Native | `9000` | 客户端可选 |
| DataOS PostgreSQL | `5434` | pgvector + Feature/Memory 表 |
| DataOS Redis | `6380` | Feature Store 缓存 |
| DataOS API | `3300` | Sprint 1 Day 9 起可用 |

## Sprint 1 · Day 1 — 基础设施

仅启动 ClickHouse + PostgreSQL + Redis（不启动 `dataos-api`，直至 Day 9 代码就绪）：

```bash
docker compose -f docker-compose.dataos.yml up -d dataos-clickhouse dataos-postgres dataos-redis
```

### 验证 ClickHouse

```bash
curl -s 'http://localhost:8123/?query=SELECT%201'
# 期望：1
```

若镜像启用了用户 `dataos` / 密码 `dataos`，HTTP 可能需要 Basic Auth；脚本 `pnpm dataos:clickhouse:apply-ddl` 使用环境变量 `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD`。

### 应用 Event Lake DDL

```bash
CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=dataos CLICKHOUSE_PASSWORD=dataos \
  pnpm dataos:clickhouse:apply-ddl
```

### 验证 PostgreSQL + pgvector

```bash
docker exec patioer-dataos-postgres psql -U dataos -d dataos -c "SELECT 1;"
docker exec patioer-dataos-postgres psql -U dataos -d dataos -c \
  "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname='vector';"
```

### 验证 Redis

```bash
docker exec patioer-dataos-redis redis-cli PING
# 期望：PONG
```

## Sprint 1 · Day 2 — PostgreSQL 迁移（`product_features` / `decision_memory`）

在 Postgres 已启动（见上）且 `DATABASE_URL` 指向本机 `5434` 时执行：

```bash
DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos pnpm dataos:migrate
# 期望：[dataos-migrate] applying 001_init.sql
#        [dataos-migrate] done
```

脚本会按文件名排序执行 `packages/dataos/migrations/*.sql` 全文。可重复执行（幂等）。

### 快速验收

```bash
docker exec patioer-dataos-postgres psql -U dataos -d dataos -c "\dt"
# 期望：public | product_features | table | …
#       public | decision_memory  | table | …

docker exec patioer-dataos-postgres psql -U dataos -d dataos \
  -c "SELECT typname FROM pg_type WHERE typname='vector';"
# 期望：vector

docker exec patioer-dataos-postgres psql -U dataos -d dataos \
  -c "SELECT '[1,2,3]'::vector(3);"
# 期望：不报错
```

IVFFlat 向量索引（数据量足够后手动执行）见仓库根目录 `scripts/dataos-pgvector-ivfflat.sql`，**不要**放进 `packages/dataos/migrations/`（`CREATE INDEX CONCURRENTLY` 不宜在普通迁移事务里跑）。

## 环境变量（参考）

复制到 `.env`（勿提交密钥）：

```bash
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=dataos
CLICKHOUSE_PASSWORD=dataos
DATAOS_PG_PASSWORD=dataos
DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos

# Sprint 2 — BullMQ Event Lake 管道
DATAOS_LAKE_QUEUE_ENABLED=1
BULLMQ_CONNECTION_URL=redis://localhost:6380
DATAOS_API_URL=http://localhost:3300
DATAOS_INTERNAL_KEY=dev-dataos-internal-key
```

### Sprint 2 · BullMQ 管道启用

ElectroOS API 需要以下变量才能将 Agent 事件异步写入 DataOS Event Lake：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATAOS_LAKE_QUEUE_ENABLED` | `0` | 设为 `1` 启用 BullMQ 生产者 |
| `BULLMQ_CONNECTION_URL` | `redis://localhost:6379` | 指向 DataOS Redis（本地为 `6380`） |
| `DATAOS_API_URL` | — | DataOS API 地址（`http://localhost:3300`） |
| `DATAOS_INTERNAL_KEY` | — | DataOS 内部鉴权密钥 |

**Harness 约束：**

1. **BullMQ 生产者/消费者必须共享同一 Redis 实例。** ElectroOS API 的 `BULLMQ_CONNECTION_URL` 必须指向与 DataOS API 相同的 Redis，否则 Job 无法被消费。
2. 不设置 `DATAOS_LAKE_QUEUE_ENABLED=1` 时，`enqueueDataOsLakeEvent` 静默 no-op，Agent 执行主路径不受影响。
3. 启用后需确保 `docker-compose.dataos.yml` 栈已运行。
4. **本地开发同时运行两栈时：** 在 `.env` 中设置 `BULLMQ_CONNECTION_URL=redis://localhost:6380`，确保两端指向 DataOS Redis。
