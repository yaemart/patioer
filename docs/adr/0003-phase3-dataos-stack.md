# ADR-0003 · Phase 3 DataOS（Event Lake / Feature Store / Decision Memory）

**状态：** Accepted  
**日期：** 2026-03-25  
**决策者：** 项目创始人  
**关联：** `docs/system-constitution.md`、`docs/adr/0002-phase2-harness-market-devos-deployment.md`、`docs/plans/phase2-plan.md`（D4：Phase 3 引入 ClickHouse）

---

## 1. 背景

Phase 2 在 PostgreSQL `agent_events` 中记录 Agent 审计事件；Phase 3 需要 **分析型事件湖**、**实时特征**与**决策记忆**，以支持学习型 Agent，同时保持 ElectroOS 与 DataOS 边界清晰。

---

## 2. 决策

### 2.1 职责划分：PG 审计 vs ClickHouse Event Lake

| 存储 | 角色 | 说明 |
|------|------|------|
| **ElectroOS `agent_events`** | 权威审计轨迹（Phase 1–2 不变） | RLS、业务合规、快速按租户查询 |
| **ClickHouse `electroos_events.*`** | 不可变分析湖、特征抽取、聚合 | 异步最终一致；由 Ingestion 队列写入 |

**约束：** Agent 执行路径仍以写入 `agent_events` 为主；DataOS Ingestion 消费 **BullMQ** 任务写入 ClickHouse，失败不阻塞主请求（可重试）。

### 2.2 DataOS 技术栈

| 组件 | 选型 | 端口 / 说明 |
|------|------|-------------|
| Event Lake | ClickHouse 24+ | HTTP `8123` |
| Feature Store 持久化 + Decision Memory | PostgreSQL 16 + pgvector（`pgvector/pgvector` 镜像） | 宿主机 **`5434`**（避免与 ElectroOS `5432`、DevOS `5433` 冲突） |
| Feature Store 缓存 | Redis（DataOS 专用实例） | 宿主机 **`6380`** |
| 事件传输 | BullMQ（复用 Phase 2 Redis；可与 ElectroOS 共用 URL 或独立部署，见环境变量） |
| DataOS API | 独立 Node 服务（Fastify），**`3300`** | 对内 REST + Worker（Ingestion / Feature / Insight） |

**Paperclip：** DataOS 控制面可与 Master Blueprint 对齐由 Paperclip 承载；本仓库 MVP 以 **Fastify `apps/dataos-api`** 实现 DataOS 服务面，便于与现有 Monorepo 测试/类型共享。

### 2.3 安全与隔离

- 所有 ClickHouse 查询 **必须**包含 `tenant_id` 谓词（应用层强制）。
- DataOS PostgreSQL 当前版本以 **应用层 `WHERE tenant_id = $1`** + 内网 API + `UNIQUE (tenant_id, …)` 为主；**强化 RLS** 可作为后续 hardening（与 Phase 2 ElectroOS RLS 对齐）。
- **跨租户数据共享**不在 Phase 3 范围（见 Phase 3 蓝图 PDF）。

### 2.4 故障降级

ElectroOS 调用 DataOS HTTP 客户端须 **超时 + try/catch**；失败时 Agent **降级为无 DataOS 记忆模式**，不影响 Harness 执行。

---

## 3. 备选方案

| 方案 | 不采用原因 |
|------|------------|
| 仅扩展 PG 分区表替代 ClickHouse | 大规模聚合与 TTL 成本高于 CH；与蓝图 Phase 3 不一致 |
| DataOS 与 ElectroOS 同库 | 分析写入与 OLTP 争抢；违背模块化 |
| 引入 Kafka | 蓝图明确 Phase 3 用 BullMQ 降低复杂度 |

---

## 4. 后果

- 运维需维护 **额外 Compose 栈**（`docker-compose.dataos.yml`）与密钥。
- 本地开发需可选启动 DataOS；未启动时 ElectroOS 仍可通过 `DATAOS_ENABLED=0` 运行。

---

## 5. 状态

Accepted · 随 Phase 3 实施迭代修订迁移脚本与端口说明。
