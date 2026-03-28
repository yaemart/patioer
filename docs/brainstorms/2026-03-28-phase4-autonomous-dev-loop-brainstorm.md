---
date: 2026-03-28
topic: phase4-autonomous-dev-loop
---

# Phase 4 · 全链路自动化 + Autonomous Dev Loop 三层全连通

## 当前现状（Phase 1–3 完成度确认 + 遗留清查）

### Phase 3 前提条件核查

| 前提 | 要求 | 实际状态 |
|------|------|---------|
| Phase 3 全部 21 项 AC 通过 | AC-P3-01 ~ AC-P3-21 全部 ✅ | ✅ CONFIRMED |
| DataOS 运行稳定 ≥ 2 周 | Event Lake + Feature Store + Decision Memory | ✅ Sprint 6 完成于 Day 32 |
| Decision Memory ≥ 50 条 outcome 数据 | 最低门槛 | ✅ 实测 **55 条** |
| P1 偏差修复 | 软删除违反 Constitution §5.2 | 🔄 进行中（`002_soft_delete.sql` + TS 变更已在 git working tree） |

> **结论：Phase 3 → Phase 4 转换条件 ≈ 100% 就绪。唯一阻塞项：P1-01 软删除 PR merge 完成后即可正式启动 Phase 4。**

---

### Phase 1–3 遗留问题全量清查

> **重要：Phase 4 启动前必须明确每项遗留的处理策略（修复 / 推迟 / 关闭），避免累积技术债导致 Phase 4 验收失败。**

#### Phase 1 遗留（1 项未结）

| # | 遗留项 | 原始定义 | 流转历史 | 当前状态 | Phase 4 影响 |
|---|--------|---------|---------|---------|-------------|
| **DG-01** | **Shopify Inbox / Support Relay 对接** | `ShopifyHarness.getOpenThreads()` 返回空数组 `[]`；`replyToMessage()` 抛 `HarnessError('not_implemented')` | Phase 1 → 推迟 Phase 3（`dg-01-shopify-inbox-status.md`）→ Phase 3 Sprint 6 未列入任务 → **仍 ⏳** | ⏳ 未结（跨 3 个 Phase） | **高** — Support Relay 是 9 Agent 之一；AC-P4-07（9 Agent 72h 运行）中 Support Relay 能力缺失；CEO Agent 协调 Support Relay 时无真实行为 |

**DG-01 处理决策（须在 S7 确认）：**
- **方案 A（推荐）**：在 S10（CEO + Finance 上线同期）完成 Shopify Inbox GraphQL 对接。若 Shopify Partners 权限仍未批准，切换为 **Shopify Customer GraphQL API** 作为替代。
- **方案 B**：正式降级 — Support Relay 在 Phase 4 保持 webhook-only 模式（接收客户消息事件但不主动回复），AC-P4-07 中 Support Relay 验收标准调整为"事件接收 + Ticket 创建"而非"自动回复"。推迟至 Phase 5 SaaS 商业化时完整实现。

#### Phase 2 遗留（4 项真实联调未结 + 2 项待确认）

**核心问题：4 个平台 Harness 从未经过真实 API 验证。**

