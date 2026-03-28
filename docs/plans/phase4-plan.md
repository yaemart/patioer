# Phase 4 实施计划 · 全链路自动化 + Autonomous Dev Loop 三层全连通

**周期：** 16 周（Month 9–12）  
**目标：** DevOS 完整 12 Agent 部署；Autonomous Dev Loop 首次完整跑通；ElectroOS 9 Agent 全部上线；B2B Portal；合规自动化；三层控制台 API；50 租户并发压测  
**验收：** 28 项（见 §9 — 25 项 PDF 原始 + 3 项遗留清零）  
**前提：** Phase 3 全部 21 项 AC 通过；DataOS 运行稳定 ≥ 2 周；Decision Memory ≥ 50 条 outcome 数据  
**不做：** SaaS 商业化（Phase 5）；完全无人工审批（保留生产部署审批门）；Frontend UI（Phase 5）

> 术语约定：**Loop** = Autonomous Dev Loop；**S7–S14** = Sprint 7–14（延续 Phase 1–3 编号）。

---

## 0. 架构决策（Phase 4 前提）

### 0.1 继承自 Phase 1–3 的决策

| # | 决策 | 结论 | 来源 |
|---|------|------|------|
| D1 | 仓库策略 | **独立 Monorepo**（`patioer/`）；Paperclip 并排服务 | ADR-0001 |
| D2 | Web 框架 | ElectroOS **Fastify**；Paperclip Express | Constitution Ch3.1 |
| D3 | ORM | **Drizzle ORM**；不侵入 Paperclip schema | Constitution Ch3.1 |
| D4 | Event 存储 | ClickHouse **Event Lake** + PG `agent_events` 审计 | ADR-0003 |
| D13 | DataOS 技术栈 | ClickHouse 24+ · pgvector:pg16 · Redis | ADR-0003 |
| D14 | DataOS 部署 | 独立 Compose 栈；PG `5434`；API `3300` | ADR-0003 |
| D15 | DataOS ↔ ElectroOS 通信 | HTTP internal API + BullMQ | ADR-0003 |

### 0.2 Phase 4 新增决策

| # | 决策 | 结论 | ADR |
|---|------|------|-----|
| D19 | Autonomous Loop 架构 | 9 阶段流水线；TaskGraph 自行实现拓扑排序；Loop 日志写入 `agent_events` + Decision Memory | ADR-0004 |
| D20 | CEO Agent 协调协议 | 新增 `DevOsTicketType = 'coordination'`；CEO 只读 Ticket → 创建协调 Ticket；不直接调用其他 Agent | ADR-0004 |
| D21 | B2B 租户模型 | **独立 `tenant_id`**；零架构改动；完全复用 RLS / 预算 / 审批 | ADR-0004 |
| D22 | 三层控制台 | Phase 4 只做 API 层 + Grafana Dashboard；Frontend 推迟 Phase 5 | ADR-0004 |
| D23 | Amazon 联调策略 | SP-API 尚未申请；Phase 4 全程 Sandbox；S14 压测 Amazon 降级 mock | ADR-0004 |
| D24 | DG-01 Shopify Inbox | 正式降级为 webhook-only 模式；Phase 5 增值功能完整实现 | ADR-0004 |
| D25 | Loop 首次演练 Ticket | 手动创建（分层验证）；第二轮切换自动上报 | ADR-0004 |

### 关键约束回顾（Constitution 硬门槛 — 延续 Phase 1–3）

- Agent **绝不**直调平台 SDK → 必须经 Harness
- 所有核心表 **tenant_id + RLS**
- 价格变动 **>15%** 须人工审批
- 广告日预算 **>$500** 须人工审批
- 所有 Agent 操作写入**不可变审计日志**
- 测试覆盖率 **≥ 80%**
- 删除操作必须**软删除**（Phase 3 P1-01 修复后强制）

---

## 1. Monorepo 目录结构变更（Phase 4 增量）

```
patioer/
├── packages/
│   ├── devos-bridge/
│   │   └── src/
│   │       ├── devos-org-chart.ts          # EXTEND: SRE → 12 Agent 完整组织树
│   │       ├── ticket-protocol.ts          # EXTEND: +coordination 类型
│   │       ├── autonomous-loop.ts          # NEW: AutonomousDevLoop 主控制器（9 阶段）
│   │       ├── loop-context.ts             # NEW: LoopContext（阶段日志 + 审计）
│   │       ├── loop-error.ts               # NEW: LoopError 结构化错误
│   │       ├── task-graph.ts               # NEW: TaskGraph + topologicalSort
│   │       ├── devos-full-seed.ts          # NEW: Phase 4 完整 12-Agent 种子数据
│   │       └── index.ts                    # EXTEND: 导出新模块
│   ├── harness/
│   │   └── src/
│   │       ├── b2b.harness.ts              # NEW: B2BHarness（EDI 850 + 阶梯定价）
│   │       ├── b2b.harness.test.ts         # NEW
│   │       ├── b2b.types.ts                # NEW: B2B 类型定义（EDI / 阶梯价）
│   │       └── index.ts                    # EXTEND: 导出 B2BHarness
│   ├── agent-runtime/
│   │   └── src/
│   │       ├── agents/
│   │       │   ├── finance-agent.agent.ts      # NEW: E-09 Finance Agent
│   │       │   ├── finance-agent.agent.test.ts
│   │       │   ├── ceo-agent.agent.ts          # NEW: E-01 CEO Agent
│   │       │   └── ceo-agent.agent.test.ts
│   │       └── compliance/
│   │           ├── compliance-pipeline.ts      # NEW: CompliancePipeline
│   │           ├── compliance-pipeline.test.ts
│   │           └── prohibited-keywords.ts      # NEW: 禁售品关键词库
│   └── dataos/
│       └── migrations/
│           └── 002_soft_delete.sql             # 🔄 P1-01 修复（S7 Day 1 合并）
├── apps/
│   └── api/
│       └── src/
│           └── routes/
│               └── console.ts                  # NEW: /api/v1/console/* 三层状态 API
├── harness-config/
│   ├── devos-full.seed.json                    # NEW: DevOS 12 Agent 完整种子
│   └── clipmart-template.json                  # NEW: ClipMart 标准跨境电商模板
└── docs/
    ├── plans/
    │   └── phase4-plan.md                      # 本文件
    └── adr/
        └── 0004-phase4-autonomous-loop.md      # NEW: ADR-0004
```

