# ADR-0004 · Phase 4 Autonomous Dev Loop + 三层全连通

**状态：** Accepted  
**日期：** 2026-03-28  
**决策者：** 项目创始人  
**关联：** `docs/system-constitution.md`、`docs/adr/0003-phase3-dataos-stack.md`、`docs/brainstorms/2026-03-28-phase4-autonomous-dev-loop-brainstorm.md`

---

## 1. 背景

Phase 3 完成了 DataOS 三层存储（Event Lake / Feature Store / Decision Memory），21 项 AC 全部通过。Phase 4 是技术里程碑：三层（ElectroOS / DevOS / DataOS）首次全部打通，DevOS 需要完整 12 Agent 部署 + Autonomous Dev Loop 首次跑通，ElectroOS 需要 9 Agent 全部上线。

**关键外部依赖：** Amazon SP-API 尚未申请下来且审核严格。

---

## 2. 决策

### 2.1 Autonomous Dev Loop 架构

| 组件 | 选型 | 说明 |
|------|------|------|
| Loop 主控制器 | `packages/devos-bridge/src/autonomous-loop.ts` | 9 阶段流水线，顺序执行，Stage 05 并行（Backend + Frontend + DB） |
| Task Graph | `packages/devos-bridge/src/task-graph.ts` 自行实现拓扑排序 | 不引入外部依赖（YAGNI；Constitution §7.2） |
| Loop Context | `packages/devos-bridge/src/loop-context.ts` | 每阶段日志写入 `agent_events`；Loop 总结写入 Decision Memory |
| 人工审批节点 | 复用现有 `apps/api` approvals 路由 | Stage 07 唯一审批点；DevOps Agent 在审批通过前不执行任何部署 |
| 失败回滚 | SRE Agent 10min 健康监控 → DevOps Agent 自动回滚 | Stage 09 |

**约束：**
- Loop 首次演练 Ticket 手动创建（分层验证）
- Stage 08 部署只操作 staging 环境；production 严格要求人工审批 token
- QA Agent 覆盖率强制 ≥80%，不足则 `LoopError("coverage_below_80")` 打回

### 2.2 CEO Agent 仲裁协议

新增 `DevOsTicketType = 'coordination'`，与 `bug` / `feature` / `harness_update` / `performance` 平级。

CEO Agent 只读 Ticket → 识别冲突 → 创建 `coordination` 类型 Ticket 通知相关 Agent。不直接调用其他 Agent，天然避免循环依赖。

### 2.3 B2B 租户模型

B2B 租户使用独立 `tenant_id`，与 B2C 完全隔离。复用现有 RLS / 预算 / 审批模型，零架构改动。

B2B Harness（`packages/harness/src/b2b.harness.ts`）实现 `TenantHarness` 接口，支持 EDI 850 采购订单解析 + 3 档阶梯定价。

### 2.4 三层控制台方案

Phase 4 只做 API 层（`/api/v1/console/*`）+ Grafana Dashboard 展示三层状态。Frontend UI 推迟 Phase 5 SaaS 商业化。ClipMart 模板导入通过 CLI（`pnpm clipmart:import`）。

### 2.5 Amazon 联调策略

Amazon SP-API 尚未申请下来且审核严格。Phase 4 全程使用 Sandbox 模式开发联调。S14 压测中 Amazon 降级为 mock。AC-P2-01/02 标记为"外部阻塞 — 降级豁免"。

### 2.6 DG-01 Shopify Inbox 处理

正式降级 — Support Relay 在 Phase 4 保持 webhook-only 模式（接收客户消息事件 → 创建 Ticket → 人工处理）。DG-01 标记为"降级豁免"，Phase 5 SaaS 商业化时作为增值功能完整实现。

---

## 3. 备选方案

| 方案 | 不采用原因 |
|------|------------|
| TaskGraph 引入外部依赖（如 graphlib） | YAGNI；Constitution §7.2 禁止未经评审的新核心依赖 |
| Loop 日志单独建表 | 复用 `agent_events` + Decision Memory 已足够，避免新建存储 |
| CEO Agent 复用 `feature` Ticket 类型 | 语义模糊；不便于 Dashboard 过滤 |
| B2B 用 `sales_channel` 维度 | 需要修改核心数据模型 + RLS + 预算模型，改动量大且风险高 |
| Phase 4 做完整 Frontend | YAGNI；Phase 4 核心是 Loop，UI 留 Phase 5 |
| 等待 Amazon SP-API 审核通过再联调 | 审核时间不可控；Sandbox 模式可验证代码正确性 |

---

## 4. 后果

- DevOS 12 Agent 的月度总预算控制在 $720 以内
- Autonomous Loop 首次完整跑通后，DevOS 开始具备自我演进能力
- Amazon 真实联调推迟到 SP-API 审核通过后（可能 Phase 5）
- Support Relay 能力不完整（webhook-only），Phase 5 补齐
- 三层控制台无 Frontend UI，人工操作依赖 Grafana + CLI + API

---

## 5. 状态

Accepted · 随 Phase 4 实施迭代修订。
