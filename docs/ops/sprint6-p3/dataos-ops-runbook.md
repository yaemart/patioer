# DataOS 运维手册

## 架构概览

DataOS 是 ElectroOS 的学习数据层，由三个核心组件组成：

| 组件 | 技术 | 用途 |
|---|---|---|
| Event Lake | ClickHouse | 高吞吐事件存储 + 分析 |
| Feature Store | PostgreSQL + Redis | 产品特征快照 + 缓存 |
| Decision Memory | PostgreSQL + pgvector | 决策记录 + 向量语义召回 |

## 服务拓扑

```
docker-compose.dataos.yml
├── patioer-dataos-clickhouse  (port 8123)
├── patioer-dataos-postgres    (port 5434)
├── patioer-dataos-redis       (port 6380)
└── patioer-dataos-api         (port 3300)
```

**注意：** DataOS Redis 使用 host 端口 6380（避免与 ElectroOS Redis 6379 冲突）

## 启动/停止

```bash
# 启动
docker-compose -f docker-compose.dataos.yml up -d

# 健康检查
curl -sf http://localhost:3300/health

# 停止
docker-compose -f docker-compose.dataos.yml down

# 查看日志
docker-compose -f docker-compose.dataos.yml logs -f dataos-api
```

## 监控指标 (Prometheus)

```bash
curl -sf http://localhost:3300/metrics
```

| 指标 | 说明 |
|---|---|
| `dataos_feature_cache_hits_total` | Feature Store 缓存命中 |
| `dataos_feature_cache_misses_total` | Feature Store 缓存未命中 |
| `dataos_lake_events_inserted_total` | Event Lake 写入事件数 |
| `dataos_ingestion_jobs_processed_total` | BullMQ 处理任务数 |
| `dataos_insight_agent_ticks_total` | Insight Agent 执行次数 |
| `dataos_insight_agent_outcomes_written_total` | Insight Agent 写入 outcome 数 |

## 租户隔离

- **Event Lake (ClickHouse):** 应用层 WHERE tenant_id 过滤
- **Feature Store (PostgreSQL):** RLS + tenant-scoped Redis 缓存键
- **Decision Memory (PostgreSQL):** RLS + SQL WHERE tenant_id 双重过滤
- **ClickHouse 用户权限:** `dataos` 用户仅有 SELECT + INSERT 权限

## 数据保留

- ClickHouse `events` 表: TTL 2 年 (自动清理)
- ClickHouse `price_events` 表: TTL 2 年 (自动清理)
- PostgreSQL 数据: 无自动 TTL，需手动归档

## 降级策略

DataOS 完全宕机时，Agent 自动切换到 memoryless 模式：
- 核心功能（价格调整/文案生成/竞品分析）不受影响
- Agent 日志记录 `*_dataos_degraded` 动作
- DataOS 恢复后自动恢复数据写入

## 常见问题排查

### 1. DataOS API 无响应

```bash
docker-compose -f docker-compose.dataos.yml ps
docker-compose -f docker-compose.dataos.yml logs dataos-api --tail 50
```

### 2. Feature Store 缓存命中率低

```bash
curl -sf http://localhost:3300/metrics | grep cache
# 如需清缓存：
docker exec patioer-dataos-redis redis-cli -n 0 FLUSHDB
```

### 3. ClickHouse 查询超时

```bash
# 检查表行数
curl -s 'http://localhost:8123/?user=dataos&password=dataos&query=SELECT+count()+FROM+electroos_events.events'
# 检查分区
curl -s 'http://localhost:8123/?user=dataos&password=dataos' --data-binary "SELECT partition, rows FROM system.parts WHERE database='electroos_events' AND table='events' FORMAT JSONEachRow"
```