---

## 2. Phase 1–3 遗留修复计划（嵌入 Sprint 时间轴）

> Phase 4 不允许任何遗留项以 ⏳ 状态带入 Phase 5。全部遗留在 S7–S10 窗口内修复或签署正式豁免。

### S7 Day 1 阻塞项

| # | 来源 | 修复 | 文件 |
|---|------|------|------|
| P1-01 | Phase 3 | 软删除 migration 合并 | `packages/dataos/migrations/002_soft_delete.sql` + TS |

### S7 Day 1–3 代码偏差清零

| # | 来源 | 修复 | 文件 |
|---|------|------|------|
| P2-01 | Phase 3 | DataOS OpenAPI 3.0 | `apps/dataos-api/openapi.yaml` |
| P2-02 | Phase 3 | Prometheus 错误计数器 `dataos_port_errors_total` | `apps/dataos-api/src/metrics.ts` |
| P2-03 | Phase 3 | 覆盖率 CI gate | `packages/dataos/package.json` + CI yaml |
| P2-04 | Phase 3 | `minSimilarity` 默认值修复 | `packages/dataos/src/decision-memory.ts` |

### S7 Day 1–3 流程 + 外部依赖

| # | 来源 | 行动 | 产出 |
|---|------|------|------|
| Retro | Phase 3 | 补完 Sprint 6 Retro | 行动项列表 → 纳入 S7–S8 |
| DG-01 | Phase 1 | 确认 Inbox 权限 → **正式降级为 webhook-only** | 豁免文档签字 |
| 平台状态 | Phase 2 | 确认 Amazon/TikTok/Shopee 控制台状态 | 联调可行性评估 |
| SP-API | Phase 2 | **启动 Amazon SP-API 申请**（若尚未启动） | 申请确认截图 |

### S8 Shopify 先行联调

| # | 来源 | 行动 | 验收 |
|---|------|------|------|
| Shopify | Phase 2 | 真实 OAuth → getProducts → updatePrice 全链路 | Shopify 真实 API 验证 ✅ |

### S10 剩余平台联调

| # | 来源 | 行动 | 验收 |
|---|------|------|------|
| AC-P2-01/02 | Phase 2 | Amazon Sandbox 联调（SP-API 未通过则降级豁免） | Sandbox ✅ or 豁免文档 |
| AC-P2-03 | Phase 2 | TikTok Webhook 联调（真实或 mock 降级） | 联调 ✅ or 豁免 |
| AC-P2-04 | Phase 2 | Shopee SG+MY 联调（真实或 mock 降级） | 联调 ✅ or 豁免 |

---

## 3. 八 Sprint 分解（16 周）

### Sprint 7 · Week 1–2 — 遗留清零 + DevOS 12 Agent 完整部署

**交付物：** P1/P2 全部修复合并 · Sprint 6 Retro 补完 · DG-01 正式降级 · SP-API 申请启动 · DevOS 12 Agent 全部 ACTIVE · `devos-full.seed.json` · 完整组织树

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 7.1 | **P1-01 合并**：`002_soft_delete.sql` + TS 软删除逻辑 merge | `packages/dataos/` | — | 0.5d |
| 7.2 | **P2-01**：DataOS OpenAPI 3.0 静态文件确认/完善 | `apps/dataos-api/openapi.yaml` | — | 0.5d |
| 7.3 | **P2-02**：`dataos_port_errors_total` Prometheus 计数器 | `apps/dataos-api/src/metrics.ts` | — | 0.5d |
| 7.4 | **P2-03**：覆盖率 CI gate（`vitest run --coverage`） | `packages/dataos/package.json` + CI | — | 0.5d |
| 7.5 | **P2-04**：`minSimilarity` 默认值按 embedding 模式区分 | `packages/dataos/src/decision-memory.ts` | — | 0.5d |
| 7.6 | **Sprint 6 Retro** 补完 | `docs/ops/sprint6/retro.md` | — | 0.5d |
| 7.7 | **DG-01 降级签字**：更新 `dg-01-shopify-inbox-status.md` 为正式降级豁免 | `docs/plans/` | — | 0.5d |
| 7.8 | **SP-API 申请**：启动 Amazon SP-API 开发者资质申请 | 外部操作 | — | 0.5d |
| 7.9 | **4 平台状态确认**：TikTok/Shopee/Shopify Inbox 控制台状态 | 外部操作 | — | 0.5d |
| 7.10 | `ticket-protocol.ts` 扩展：新增 `'coordination'` 类型 | `packages/devos-bridge/` | — | 0.5d |
| 7.11 | `devos-org-chart.ts` 扩展：SRE → 12 Agent 完整组织树 | `packages/devos-bridge/` | 7.10 | 1d |
| 7.12 | `devos-full-seed.ts`：12 Agent 种子数据（PDF §01 对齐） | `packages/devos-bridge/` | 7.11 | 1d |
| 7.13 | `harness-config/devos-full.seed.json`：JSON 种子文件 | `harness-config/` | 7.12 | 0.5d |
| 7.14 | DevOS Paperclip 实例配置：12 Agent 注册 + heartbeat 配置 | `paperclip/` + 外部操作 | 7.13 | 1d |
| 7.15 | DevOS 12 Agent 冒烟验证：Paperclip Dashboard 全部 ACTIVE | 验证 | 7.14 | 0.5d |
| 7.16 | Sprint 7 全量 typecheck + 测试回归 | all | 7.1–7.15 | 0.5d |