| # | 遗留项 | 来源 | 当前状态 | Phase 4 影响 |
|---|--------|------|---------|-------------|
| **AC-P2-01** | **Amazon 真实联调**（非 mock） | Sprint 6 AC 证据索引 | ⏳ 代码已具备，待真实 SP-API 环境验证 | **高** — AC-P4-19（50 租户并发）依赖真实 Harness 链路 |
| **AC-P2-02** | **Amazon 真机更新价并回查** | Sprint 6 AC 证据索引 | ⏳ Price Sentinel → Amazon `updatePrice` 未经真实 API 验证 | **高** — Autonomous Loop 演练若选 Amazon 平台将无法验证 |
| **AC-P2-03** | **TikTok Webhook 外部联调** | Sprint 6 AC 证据索引 | ⏳ Webhook 接收仅通过 mock 测试 | 中 — 不影响 Loop 核心路径，但影响 50 租户压测真实性 |
| **AC-P2-04** | **Shopee SG+MY 真实联调** | Sprint 6 AC 证据索引 | ⏳ 双市场 `getProducts()` 未经真实凭证验证 | 中 — 不影响 Loop 核心路径，但影响合规流水线验收（ID/SG 市场） |
| **Sprint 2 #1** | **汇率 API 真实对接** | Sprint 2 review 准备事项 | ❓ 需确认 `packages/market` currency 模块是用真实 API 还是仍用 mock | 低 — 不阻塞 Phase 4，但影响 Finance Agent P&L 准确性 |
| **Sprint 2 #2** | **Amazon SP-API 审核进度** | Sprint 2 review 准备事项 | ❓ 直接关联 AC-P2-01/02，需确认 Partners 控制台审核状态 | 高 — 阻塞 Amazon 真实联调 |

**四平台联调处理决策（须在 S7 确认）：**
- **分批联调策略**：S7 期间确认各平台 Partners 控制台状态（OAuth scope / API 审核 / Webhook 订阅），S8 安排 **Shopify 先行**（已有最成熟实现），S10 安排 Amazon + TikTok + Shopee（与 9 Agent 72h 运行并行验证）。
- **最低保底线**：若 Amazon SP-API / TikTok / Shopee 审核未通过，S14 压测降级为 **Shopify 单平台 50 租户 + 其余平台 mock 模式**，在 Phase 4 验收文档中注明外部依赖状态。

#### Phase 3 遗留（5 项代码偏差 + 1 项流程缺失）

| # | 遗留项 | 优先级 | 当前状态 | Phase 4 影响 |
|---|--------|-------|---------|-------------|
| **P1-01** | 硬删除违反 Constitution §5.2 | P1 | 🔄 `002_soft_delete.sql` 在 working tree | **阻塞** — Phase 4 启动前必须合并 |
| **P2-01** | DataOS API 无 OpenAPI 3.0 静态文件 | P2 | 🔄 `openapi.yaml` 在 working tree | Harness Agent 需要 API 文档感知能力 |
| **P2-02** | DataOS 端 Prometheus 错误计数器缺失 | P2 | 待处理 | 三层控制台告警中心依赖此指标 |
| **P2-03** | 无正式覆盖率 CI gate（`vitest run --coverage`） | P2 | 待处理 | Autonomous Loop QA Agent 覆盖率强制 ≥80% (AC-P4-02) 依赖 CI gate |
| **P2-04** | Decision Memory `minSimilarity` 默认值过高（0.75） | P2 | 待处理 | 无 OpenAI Key 时 recall 始终返回空，影响所有学习型 Agent |
| **Retro 缺失** | Sprint 6 Retro 未完成（`retro.md` 仍为空模板） | — | 待处理 | 可能遗漏了未识别的技术债或行动项 |

#### 遗留问题汇总

| Phase | 未结项数 | 高影响 | 中影响 | 低影响 |
|-------|---------|--------|--------|--------|
| Phase 1 | 1 | 1（DG-01 Inbox） | 0 | 0 |
| Phase 2 | 6 | 3（Amazon 联调 × 2 + SP-API 审核） | 2（TikTok/Shopee 联调） | 1（汇率 API） |
| Phase 3 | 6 | 1（P1-01 软删除） | 4（P2-01~04） | 1（Retro） |
| **合计** | **13** | **5** | **6** | **2** |

---

### 现有基础设施盘点

#### 已有（直接复用）

