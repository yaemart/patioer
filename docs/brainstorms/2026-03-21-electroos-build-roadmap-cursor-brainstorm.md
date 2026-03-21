---
date: 2026-03-21
topic: electroos-build-roadmap-cursor
related:
  - docs/brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-devos-constitution-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-engineering-checklist-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-constitution-guard-brainstorm.md
---

# ElectroOS / DataOS / DevOS：落地构建顺序与 Cursor 执行包

## What We're Building

一份**工程落地路线**：在 **Cursor + Paperclip** 前提下，按 **ElectroOS → DataOS → DevOS** 顺序推进，避免三系统并行导致失控。本文明确：

- **Paperclip 的正确定位**：**Agent 编排与执行内核**（对接任务/工具/心跳/预算的控制平面），**不是**「ElectroOS 业务 SaaS 本体」。
- **第一期 ElectroOS 最小能力**：Product API、Order API、经 Paperclip 的 Agent 执行路径、可选极简 UI。
- **DataOS 第二期**：在「API + Agent 已跑通」之后，再叠 Product / User / Scenario 等 **Graph 与特征/记忆**（先图式数据，不必第一天上全套 ClickHouse）。
- **DevOS 最后**：自动写码、修 bug、部署 — 依赖前两阶段已有**可测、可部署**的骨架与清单/宪法约束。

附：**可复制到 Cursor 的 Prompt 包**（用于初始化结构、接 Paperclip、搭 API、接工具），作为执行入口，**不替代** `/workflows:plan` 中的文件级实现计划。

## Why This Approach

胜负点在 **数据结构与系统结构**，不在「模型多聪明」。顺序错误（先 Graph / 先 DevOS）会放大返工。YAGNI：**先 API + Agent 闭环**，再丰富图与 DataOS，最后自治工程化。

## Build Order（必须遵守）

| 阶段 | 系统 | 目标一句话 |
|------|------|------------|
| **1** | ElectroOS | 最小可运行 AI 电商：商品/订单 API + Paperclip 驱动工具调用 |
| **2** | DataOS | 让系统「理解」商品与用户情境（Graph + 特征/记忆，分期） |
| **3** | DevOS | 自动开发/修复/部署 + Constitution Guard（见专文） |

## Phase 1 — ElectroOS 最小四块

1. **Product API**：`search` / `get` / `compare`（路径可与最终实现统一为 `/api/v1/...`）。  
2. **Order API**：`create` / `status`。  
3. **Agent Executor**：基于 Paperclip 的 `runTask(task, context)` 语义，工具示例：`product_search`、`product_compare`、`order_create`。  
4. **简单 UI（可选）**：chat + 商品列表。

**核心关系：** **数据 + API 为真核心**；Agent = **调度与工具执行**，不颠倒。

## Phase 2 — DataOS（三个 Graph，概念层）

落地时**不必第一天建复杂图引擎**：可先用 **PostgreSQL 图式 schema** 表达实体与边，再演进。

- **Product Graph**：类目/属性/替代关系。  
- **User Graph**：预算、偏好、购买史。  
- **Scenario Graph**：场景 → 商品/策略映射（旅行/办公等）。

与《架构》中的 Event Lake / Feature Store / Decision Memory **对齐分期**：第二期先做「可查询的结构化知识」，全量事件湖可随量增长再引入。

## Phase 3 — DevOS

在 ElectroOS 可部署、清单可勾选、Guard 规划清晰后，再接 **Ticket → 实现 → PR → Guard → 部署**（详见 Constitution Guard 文档）。

## Cursor 执行包（复制即用）

以下为用户提供的 **Prompt 草稿**，实施时按仓库实际路径与 Paperclip API 调整。

### 1）初始化 Monorepo 结构

```
Create a production-ready monorepo structure for an AI-native ecommerce SaaS system.

Requirements:
- Next.js frontend
- Node.js backend
- PostgreSQL
- Agent runtime (paperclip integration)
- Multi-tenant support

Structure:
- apps/web
- apps/api
- packages/agent-runtime
- packages/data-layer
- packages/system-graph
- packages/product-graph
```