**Sprint 7 验收：**
- [ ] P1-01 + P2-01~04 全部合并，对齐报告状态更新为 ✅（**AC-P4-26**）
- [ ] Sprint 6 Retro 完成，行动项已录入
- [ ] DG-01 降级豁免文档已签字
- [ ] Amazon SP-API 申请已提交
- [ ] `DevOsTicketType` 包含 `'coordination'`
- [ ] DevOS 12 Agent 全部 ACTIVE（**AC-P4-11**）
- [ ] Codebase Intel 可回答"Price Sentinel 在哪个文件"（**AC-P4-12**）
- [ ] CI pipeline 通过

---

#### Sprint 7 · Day-by-Day 实施细节

##### Day 1 — 遗留清零（代码偏差 + 流程）

> **🃏 CARD-D1-01 · P1-01 软删除合并**
>
> **类型：** 代码合并  
> **耗时：** 1h  
> **优先级：** 🔴 Phase 4 启动 gate — 必须第一个完成
>
> **操作：**
> 1. 确认 `002_soft_delete.sql` + `decision-memory.ts` + `feature-store.ts` 变更在 working tree
> 2. 运行 `pnpm test` 确认全部通过
> 3. 运行 `pnpm exec tsx scripts/dataos-migrate.ts` 应用 migration
> 4. 验证：`SELECT column_name FROM information_schema.columns WHERE table_name='decision_memory' AND column_name='deleted_at'` 返回一行
> 5. 提交 PR → merge
>
> **验收：** `DELETE` 语句全部替换为 `UPDATE SET deleted_at = NOW()`；查询加 `WHERE deleted_at IS NULL`

---

> **🃏 CARD-D1-02 · P2-01~P2-04 代码偏差集中修复**
>
> **类型：** 代码变更（4 项打包）  
> **耗时：** 3h
>
> | 偏差 | 文件 | 修复动作 |
> |------|------|---------|
> | P2-01 | `apps/dataos-api/openapi.yaml` | 确认文件已存在（在 working tree），补齐缺失路由描述 |
> | P2-02 | `apps/dataos-api/src/metrics.ts` | 新增 `dataos_port_errors_total` Counter，按 `op` label 区分 |
> | P2-03 | `packages/dataos/package.json` | 添加 `"test:coverage": "vitest run --coverage --coverage.thresholds.lines=80"` |
> | P2-04 | `packages/dataos/src/decision-memory.ts` | `recall()` 中按 embedding 模式区分 minSimilarity（deterministic=0.01, OpenAI=0.75） |
>
> **验收：** `pnpm test && pnpm -F @patioer/dataos test:coverage` 全部通过

---

> **🃏 CARD-D1-03 · Sprint 6 Retro 补完 + DG-01 降级 + 平台状态确认**
>
> **类型：** 文档 + 外部操作  
> **耗时：** 2h
>
> 1. 补完 `docs/ops/sprint6/retro.md`：回顾 Sprint 6 成果（21 AC 全通过），记录 Keep/Improve/行动项
> 2. 更新 `docs/plans/dg-01-shopify-inbox-status.md`：状态改为"Phase 4 正式降级 — webhook-only 模式"，记录决策理由（ADR-0004 D24）
> 3. 登录 Amazon / TikTok / Shopee 开发者控制台，确认各平台 App 审核状态
> 4. 启动 Amazon SP-API 申请（若尚未启动）
>
> **产出：** Retro 完成 · DG-01 关闭 · 平台状态已知

---

##### Day 2 — ticket-protocol 扩展 + DevOS 组织树

> **🃏 CARD-D2-01 · `ticket-protocol.ts` 新增 `'coordination'` 类型**
>
> **类型：** 代码变更  
> **耗时：** 1h  
> **目标文件：** `packages/devos-bridge/src/ticket-protocol.ts`
>
> **变更：**
> ```typescript
> // 现有
> export type DevOsTicketType = 'bug' | 'feature' | 'harness_update' | 'performance'
> // 改为
> export type DevOsTicketType = 'bug' | 'feature' | 'harness_update' | 'performance' | 'coordination'
> ```
> 同时更新 `TICKET_TYPES` Set 和 `defaultSlaForPriority`（coordination 默认 P2 SLA）。
>
> **验收：** `isDevOsTicket({ type: 'coordination', ... })` 返回 `true`；现有测试全部通过