| 包 / 模块 | 内容 | Phase 4 关联 |
|-----------|------|-------------|
| `packages/devos-bridge` | Ticket 协议、DevOS Client、SRE Agent bootstrap、Alertmanager 流水线、Harness Update Ticket | DevOS 12 Agent 的通信基础 |
| `packages/harness` | Shopify / Amazon / TikTok / Shopee 4 个 Harness 完整实现（⚠️ 均为 mock 验证，真实联调待完成） | B2B Harness 参照同一 `TenantHarness` 接口 |
| `packages/agent-runtime/src/agents/` | 7 个 ElectroOS Agent：Price Sentinel / Product Scout / Support Relay（⚠️ Inbox stub） / Ads Optimizer / Inventory Guard / Content Writer / Market Intel | 只差 CEO Agent + Finance Agent = 9 Agent 齐备 |
| `packages/dataos` | Event Lake + Feature Store + Decision Memory | Finance Agent 的 P&L 数据源 |
| `apps/api` | Paperclip 审批流（approvals）、Agent Events、agents-execute | Autonomous Loop 的人工审批节点直接复用 |

#### Phase 4 需新建

| 分类 | 需新建内容 |
|------|-----------|
| DevOS 完整 12 Agent | D-01~D-12 Agent 定义 + `devos-full.seed.json` + 扩展 `DEVOS_ENGINEERING_ORG` |
| Autonomous Dev Loop | `autonomous-loop.ts` + `task-graph.ts` + `loop-context.ts` |
| ElectroOS 最后 2 Agent | `finance-agent.agent.ts` + `ceo-agent.agent.ts` |
| B2B Harness | `b2b.harness.ts`（EDI 850 + 阶梯定价） |
| 合规流水线 | `compliance-pipeline.ts` + 禁售品关键词库 |
| 三层控制台 | ClipMart 模板 + Console UI（ElectroOS + DevOS + DataOS 状态面板 + 审批中心） |

---

## What We're Building

Phase 4 目标是将 Phase 1–3 分别建设的 ElectroOS / DevOS / DataOS **三层骨架首次全部打通**，实现：

1. **DevOS 完整 12 Agent 部署**：在 Phase 2 已有 SRE Agent 基础上，补齐剩余 11 个（CTO / PM / Architect / Backend / Frontend / DB / Harness / QA / Security / DevOps / Codebase Intel）。

2. **Autonomous Dev Loop**：DevOS 收到 Ticket → 自主完成 PM分析 → 架构设计 → TaskGraph → 并行编码 → 测试+安全 → 唯一人工审批节点 → DevOps 部署 → SRE 监控。**整个过程只有"生产部署"一个人工审批节点**。

3. **ElectroOS 9 Agent 齐备**：新增 CEO Agent（每日 08:00 跨 Agent 协调）+ Finance Agent（每月 1 日 P&L 报告）。

4. **B2B Portal 层**：自建企业采购 Harness（EDI 850 + 阶梯定价），B2B 专属 Agent 配置。

5. **多市场合规自动化**：SG/ID/DE/US 禁售品检测 + 品类认证要求 + AI 内容审核流水线。

6. **三层互联控制台 + ClipMart 模板**：一个审批中心 + 一键导入新租户（30 分钟内完整 9-Agent 运营团队）。

7. **压测与容灾验证**：50 租户并发 24h + 单层容灾 + 全 25 项验收通过 → 进入 Phase 5。

---

## 方案分析

### 方案 A（推荐）：Sprint 化 8 个双周迭代，含遗留修复窗口

**每个 Sprint = 2 周，8 Sprint = 16 周（Month 9–12）**

> 与 PDF 时间轴对齐，但在 S7/S8/S10 中嵌入遗留修复任务（标记为 🔧），确保 Phase 1–3 技术债不带入 Phase 4 验收。

