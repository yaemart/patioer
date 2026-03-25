# ADR-0002 · Phase 2 架构决策（Harness 扩展 / Market 层 / DevOS 部署）

**状态：** Accepted  
**日期：** 2026-03-25  
**决策者：** 项目创始人  
**关联：** `docs/system-constitution.md`、`docs/adr/0001-paperclip-integration.md`、`docs/plans/phase2-plan.md`

---

## 1. 背景

Phase 2 在 Phase 1 基础上同时推进三类能力：

1. 多平台 Harness（Amazon / TikTok / Shopee）扩展；
2. Market 规则层（货币、税率、市场差异）；
3. DevOS 独立实例（SRE + Ticket 基础能力）联动 ElectroOS。

如不明确边界，容易出现三种风险：

- Agent 直接写平台 SDK，绕过 Harness；
- 市场规则散落在 Agent 与 Route 层，难维护；
- DevOS 与 ElectroOS 混库混端口，导致控制面与业务面耦合。

---

## 2. 决策

### 2.1 Harness 扩展策略

采用 **统一接口 + 平台实现** 模式：

- `TenantHarness` 作为唯一业务访问入口；
- Amazon / TikTok / Shopee 均在 `packages/harness` 内以实现类扩展；
- Agent 和 API Route 只依赖抽象接口，不直接依赖平台 SDK。

**约束：**

- 任何新平台接入必须通过 Harness，禁止在 `agent-runtime` 或 `apps/api` 直接调用平台 SDK；
- 平台差异通过 credential metadata 与 region 解析，不污染业务接口签名；
- 429 / 限流逻辑放在 Harness 内部封装，调用方只处理统一错误类型。

### 2.2 Market 层职责划分

采用 **独立 `packages/market`**：

- 汇率转换、税率计算、市场规则统一在 Market 层实现；
- Agent（如 Ads Optimizer、Price Sentinel）通过函数调用使用 Market 能力；
- Market 层不感知 HTTP、不依赖 Route，不写业务数据库。

**约束：**

- 市场规则变更必须以测试驱动（currency / tax 单测）；
- 默认规则 + 租户覆盖分离，避免跨租户污染；
- 汇率失败时必须有降级策略（缓存或最近有效值）。

### 2.3 DevOS 部署与隔离

采用 **独立 Compose 栈 + 独立 PostgreSQL**：

- DevOS 通过 `docker-compose.devos.yml` 单独运行；
- DevOS DB：`localhost:5433/devos`，ElectroOS DB：`localhost:5432/patioer`；
- DevOS Paperclip 使用双入口：`3101`（运行稳定入口）和 `3200`（Phase 2 AC 入口）。

**约束：**

- 必须使用 `assertElectroOsAndDevOsDbIsolated()` 做库隔离检查；
- ElectroOS → DevOS 通过 HTTP Bridge（`@patioer/devos-bridge`），禁止跨库直读；
- DevOS 仅覆盖 Phase 2 范围（SRE + Ticket），不提前引入 Autonomous Dev Loop。

---

## 3. 备选方案

| 方案 | 描述 | 不采用原因 |
|------|------|------------|
| A. 在 Agent 内部分散平台 SDK 调用 | 每个 Agent 自己适配平台 | 违反 Constitution Harness 原则，重复高 |
| B. 市场逻辑放在 API 层 | route/controller 直接写税率汇率 | 业务逻辑与传输层耦合，难复用 |
| C. DevOS 与 ElectroOS 共库 | 共用同一 PostgreSQL 数据库 | 控制面和业务面耦合，风险高 |

---

## 4. 后果

### 正面

- 平台扩展成本下降，接口稳定；
- 市场规则可测试、可复用；
- DevOS 与 ElectroOS 控制面分离，故障域清晰；
- 与 System Constitution（Harness / 边界 / RLS / CI）一致。

### 负面

- 需要维护更多模块边界和文档；
- 本地开发需要同时维护多端口和双 Compose 栈；
- 新平台引入时，Harness 测试和集成测试成本上升。

---

## 5. 落地检查清单（Phase 2）

- [x] Harness 扩展代码落地（Amazon/TikTok/Shopee）
- [x] Market 规则测试通过（AC-P2-05/06）
- [x] DevOS 独立实例可访问，双库隔离成立（AC-P2-11/14）
- [x] OpenAPI 补充文档覆盖 Sprint 6 新增接口（Task 6.7）
- [x] 运维文档补齐 DevOS 与告警配置（Task 6.8）

---

## 6. 后续演进

- Phase 3 引入 DataOS（Event Lake / Feature Store / Decision Memory）时，保持本 ADR 的边界不变；
- Phase 4 再引入 DevOS Autonomous Dev Loop，不在本 ADR 范围内提前实现。