---

> **🃏 CARD-D2-02 · `devos-org-chart.ts` 扩展为完整 12 Agent 组织树**
>
> **类型：** 代码变更  
> **耗时：** 2h  
> **目标文件：** `packages/devos-bridge/src/devos-org-chart.ts`
>
> **结构（与 PDF §01 对齐）：**
> ```
> Engineering (org)
> ├── Leadership (team)
> │   └── CTO Agent (D-01)
> ├── Product (team)
> │   └── PM Agent (D-02)
> ├── Architecture (team)
> │   └── Architect Agent (D-03)
> ├── Development (team)
> │   ├── Backend Agent (D-04)
> │   ├── Frontend Agent (D-05)
> │   └── DB Agent (D-06)
> ├── Platform (team)
> │   └── Harness Agent (D-07)
> ├── Quality (team)
> │   ├── QA Agent (D-08)
> │   └── Security Agent (D-09)
> ├── Operations (team)
> │   ├── DevOps Agent (D-10)
> │   └── SRE Agent (D-11) — 已存在
> └── Intelligence (team)
>     └── Codebase Intel (D-12)
> ```
>
> **验收：** `DEVOS_ENGINEERING_ORG` 包含全部 12 个 agent 节点；现有 SRE bootstrap 测试仍通过

---

##### Day 3–4 — DevOS 种子数据 + Paperclip 注册

> **🃏 CARD-D3-01 · `devos-full-seed.ts` + `devos-full.seed.json`**
>
> **类型：** 新建文件  
> **耗时：** 1.5d
>
> 导出 `buildDevOsFullSeed()` 函数，生成 PDF §01 完整 12-Agent 种子（含 model / trigger / budget / sla）。
> 同时生成静态 `harness-config/devos-full.seed.json`。
>
> **关键数据（PDF §01 对齐）：**
>
> | Agent | Model | Trigger | Monthly USD |
> |-------|-------|---------|-------------|
> | CTO Agent | claude-opus-4-6 | on-ticket | $100 |
> | PM Agent | claude-sonnet-4-6 | on-ticket | $60 |
> | Architect Agent | claude-sonnet-4-6 | post-plan | $60 |
> | Backend Agent | claude-code | on-task | $120 |
> | Frontend Agent | claude-code | on-task | $80 |
> | DB Agent | claude-sonnet-4-6 | pre-deploy | $40 |
> | Harness Agent | claude-sonnet-4-6 | api-change | $60 (SLA: 48h) |
> | QA Agent | claude-sonnet-4-6 | post-dev | $60 (minCoverage: 80) |
> | Security Agent | claude-sonnet-4-6 | pre-merge | $30 |
> | DevOps Agent | claude-code | post-approve | $40 |
> | SRE Agent | claude-sonnet-4-6 | alert | $40 |
> | Codebase Intel | claude-sonnet-4-6 | always-on | $30 |
>
> **月度总预算：$720**

---

> **🃏 CARD-D4-01 · DevOS Paperclip 12 Agent 注册**
>
> **类型：** 运维操作  
> **耗时：** 0.5d
>
> ```bash
> pnpm db:seed -- devos-agents
> ```
>
> **验证：**
> 1. Paperclip Dashboard → DevOS 实例 → 12 Agent 全部 ACTIVE
> 2. Codebase Intel 测试查询："Price Sentinel 在哪个文件？" → 返回 `price-sentinel.agent.ts`
>
> **产出：** AC-P4-11 + AC-P4-12

---

##### Day 5 — Sprint 7 回归 + 检查点

> **🃏 CARD-D5-01 · Sprint 7 最终回归**
>
> **检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | P1-01 合并 | `deleted_at` 列存在于 `decision_memory` 和 `product_features` |
> | 2 | P2-01~04 合并 | `pnpm test && pnpm -F @patioer/dataos test:coverage` 通过 |
> | 3 | Retro 完成 | `retro.md` 非空模板 |
> | 4 | DG-01 关闭 | `dg-01-shopify-inbox-status.md` 包含"降级豁免" |
> | 5 | DevOS 12 Agent | Paperclip Dashboard 全部 ACTIVE |
> | 6 | `coordination` 类型 | `isDevOsTicket({ type: 'coordination', ... })` → true |
> | 7 | CI | 全部通过 |

---

### Sprint 8 · Week 3–4 — Autonomous Loop 框架 + Shopify 真实联调