| Sprint | 周 | 核心交付 | 遗留修复（🔧） | 验收锚点 |
|--------|---|---------|--------------|---------|
| **S7** | W1–2 | DevOS 12 Agent 全部部署 + devos-full.seed.json | 🔧 P1-01 软删除合并；🔧 P2-01~P2-04 全部修复；🔧 Sprint 6 Retro 补完；🔧 确认 4 平台 Partners 控制台状态（SP-API/TikTok/Shopee/Shopify Inbox OAuth scope）；🔧 DG-01 处理方案决策 | 12 Agent ACTIVE + P1/P2 全部清零 + 平台联调阻塞状态明确 |
| **S8** | W3–4 | Autonomous Loop 框架（9 阶段流水线 + TaskGraph） | 🔧 **Shopify 真实联调**（最成熟平台先行）：真实 OAuth → getProducts → updatePrice 全链路；🔧 覆盖率 CI gate 就位（AC-P4-02 前提） | Loop 单元测试 100% + E2E stub 通过 + Shopify 真实 API 验证 ✅ |
| **S9** | W5–6 | Loop 首次演练（真实 Ticket: Price Sentinel 品类阈值） | — | Stage 01~09 全程日志 + 人工审批节点验证 |
| **S10** | W7–8 | Finance Agent + CEO Agent 上线 | 🔧 **Amazon + TikTok + Shopee 真实联调**（AC-P2-01~04 关闭）；🔧 DG-01 Shopify Inbox 对接（或正式降级）；🔧 汇率 API 真实对接确认 | 9 Agent 72h 运行 + CEO 仲裁 + **4 平台全部真实联调 ✅** |
| **S11** | W9–10 | B2B Portal Harness + EDI 对接框架 | — | getProducts / updatePrice / receiveEDIOrder 三接口 |
| **S12** | W11–12 | 合规自动化流水线（SG/ID/DE/US） | — | ID 市场清真认证检测 + 禁售品拦截 |
| **S13** | W13–14 | ClipMart 模板 + 三层控制台 + 审批中心 | — | 新租户 30 分钟内 9-Agent 就绪 |
| **S14** | W15–16 | 50 租户压测 + 单层容灾 + 全 25 项 AC | 🔧 最终遗留确认：Phase 1–3 全部 ⏳ 项已关闭或有正式豁免文档 | Phase 5 GO 决策 |

**遗留修复分布逻辑：**
- **S7**：集中修复所有代码级偏差（P1/P2），补完 Retro，确认外部依赖阻塞状态 — 为后续 Sprint 扫清内部障碍。
- **S8**：Shopify 先行联调 — 风险最低、代码最成熟，验证真实 API 链路的完整模式，为其余 3 平台提供联调模板。
- **S10**：剩余 3 平台集中联调 + DG-01 闭环 — 与 9 Agent 72h 运行（AC-P4-07）合并验证，一次性覆盖所有 Harness 真实性。
- **S14**：最终遗留审计 — 确保没有 ⏳ 项带入 Phase 5。

**优点：** 遗留修复嵌入主线，不额外占 Sprint；关键外部依赖（平台 API 审核）在 S7 就暴露，留足 buffer。  
**风险：** S10 同时完成 3 平台联调 + CEO/Finance 上线，工作量高。若任一平台审核未通过需提前启动 Plan B。

### 方案 B：先完成 ElectroOS 侧（9 Agent），再完成 DevOS 侧（12 Agent + Loop）

**优点：** ElectroOS 测试数据更早积累，Loop 演练时有更丰富的真实 Ticket。  
**缺点：** 违背 PDF 的时间轴顺序（PDF W1-2 是 DevOS 12 Agent 先行），Loop 依赖完整的 DevOS 团队。  
**不推荐**。

---

## Key Decisions