### 2）接入 Paperclip 作为执行引擎

```
Integrate paperclip as the agent execution engine.

Requirements:
- Wrap paperclip into a service called AgentRuntime
- Provide function:
  runTask(task: string, context: any)

- Add tool support:
  product_search
  product_compare
  order_create

- Make tools callable via API
```

### 3）构建 Product API

```
Create a product service with:

- PostgreSQL schema:
  product(id, name, category, price, attributes JSONB)

- API:
  GET /product/search
  GET /product/:id
  POST /product/compare

- Add seed data for:
  coffee maker with grinder
  burr grinder
  espresso machine
```

### 4）Agent → API 调用

```
Connect agent runtime to product API.

Flow:
User input → Agent → decide tool → call product API → return result

Add tool definition:
{
  name: "product_search",
  input: { query: string },
  output: product list
}
```

### 5）System Graph（轻量起步）

```
Create a system graph module:

Entities:
- User
- Product
- Order
- Agent

Relationships:
- user -> purchased -> product
- agent -> recommended -> product

Store in PostgreSQL (graph-like schema)
```

## 第一周目标（建议）

| 窗口 | 目标 |
|------|------|
| Day 1–2 | Paperclip 跑通；Agent 能调工具 |
| Day 3–4 | Product API 完成；Agent 能搜商品 |
| Day 5–6 | 极简 UI（chat） |
| Day 7 | 端到端：用户输入 → 推荐/搜索商品 → 返回结果 |

## 常见坑（与本文顺序绑定）

| 坑 | 对策 |
|----|------|
| 第一天做复杂 Graph | 先 **API + Agent**，再 Graph |
| 把 Agent 当系统核心 | **核心 = 数据 + API**；Agent = 调度 |
| 想一步「自动公司」 | 严格 **ElectroOS → DataOS → DevOS** |

## Approaches（仓库策略）

| 方案 | 描述 | Pros | Cons | 适用 |
|------|------|------|------|------|
| **A. 新建 `electroos` Monorepo**（推荐起步） | 与 `paperclip` 克隆并列；`agent-runtime` 通过 SDK/API 连 Paperclip | 边界清晰、业务代码不污染上游 | 需维护集成契约 | **当前 patioer 最稳妥** |
| **B. Fork Paperclip 内嵌业务** | 在 paperclip 仓库内加 apps | 单仓 | 升级上游困难、违背关注点分离 | 不推荐长期 |
| **C. 仅 API + 远程 Paperclip** | 业务 API 独立，Paperclip 自托管 | 运维分层 | 网络与鉴权复杂 | 中后期 |

**Recommendation：** **A**，Paperclip 保持**可替换的执行/编排后端**；ElectroOS 自有数据与 API。

## Key Decisions

- 三系统 **严格顺序**：ElectroOS → DataOS → DevOS。  
- Paperclip = **编排 + 执行内核对接层**，业务 SaaS 与租户数据在 ElectroOS 侧。  
- Cursor Prompt 包 = **启动器**；合规与长期不腐化仍依赖《宪法》《清单》《Guard》三文档。  
- Graph / DataOS：**第二期**；第一期以关系库 + API 为主。

## Open Questions

1. **多租户：** 第一周是否 **单租户 demo**，第二周再 `tenant_id` + RLS？  
2. **Paperclip 集成：** 进程内嵌入 vs HTTP 调用 Paperclip Server —— 影响 `AgentRuntime` 边界。  
3. **下一步交付：** 是否需要单独的「ElectroOS v1 代码骨架」规划文档（转入 `/workflows:plan`）？

## Resolved Questions

- **仓库策略：** 已与 [`2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md`](./2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md) 对齐 — **独立 Monorepo（Master 选项 B）**，等同本文件 **方案 A「新建 `electroos` Monorepo 与 paperclip 并列」**；Paperclip **依赖或并排服务**，非 fork 内嵌业务主路径。

## Next Steps

→ 确认 Open Questions 后执行 `/workflows:plan`：第一周聚焦 **apps/api + packages/agent-runtime + Product API + 工具桥接**，DevOS/Guard 只列依赖不实现。