**交付物：** `autonomous-loop.ts` · `task-graph.ts` · `loop-context.ts` · `loop-error.ts` · Loop 单元测试 100% · E2E stub 通过 · Shopify 真实 API 联调 ✅

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 8.1 | `task-graph.ts`：TaskGraph 数据结构 + `topologicalSort` | `packages/devos-bridge/` | — | 1d |
| 8.2 | `loop-error.ts`：`LoopError` 结构化错误（coverage_below_80 / security_issues / deployment_failed） | `packages/devos-bridge/` | — | 0.5d |
| 8.3 | `loop-context.ts`：LoopContext（阶段日志写入 `agent_events`） | `packages/devos-bridge/` | — | 1d |
| 8.4 | `autonomous-loop.ts` Stage 01–04：Ticket → PM 分析 → 架构设计 → Task Graph | `packages/devos-bridge/` | 8.1–8.3 | 2d |
| 8.5 | `autonomous-loop.ts` Stage 05–06：并行编码 + 测试&安全 | `packages/devos-bridge/` | 8.4 | 2d |
| 8.6 | `autonomous-loop.ts` Stage 07–09：人工审批 + 部署 + 监控回滚 | `packages/devos-bridge/` | 8.5 | 1.5d |
| 8.7 | Loop 单元测试（全 9 阶段 mock 通过） | `packages/devos-bridge/` | 8.6 | 1d |
| 8.8 | **Shopify 真实联调**：OAuth → getProducts → updatePrice 全链路 | `packages/harness/` + 外部 | — | 1d |
| 8.9 | Sprint 8 回归 + E2E stub 通过 | all | 8.1–8.8 | 0.5d |

**Sprint 8 验收：**
- [ ] `topologicalSort` 单元测试通过（含环检测）
- [ ] `AutonomousDevLoop.run()` stub 模式 E2E 通过（9 阶段全流转）
- [ ] Stage 06 覆盖率 <80% 时抛出 `LoopError("coverage_below_80")`（**AC-P4-02**）
- [ ] Stage 07 未审批时 DevOps Agent 不执行部署（**AC-P4-04**）
- [ ] Shopify 真实 API：`getProducts` 返回真实商品 + `updatePrice` 可回查

---

### Sprint 9 · Week 5–6 — Loop 首次完整演练

**交付物：** 用真实 Ticket 跑完整 Loop（Stage 01→09） · 全程日志 · 人工审批节点验证 · 失败回滚验证

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 9.1 | **演练 Ticket 创建**（手动）：Price Sentinel 品类阈值功能 | 外部操作 | — | 0.5d |
| 9.2 | Loop 演练 Round 1：PM Agent 分析 + Architect 设计（Stage 02–03） | devos-bridge | 9.1 | 1d |
| 9.3 | Loop 演练 Round 1：Task Graph 分解 + 并行编码（Stage 04–05） | devos-bridge | 9.2 | 2d |
| 9.4 | Loop 演练 Round 1：QA 测试 + Security 扫描（Stage 06） | devos-bridge | 9.3 | 1d |
| 9.5 | Loop 演练 Round 1：人工审批 + DevOps 部署 + SRE 监控（Stage 07–09） | devos-bridge | 9.4 | 1d |
| 9.6 | **失败回滚验证**：注入 SRE 健康异常 → DevOps 自动回滚 | devos-bridge | 9.5 | 1d |
| 9.7 | **Security Agent 验证**：用测试 Ticket 触发安全问题检测 | devos-bridge | 9.4 | 1d |
| 9.8 | **DB Agent 验证**：确认 Loop 中自动生成 Migration 文件 | devos-bridge | 9.3 | 0.5d |
| 9.9 | **Harness Agent 验证**：模拟 Shopify API 版本升级 → 48h 内 PR | devos-bridge | — | 1d |
| 9.10 | Loop 演练证据归档 + Sprint 9 回归 | docs + all | 9.1–9.9 | 0.5d |

**Sprint 9 验收：**
- [ ] Loop 首次完整跑通，全程每阶段有耗时日志（**AC-P4-01**）
- [ ] Security Agent 发现并修复 1 个安全问题（**AC-P4-03**）
- [ ] 失败回滚：SRE 异常 → DevOps 自动回滚（**AC-P4-05**）
- [ ] DB Agent 自动生成 Migration 文件（**AC-P4-13**）
- [ ] Harness Agent 48h 内提交 PR（**AC-P4-06**）

---

### Sprint 10 · Week 7–8 — Finance + CEO Agent + 多平台联调

**交付物：** Finance Agent · CEO Agent · 9 Agent 72h 运行 · Amazon Sandbox / TikTok / Shopee 联调（或降级豁免）

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 10.1 | `finance-agent.agent.ts`：ClickHouse Event Lake 聚合 → 月度 P&L | `packages/agent-runtime/` | — | 2d |
| 10.2 | `ceo-agent.agent.ts`：读取全部 Agent Ticket → 每日协调报告 → 冲突仲裁 | `packages/agent-runtime/` | 7.10 | 2d |
| 10.3 | CEO 仲裁场景测试：Ads Optimizer vs Inventory Guard 冲突 | `packages/agent-runtime/` | 10.2 | 1d |
| 10.4 | 9 Agent 种子扩展 + 72h 心跳运行启动 | `scripts/` | 10.1–10.2 | 0.5d |
| 10.5 | **Amazon Sandbox 联调**：SP-API sandbox getProducts / updatePrice | `packages/harness/` + 外部 | — | 1d |
| 10.6 | **TikTok 联调**：webhook 真实推送（或 mock 降级豁免） | `packages/harness/` + 外部 | — | 1d |
| 10.7 | **Shopee 联调**：SG+MY getProducts（或 mock 降级豁免） | `packages/harness/` + 外部 | — | 1d |
| 10.8 | 72h 运行结束验证 + Sprint 10 回归 | all | 10.4 | 0.5d |