| 决策 | 结论 | 依据 |
|------|------|------|
| **Loop 存储介质** | Autonomous Loop 的每个阶段日志写入 `agent_events`（ElectroOS PG）+ Loop summary 写入 Decision Memory | 复用现有可观测性基础设施，避免新建存储 |
| **TaskGraph 实现** | 自行实现简单拓扑排序（Package `packages/devos-bridge/src/task-graph.ts`），不引入外部依赖 | YAGNI；Constitution §7.2 禁止引入未经评审的核心依赖 |
| **B2B Harness 位置** | `packages/harness/src/b2b.harness.ts`，与 Shopify/Amazon 平级 | 遵循现有 Harness 模块边界 |
| **Finance Agent 数据源** | ClickHouse Event Lake（`electroos_events.price_events` + 通用 `events`） | DataOS 已在 Phase 3 部署，Finance Agent 是其第一个消费型 Agent |
| **CEO Agent 仲裁机制** | CEO Agent 读取所有 Agent 的 Paperclip Ticket，识别冲突后创建协调 Ticket 通知相关 Agent | 无需修改 Agent 内部代码；通过 Ticket 协议解耦 |
| **合规流水线触发点** | Product Scout 上架前自动调用 `CompliancePipeline.check()`，不通过单独新增强制步骤 | 最小化改动，复用现有上架流程 |
| **三层控制台技术方案** | 扩展现有 `apps/api` 新增 `/api/v1/console/*` 路由 + 若已有 Next.js frontend 则新增 `/console` 页面 | 避免新建独立 App |
| **ClipMart 模板格式** | JSON 配置文件 + CLI 脚本（`pnpm clipmart:import`），不做 UI 向导（Phase 5） | YAGNI；UI 向导是 Phase 5 SaaS 商业化内容 |
| **devos-full.seed.json 存放** | `harness-config/devos-full.seed.json`（与 PDF 完全一致） | PDF §01 明确路径 |

---

## 详细目录结构变更（Phase 4 增量）

```
patioer/
├── packages/
│   ├── devos-bridge/
│   │   └── src/
│   │       ├── devos-org-chart.ts          # EXTEND: SRE → 12 Agent 完整组织树
│   │       ├── autonomous-loop.ts          # NEW: AutonomousDevLoop 主控制器（9 阶段）
│   │       ├── loop-context.ts             # NEW: LoopContext（阶段日志 + 审计）
│   │       ├── task-graph.ts               # NEW: TaskGraph + topologicalSort
│   │       ├── devos-full-seed.ts          # NEW: Phase 4 完整 12-Agent 种子数据
│   │       └── index.ts                    # EXTEND: 导出新模块
│   ├── harness/
│   │   └── src/
│   │       ├── b2b.harness.ts              # NEW: B2BHarness（EDI 850 + 阶梯定价）
│   │       ├── b2b.types.ts                # NEW: B2B 类型定义
│   │       └── index.ts                    # EXTEND: 导出 B2BHarness
│   └── agent-runtime/
│       └── src/
│           ├── agents/
│           │   ├── finance-agent.agent.ts  # NEW: E-09 Finance Agent（每月 1 日）
│           │   ├── finance-agent.agent.test.ts
│           │   ├── ceo-agent.agent.ts      # NEW: E-01 CEO Agent（每日 08:00）
│           │   └── ceo-agent.agent.test.ts
│           └── compliance/
│               ├── compliance-pipeline.ts  # NEW: CompliancePipeline（5 项检测）
│               ├── compliance-pipeline.test.ts
│               └── prohibited-keywords.ts  # NEW: 禁售品关键词库（SG/ID/DE/US）
├── apps/
│   └── api/
│       └── src/
│           └── routes/
│               └── console.ts              # NEW: /api/v1/console/* 三层状态 API
├── harness-config/
│   ├── devos-full.seed.json                # NEW: DevOS 12 Agent 完整种子（PDF §01）
│   └── clipmart-template.json              # NEW: ClipMart 标准跨境电商模板
├── docs/
│   ├── plans/
│   │   └── phase4-plan.md                  # NEW: Phase 4 详细实施计划
│   └── adr/
│       └── 0004-phase4-autonomous-loop.md  # NEW: ADR-0004 Autonomous Loop 架构决策
└── packages/dataos/
    └── migrations/
        └── 002_soft_delete.sql             # 🔄 已在 working tree（P1-01 fix）
```

---

## Phase 4 验收清单（25 项 AC）

