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

## 环境变量（参考）

复制到 `.env`（勿提交密钥）：

```bash
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=dataos
CLICKHOUSE_PASSWORD=dataos
DATAOS_PG_PASSWORD=dataos
DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos
```