**Sprint 10 验收：**
- [ ] 9 Agent 72h 心跳连续，无 crash，无预算异常（**AC-P4-07**）
- [ ] CEO Agent 每日 08:00 生成协调报告（**AC-P4-08**）
- [ ] Finance Agent 首份 P&L 报告（**AC-P4-09**）
- [ ] CEO 仲裁正确协调（**AC-P4-10**）
- [ ] 至少 1 个非 Shopify 平台联调完成或降级豁免签字（**AC-P4-27**）
- [ ] DG-01 状态明确关闭（**AC-P4-28** — 已在 S7 完成）

---

### Sprint 11 · Week 9–10 — B2B Portal Harness + EDI 对接

**交付物：** `b2b.harness.ts` · EDI 850 解析 · 3 档阶梯定价 · B2B 租户创建 + Agent 配置差异

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 11.1 | `b2b.types.ts`：EDI 850 类型 + 阶梯定价类型 + buyerTier | `packages/harness/` | — | 0.5d |
| 11.2 | `b2b.harness.ts`：`getProducts`（含 MOQ / 专属目录） | `packages/harness/` | 11.1 | 1d |
| 11.3 | `b2b.harness.ts`：`updatePrice`（3 档阶梯价格） | `packages/harness/` | 11.1 | 1d |
| 11.4 | `b2b.harness.ts`：`receiveEDIOrder`（EDI 850 解析 → 标准 Order） | `packages/harness/` | 11.1 | 1.5d |
| 11.5 | B2B Harness 测试（mock 后端 API） | `packages/harness/` | 11.2–11.4 | 1d |
| 11.6 | B2B 租户创建脚本 + HarnessRegistry 注册 `b2b` 平台 | `packages/harness/` + `apps/api` | 11.5 | 1d |
| 11.7 | B2B Agent 配置差异（Price Sentinel 阈值 5% / Support Relay 正式语气） | `packages/agent-runtime/` | 11.6 | 1d |
| 11.8 | B2B E2E 冒烟 + Sprint 11 回归 | all | 11.1–11.7 | 0.5d |

**Sprint 11 验收：**
- [ ] B2B Harness 三接口正常（**AC-P4-15**）
- [ ] B2B 阶梯定价 3 档正确（**AC-P4-16**）

---

### Sprint 12 · Week 11–12 — 多市场合规自动化

**交付物：** `CompliancePipeline` · 禁售品关键词库 · 品类认证检测 · AI 内容审核 · 合规 Ticket 自动创建

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 12.1 | `prohibited-keywords.ts`：SG/ID/DE/US 禁售品关键词库 | `packages/agent-runtime/src/compliance/` | — | 1d |
| 12.2 | `compliance-pipeline.ts`：`checkProhibitedKeywords` + `checkCategoryRestrictions` | compliance/ | 12.1 | 1.5d |
| 12.3 | `compliance-pipeline.ts`：`checkCertificationRequirements` + `checkHSCode` | compliance/ | 12.2 | 1.5d |
| 12.4 | `compliance-pipeline.ts`：`aiContentReview`（图片+文案 AI 检测） | compliance/ | 12.2 | 1.5d |
| 12.5 | `CompliancePipeline.check()` 总入口 + 合规 Ticket 自动创建 | compliance/ | 12.2–12.4 | 1d |
| 12.6 | Product Scout 集成：上架前调用 `CompliancePipeline.check()` | `packages/agent-runtime/` | 12.5 | 1d |
| 12.7 | 合规 E2E 测试（ID 市场清真 + 禁售品拦截） | compliance/ | 12.5–12.6 | 1d |
| 12.8 | Sprint 12 回归 | all | 12.1–12.7 | 0.5d |

**Sprint 12 验收：**
- [ ] ID 市场清真认证检测（**AC-P4-17**）
- [ ] 禁售品自动拦截 + 合规 Ticket（**AC-P4-18**）

---

### Sprint 13 · Week 13–14 — 三层控制台 API + ClipMart 模板

**交付物：** `/api/v1/console/*` API · Grafana Dashboard 三层状态 · `clipmart-template.json` · `pnpm clipmart:import` CLI · 审批中心 API · 告警中心 API

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 13.1 | `apps/api/src/routes/console.ts`：ElectroOS 状态 API（9 Agent 心跳/预算/待审批） | `apps/api/` | — | 1d |
| 13.2 | `console.ts`：DevOS 状态 API（Loop 进行中任务/12 Agent 状态/待审批部署） | `apps/api/` | 13.1 | 1d |
| 13.3 | `console.ts`：DataOS 状态 API（Event Lake 写入速率/Feature Store 更新时间/Memory 条数） | `apps/api/` | 13.1 | 1d |
| 13.4 | `console.ts`：审批中心 API（汇总所有 pending approvals） | `apps/api/` | — | 0.5d |
| 13.5 | `console.ts`：告警中心 API（P0/P1 告警 + SRE 处理记录） | `apps/api/` | — | 0.5d |
| 13.6 | Grafana Dashboard JSON：三层状态面板（从 Prometheus 指标构建） | `docker/grafana/` | 13.1–13.5 | 1d |
| 13.7 | `clipmart-template.json`：标准跨境电商模板（9 Agent 默认配置 + governance + DataOS） | `harness-config/` | — | 1d |
| 13.8 | `scripts/clipmart-import.ts`：`pnpm clipmart:import --tenant=X --template=standard` | `scripts/` | 13.7 | 1d |
| 13.9 | ClipMart 验证：导入新租户 → 30 分钟内 9 Agent 就绪 | 验证 | 13.8 | 1d |
| 13.10 | Sprint 13 回归 | all | 13.1–13.9 | 0.5d |