### Autonomous Dev Loop（6 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-01 | Loop 首次完整跑通：从 Ticket 创建到代码部署，全程每个阶段有耗时日志 | S9 |
| AC-P4-02 | QA Agent 覆盖率强制 ≥80%：覆盖率不足时 Loop 自动打回（LoopError） | S8 |
| AC-P4-03 | Security Agent：至少发现并修复 1 个测试 Ticket 中的安全问题 | S9 |
| AC-P4-04 | 人工审批节点：DevOps Agent 在收到审批前不执行任何部署 | S8 |
| AC-P4-05 | Loop 失败回滚：SRE 检测到健康异常后 DevOps 自动回滚 | S9 |
| AC-P4-06 | Harness Agent：模拟 Shopify API 版本升级，48h 内自动提交 PR | S7 |

### ElectroOS 9 Agent 全量（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-07 | 9 个 Agent 同时运行 72h，心跳连续，无 crash，无预算异常 | S10 |
| AC-P4-08 | CEO Agent 每日 08:00 生成协调报告 Ticket，内容非空 | S10 |
| AC-P4-09 | Finance Agent 生成首份月度 P&L 报告，数据与 ClickHouse 统计一致 | S10 |
| AC-P4-10 | CEO Agent 仲裁：Ads Optimizer 与 Inventory Guard 冲突时正确协调 | S10 |

### DevOS 12 Agent（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-11 | DevOS 12 Agent 全部上线，Paperclip Dashboard 全部显示 ACTIVE | S7 |
| AC-P4-12 | Codebase Intel：能正确回答"Price Sentinel 在哪个文件""调用了哪些 Harness 方法" | S7 |
| AC-P4-13 | DB Agent：Loop 中自动生成 Migration 文件，格式符合规范，无手写 SQL | S9 |
| AC-P4-14 | DevOS 月度总预算控制在 $720 以内（12 Agent 合计） | S14 |

### B2B Portal & 合规（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-15 | B2B Harness：getProducts / updatePrice / receiveEDIOrder 均正常 | S11 |
| AC-P4-16 | B2B 阶梯定价：updatePrice 能正确更新 3 档阶梯价格（1件/10件/100件） | S11 |
| AC-P4-17 | 合规流水线：上架测试商品到 ID 市场，系统正确检测"需要清真认证" | S12 |
| AC-P4-18 | 禁售品检测：含禁售关键词商品被自动拦截并创建合规 Ticket | S12 |

### 压测 & 容灾（5 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-19 | 50 租户并发运行 24h：所有 Agent 心跳正常，DB 连接池 < 80% | S14 |
| AC-P4-20 | 单层容灾：停止 DataOS 容器，ElectroOS Agent 自动降级（无记忆模式） | S14 |
| AC-P4-21 | 单层容灾：停止 DevOS 容器，ElectroOS 正常运行不受影响 | S14 |
| AC-P4-22 | ClickHouse 压测：每秒写入 1000 条事件，查询延迟 < 500ms | S14 |
| AC-P4-23 | 三层互联 Dashboard 正常展示所有状态，告警中心可接收 P0 告警 | S13 |

### ClipMart（2 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-24 | ClipMart 模板导入：新租户在 30 分钟内拥有完整 9-Agent 运营团队 | S13 |
| AC-P4-25 | 全部 AC 通过 → Phase 5 GO 决策 | S14 |

### 遗留清零（新增 3 项 — Phase 1–3 技术债闭环）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P4-26 | Phase 3 代码偏差 P1-01 + P2-01~04 全部合并，对齐报告状态更新为 ✅ | S7 |
| AC-P4-27 | 至少 1 个非 Shopify 平台完成真实 API 联调（Amazon 或 TikTok 或 Shopee），关闭对应 AC-P2-0x | S10 |
| AC-P4-28 | DG-01 Shopify Inbox 状态明确关闭：真实对接完成 ✅ 或正式降级豁免文档签字 | S10 |

> **验收总数：25 项（PDF 原始）+ 3 项（遗留清零）= 28 项。全部通过 → Phase 5 GO。**

---

## 关键风险与缓解

### 新增风险（Phase 1–3 遗留引入）