**Sprint 13 验收：**
- [ ] 三层 Dashboard 正常展示（**AC-P4-23**）
- [ ] ClipMart 模板导入：新租户 30 分钟内 9 Agent 就绪（**AC-P4-24**）

---

### Sprint 14 · Week 15–16 — 50 租户压测 + 容灾 + 最终验收

**交付物：** 50 租户并发 24h · 单层容灾 × 2 · ClickHouse 压测 · 全 28 项 AC 通过 · Phase 5 GO 决策

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 14.1 | 压测环境搭建：50 租户 seed + PgBouncer 配置 | scripts + docker | — | 1d |
| 14.2 | 50 租户并发 24h 运行（所有 Agent 心跳） | 运维操作 | 14.1 | 1d+24h |
| 14.3 | 并发结果验证：心跳日志连续 + DB 连接池 < 80% + 预算无异常 | 验证 | 14.2 | 0.5d |
| 14.4 | **单层容灾 1**：停止 DataOS 容器 → ElectroOS 降级运行 | 运维操作 | — | 0.5d |
| 14.5 | **单层容灾 2**：停止 DevOS 容器 → ElectroOS 正常运行 | 运维操作 | — | 0.5d |
| 14.6 | **ClickHouse 压测**：每秒 1000 条写入 + 查询延迟 < 500ms | 运维操作 | — | 0.5d |
| 14.7 | DevOS 月度预算审计：12 Agent 合计 ≤ $720 | 验证 | — | 0.5d |
| 14.8 | **遗留最终审计**：Phase 1–3 全部 ⏳ 项已关闭或有正式豁免 | 文档 | — | 0.5d |
| 14.9 | **全 28 项 AC 检查**：逐项勾选 + 证据链接 | 文档 | 14.1–14.8 | 1d |
| 14.10 | Phase 5 GO/NOGO 决策文档 | 文档 | 14.9 | 0.5d |

**Sprint 14 验收：**
- [ ] 50 租户并发 24h 正常（**AC-P4-19**）
- [ ] DataOS 容灾降级（**AC-P4-20**）
- [ ] DevOS 容灾不影响 ElectroOS（**AC-P4-21**）
- [ ] ClickHouse 压测达标（**AC-P4-22**）
- [ ] DevOS 月度预算 ≤ $720（**AC-P4-14**）
- [ ] 全 28 项 AC 通过（**AC-P4-25**）

---

## 9. 验收清单（28 项）

### Autonomous Dev Loop（6 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-01 | Loop 首次完整跑通：全程每阶段耗时日志 | S9 | ⬜ |
| AC-P4-02 | QA Agent 覆盖率强制 ≥80%：不足时自动打回 | S8 | ⬜ |
| AC-P4-03 | Security Agent：至少发现并修复 1 个安全问题 | S9 | ⬜ |
| AC-P4-04 | 人工审批节点：审批前 DevOps 不执行部署 | S8 | ⬜ |
| AC-P4-05 | Loop 失败回滚：SRE 异常 → DevOps 自动回滚 | S9 | ⬜ |
| AC-P4-06 | Harness Agent：模拟 Shopify 升级 → 48h PR | S9 | ⬜ |

### ElectroOS 9 Agent 全量（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-07 | 9 Agent 72h 心跳连续，无 crash | S10 | ⬜ |
| AC-P4-08 | CEO Agent 每日 08:00 协调报告 | S10 | ⬜ |
| AC-P4-09 | Finance Agent 首份月度 P&L 报告 | S10 | ⬜ |
| AC-P4-10 | CEO Agent 仲裁：冲突正确协调 | S10 | ⬜ |

### DevOS 12 Agent（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-11 | 12 Agent 全部 ACTIVE | S7 | ⬜ |
| AC-P4-12 | Codebase Intel 正确回答代码定位问题 | S7 | ⬜ |
| AC-P4-13 | DB Agent 自动生成 Migration | S9 | ⬜ |
| AC-P4-14 | DevOS 月度总预算 ≤ $720 | S14 | ⬜ |

### B2B Portal & 合规（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-15 | B2B Harness 三接口正常 | S11 | ⬜ |
| AC-P4-16 | B2B 阶梯定价 3 档正确 | S11 | ⬜ |
| AC-P4-17 | ID 市场清真认证检测 | S12 | ⬜ |
| AC-P4-18 | 禁售品自动拦截 + 合规 Ticket | S12 | ⬜ |

### 压测 & 容灾（5 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-19 | 50 租户并发 24h 正常 | S14 | ⬜ |
| AC-P4-20 | 停止 DataOS → ElectroOS 降级运行 | S14 | ⬜ |
| AC-P4-21 | 停止 DevOS → ElectroOS 正常运行 | S14 | ⬜ |
| AC-P4-22 | ClickHouse 1000/s 写入 + <500ms 查询 | S14 | ⬜ |
| AC-P4-23 | 三层 Dashboard 正常展示 | S13 | ⬜ |

### ClipMart（2 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-24 | ClipMart 模板导入 30min 就绪 | S13 | ⬜ |
| AC-P4-25 | 全部 AC 通过 → Phase 5 GO | S14 | ⬜ |

### 遗留清零（3 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P4-26 | Phase 3 P1-01 + P2-01~04 全部合并 | S7 | ⬜ |
| AC-P4-27 | ≥1 非 Shopify 平台联调完成或降级豁免 | S10 | ⬜ |
| AC-P4-28 | DG-01 状态明确关闭（降级豁免签字） | S7 | ⬜ |

---

## 10. 关键风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Amazon SP-API 审核 Phase 4 内未通过 | 高 | 中 | 全程 Sandbox；S14 降级 mock；AC-P2-01/02 降级豁免 |
| S10 工作量过载（3 平台联调 + 2 Agent） | 中 | 中 | S8 Shopify 打样复用；TikTok/Shopee 若审核未通过直接签豁免 |
| DevOS 自动部署沙箱隔离不足 | 中 | 高 | Stage 08 只操作 staging；production 要求人工审批 token |
| CEO Agent 循环依赖 | 中 | 中 | 只通过 Ticket 协调，不直接调用其他 Agent |
| 50 租户 DB 连接耗尽 | 中 | 高 | PgBouncer 连接池；`max_connections` 基准 |
| B2B EDI 格式差异 | 低 | 中 | Phase 4 只做 EDI 850；855/856 推迟 Phase 5 |

---

## 11. Agent 配置总览（Phase 4 后）

### ElectroOS 9 Agent

| Agent | 触发 | 模型 | 月预算 | Phase |
|-------|------|------|--------|-------|
| CEO Agent | daily 08:00 | claude-opus-4-6 | $80 | **Phase 4** |
| Product Scout | daily 06:00 | claude-sonnet-4-6 | $30 | Phase 1 |
| Price Sentinel | hourly | claude-haiku-4-5 | $50 | Phase 1 |
| Support Relay | event-driven（⚠️ webhook-only） | claude-sonnet-4-6 | $80 | Phase 1（DG-01 降级） |
| Ads Optimizer | 每 4h | claude-haiku-4-5 | $60 | Phase 2 |
| Inventory Guard | daily 08:00 | claude-haiku-4-5 | $20 | Phase 2 |
| Content Writer | on-demand | claude-sonnet-4-6 | $40 | Phase 3 |
| Market Intel | weekly 周一 | claude-sonnet-4-6 | $30 | Phase 3 |
| Finance Agent | monthly 1日 | claude-sonnet-4-6 | $40 | **Phase 4** |

**ElectroOS 月总预算：$430/租户**

### DevOS 12 Agent

| Agent | 触发 | 模型 | 月预算 |
|-------|------|------|--------|
| CTO Agent | on-ticket | claude-opus-4-6 | $100 |
| PM Agent | on-ticket | claude-sonnet-4-6 | $60 |
| Architect Agent | post-plan | claude-sonnet-4-6 | $60 |
| Backend Agent | on-task | claude-code | $120 |
| Frontend Agent | on-task | claude-code | $80 |
| DB Agent | pre-deploy | claude-sonnet-4-6 | $40 |
| Harness Agent | api-change | claude-sonnet-4-6 | $60 |
| QA Agent | post-dev | claude-sonnet-4-6 | $60 |
| Security Agent | pre-merge | claude-sonnet-4-6 | $30 |
| DevOps Agent | post-approve | claude-code | $40 |
| SRE Agent | alert | claude-sonnet-4-6 | $40 |
| Codebase Intel | always-on | claude-sonnet-4-6 | $30 |

**DevOS 月总预算：$720**

---

## 12. 各市场合规规则速查（Phase 4 重点市场）

| 市场 | 禁售品关键词示例 | 认证要求 | 检测方式 |
|------|---------------|---------|---------|
| SG | 口香糖 / 烟火 / 未批准药品 | 电子产品 IMDA | 关键词匹配 + HSA 数据库 |
| ID | 酒精（仅限特定渠道）/ 猪肉（需清真认证）| BPOM（食品/化妆品）| 品类标签 + 清真认证文件验证 |
| DE | 纳粹符号 / 特定武器 / 仿冒品 | WEEE（电子）/ VerpackG | 图片 AI + 品牌侵权数据库 |
| US | FDA 管控 / 含铅玩具 / 未认证电子 | FCC / CPSC | FCC ID 验证 + CPSC 召回数据库 |

---

## Related

- [System Constitution v1.0](../system-constitution.md)
- [ADR-0004 · Autonomous Loop 架构决策](../adr/0004-phase4-autonomous-loop.md)
- [Phase 4 Brainstorm](../brainstorms/2026-03-28-phase4-autonomous-dev-loop-brainstorm.md)
- [Phase 3 实施计划](./phase3-plan.md)
- [Phase 2 实施计划](./phase2-plan.md)
- [Phase 1 实施计划](./phase1-plan.md)
- [Sprint 6 对齐报告](../ops/sprint6-p3/sprint6-constitution-blueprint-alignment.md)