| 风险 | 概率 | 影响 | 缓解方案 | 关联遗留 |
|------|------|------|---------|---------|
| **Amazon SP-API 审核仍未通过** | 中 | 高 | S7 第 1 天确认状态；若仍未通过，S8 启动备用 Amazon SP-API sandbox 模式联调，S14 压测降级为 Shopify 单平台真实 + 其余 mock | AC-P2-01/02 |
| **Shopify Inbox 权限未获批** | 中 | 中 | S7 DG-01 决策会议：批准则 S10 对接；未批准则正式降级 Support Relay 为 webhook-only 模式，调整 AC-P4-07 验收标准 | DG-01 |
| **S10 工作量过载**（3 平台联调 + 2 Agent 上线） | 中 | 中 | 若 S8 Shopify 联调顺利且模式可复用，S10 联调工作量可控；否则将 TikTok/Shopee 联调推迟至 S11 并行 | AC-P2-03/04 |
| **Sprint 6 Retro 遗漏未识别技术债** | 低 | 中 | S7 补完 Retro，产出行动项纳入 S7–S8 修复窗口 | Retro 缺失 |

### 原有风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| DevOS 自动部署沙箱隔离不足 | 中 | 高 | Autonomous Loop 的 Stage 08 部署只操作 staging 环境；production 部署严格要求人工审批 token |
| CEO Agent 跨 Agent 协调循环依赖 | 中 | 中 | CEO Agent 只读 Ticket，通过创建新协调 Ticket 通知（不直接调用其他 Agent），天然无循环 |
| B2B EDI 格式差异（850/855/856）| 低 | 中 | Phase 4 只实现 EDI 850（采购订单），855/856 推迟到 Phase 5 |
| 50 租户并发 DB 连接耗尽 | 中 | 高 | 提前配置 PgBouncer 连接池；压测前设置 `max_connections` 基准 |
| Codebase Intel 上下文窗口超限 | 低 | 低 | 使用 chunk + 向量检索方案，而非全量代码上下文 |

---

## 前置修复项（Sprint 7 窗口内必须完成）

### S7 Day 1：阻塞项（Phase 4 启动 gate）

| # | 来源 | 修复 | 文件 | 状态 |
|---|------|------|------|------|
| P1-01 | Phase 3 | 软删除：`decision_memory.ts` + `feature_store.ts` DELETE → UPDATE SET deleted_at | `packages/dataos/migrations/002_soft_delete.sql` + TS 文件 | 🔄 进行中 |

### S7 Day 1–3：代码级偏差清零

| # | 来源 | 修复 | 文件 | 状态 |
|---|------|------|------|------|
| P2-01 | Phase 3 | OpenAPI 3.0 静态文件 | `apps/dataos-api/openapi.yaml` | 🔄 进行中 |
| P2-02 | Phase 3 | DataOS 端 Prometheus 错误计数器 `dataos_port_errors_total` | `apps/dataos-api/src/metrics.ts` | 待处理 |
| P2-03 | Phase 3 | 覆盖率 CI gate（`vitest run --coverage`） | `packages/dataos/package.json` + CI yaml | 待处理 |
| P2-04 | Phase 3 | Decision Memory `minSimilarity` 默认值（0.75 → 0.01 for deterministic mode） | `packages/dataos/src/decision-memory.ts` | 待处理 |

### S7 Day 1–3：流程 + 外部依赖确认

| # | 来源 | 行动 | 产出 |
|---|------|------|------|
| Retro | Phase 3 | 补完 Sprint 6 Retro（`docs/ops/sprint6/retro.md`） | 行动项列表，若有新增技术债纳入 S7–S8 |
| DG-01 决策 | Phase 1 | 确认 Shopify Partners 控制台 Inbox API 权限状态 → 选择方案 A（对接）或方案 B（降级） | 决策记录写入 `dg-01-shopify-inbox-status.md` |
| 平台状态 | Phase 2 | 确认 Amazon SP-API 审核、TikTok HMAC scope、Shopee App 审核状态 | 各平台联调可行性评估 → 决定 S8/S10 联调范围 |
| 汇率 API | Phase 2 | 确认 `packages/market` currency 模块是 mock 还是真实 API | 若 mock → S10 切换真实 API |

### S8：Shopify 先行联调

| # | 来源 | 行动 | 验收 |
|---|------|------|------|
| AC-P2-Shopify | Phase 2 | Shopify 真实 OAuth → getProducts → updatePrice 全链路验证 | 真实商品数据返回 + 价格更新可回查 |

### S10：剩余平台联调 + DG-01 闭环

| # | 来源 | 行动 | 验收 |
|---|------|------|------|
| AC-P2-01 | Phase 2 | Amazon SP-API 真实联调（或 sandbox 降级） | getProducts + updatePrice 真实 API ✅（或降级文档） |
| AC-P2-02 | Phase 2 | Amazon 真机更新价回查 | Price Sentinel → Amazon 价格变更可查 |
| AC-P2-03 | Phase 2 | TikTok Webhook 外部联调 | 真实 ORDER_STATUS_CHANGE 事件接收 |
| AC-P2-04 | Phase 2 | Shopee SG+MY 真实联调 | 双市场 getProducts 真实数据返回 |
| DG-01 | Phase 1 | Shopify Inbox 对接 or 正式降级 | replyToMessage 真实回复 or 降级文档签字 |

---

## Open Questions — 决策记录（2026-03-28 确认）

| # | 问题 | 决策 | 依据 |
|---|------|------|------|
| Q1 | Loop 首次演练 Ticket 来源 | **手动创建** | 分层验证：首次演练聚焦 Loop 9 阶段本身；第二轮演练再切换自动上报验证端到端链路 |
| Q2 | CEO Agent 仲裁 Ticket 类型 | **新增 `DevOsTicketType = 'coordination'`** | 改动极小（`ticket-protocol.ts` + Set）；语义清晰，便于 Dashboard 过滤和审计链路可读性 |
| Q3 | 三层控制台 Frontend | **Phase 4 只做 API 层 + Grafana Dashboard**；Frontend 推迟 Phase 5 | YAGNI — Phase 4 核心是 Loop 不是 UI；Grafana + API JSON 端点满足验收；Phase 5 SaaS 时用 Next.js 一步到位 |
| Q4 | B2B 租户模型 | **独立 `tenant_id`** | 零架构改动；完全复用现有 RLS / 预算 / 审批模型；"商品库同步"问题留 Phase 5 通过"租户关联"解决 |
| Q5 | Amazon SP-API 审核状态 | **尚未申请下来，审核很严格** | S7 Day 1 启动申请；Phase 4 全程使用 Sandbox 模式；S14 压测 Amazon 降级为 mock；AC-P2-01/02 标记为"外部阻塞—降级豁免" |
| Q6 | Support Relay 降级可接受性 | **接受降级为 webhook-only 模式** | DG-01 正式关闭（降级豁免）；webhook-only 满足 Constitution §5.4 "退款/投诉转人工" 定义；Phase 5 SaaS 时作为增值功能完整实现 |

---

## Next Steps

→ **立即（S7 启动前）**：
  1. 合并 P1-01 软删除 PR → 正式标记 Phase 3 完成
  2. 补完 Sprint 6 Retro → 产出行动项
  3. 确认 4 平台 Partners 控制台状态 + Shopify Inbox 权限

→ **S7 第 1 天**：
  1. P2-01~P2-04 代码偏差集中修复
  2. DG-01 处理方案决策会议
  3. 开始 DevOS 12 Agent 部署

→ **创建 ADR-0004**：记录 Autonomous Dev Loop 核心架构决策（TaskGraph 实现、Loop 审计存储、Stage 超时策略）

→ **生成 phase4-plan.md**：将本头脑风暴转化为带每日任务粒度的完整实施计划（含遗留修复嵌入时间轴）
