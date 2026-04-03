# 租户 UI 重新规划方案

**日期：** 2026-03-30
**状态：** Draft
**背景：** 当前 Dashboard 从 Agent 基础设施视角设计（Agent 数量、平台数、用量），而非从电商卖家的业务需求出发。系统 API 层已具备丰富的业务数据能力（商品、订单、广告、库存、审批详情、Agent 事件），但前端完全未利用。

---

## 0. 核心原则

| # | 原则 | 说明 |
|---|------|------|
| P1 | **卖家视角，不是工程师视角** | 租户关心的是「我的生意怎么样」，不是「Agent 心跳是否正常」 |
| P2 | **Human-in-the-loop 是核心交互** | 审批操作（调价/广告/补货/客服）是租户每天必须做的事，不是边栏角标 |
| P3 | **Agent 是手段，业务成果是目的** | 展示「Agent 帮你做了什么」而非「Agent 运行状态」 |
| P4 | **配置即策略** | 租户通过调整 Agent 上下文（阈值/策略/目标）来表达经营策略 |
| P5 | **已有 API 优先** | 最大化复用现有后端能力，不新建不必要的 API |

---

## 1. 信息架构（IA）

```
/                           → 已登录跳 /dashboard，未登录跳 /login
/register                   → 注册（保留）
/login                      → 登录（保留）
/onboarding                 → 7 步向导（保留）

/dashboard                  → 经营总览（重新设计）
/approvals                  → 审批中心（新建）
/agents                     → Agent 团队（新建）
/agents/[id]                → Agent 详情 + 配置（新建）
/products                   → 商品管理（新建）
/orders                     → 订单概览（新建）
/ads                        → 广告中心（新建）
/inventory                  → 库存预警（新建）
/platforms                  → 平台连接（新建）
/settings                   → 设置（增强）
/settings/governance        → 治理偏好（从 settings 拆出子页）
/settings/billing           → 账单与用量（从 settings 拆出子页）
/clipmart                   → 模板市场（保留）
/clipmart/[id]              → 模板详情（保留）
```

### 导航侧栏分组

```
── 经营
   ├── 总览           /dashboard
   ├── 审批中心       /approvals        (badge: pending count)
   ├── 商品           /products
   ├── 订单           /orders
   ├── 广告           /ads
   └── 库存           /inventory

── AI 团队
   ├── Agent 团队     /agents
   └── 模板市场       /clipmart

── 设置
   ├── 平台连接       /platforms
   ├── 治理偏好       /settings/governance
   ├── 账单与用量     /settings/billing
   └── 账户           /settings
```

---

## 2. 页面详细设计

### 2.1 `/dashboard` — 经营总览

**设计目标：** 卖家打开即知「今天生意怎么样，有什么需要我处理的」

#### 模块布局

```
┌─────────────────────────────────────────────────────┐
│  ⚠️ 需要你处理 (N 条)                    [去审批中心 →] │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 调价审批  │ │ 广告预算  │ │ 客服升级  │            │
│  │ 3 条待批  │ │ 1 条待批  │ │ 2 条待批  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────┤
│  📊 今日 Agent 动态                                   │
│  • Price Sentinel 监控了 48 个商品，建议调价 3 个      │
│  • Ads Optimizer 优化了 2 个广告活动，ROAS +12%       │
│  • Inventory Guard 发现 5 个商品低库存                │
│  • Support Relay 处理了 8 个客服工单                  │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ 商品数        │ │ 今日订单      │ │ 本月用量      │ │
│  │ 156 个在售    │ │ 23 笔        │ │ $47 / $160   │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
├─────────────────────────────────────────────────────┤
│  🏪 平台状态                                         │
│  Shopify ✅ 正常  │  Amazon ✅ 正常  │  TikTok ⚠️ 授权将过期 │
├─────────────────────────────────────────────────────┤
│  📦 库存预警 (5)                         [查看全部 →] │
│  SKU-001 安全库存 20，当前 8 ⚠️                      │
│  SKU-002 已缺货 ❌                                   │
└─────────────────────────────────────────────────────┘
```

#### 数据来源

| 模块 | API | 备注 |
|------|-----|------|
| 需要你处理 | `GET /api/v1/approvals?status=pending` | 按 `action` 分组计数 |
| Agent 动态 | `GET /api/v1/agent-events?limit=20` | 取最近事件，按 Agent 聚合摘要 |
| 商品数 | `GET /api/v1/products` | `.length` 或后续加 count API |
| 今日订单 | `GET /api/v1/orders` | 按日期过滤（或后续加 count API） |
| 本月用量 | `GET /api/v1/billing/usage` | 已有 |
| 平台状态 | `GET /api/v1/platform-credentials` | 检查凭证有效性 |
| 库存预警 | `GET /api/v1/inventory/alerts` | 已有 |

---

### 2.2 `/approvals` — 审批中心（Human-in-the-Loop 核心）

**设计目标：** 这是租户与 Agent 交互的主战场。Agent 提出建议，人类做决策。

#### 功能

- **审批列表**：按时间倒序，每条显示：
  - 发起 Agent（哪个 Agent 提的建议）
  - 操作类型（调价 / 设广告预算 / 补货 / 客服升级）
  - **具体内容**（如：「将 XX 商品从 $29.99 调至 $24.99，原因：竞品降价 15%」）
  - 创建时间
  - **[批准] [拒绝]** 按钮
- **筛选**：按状态（待处理 / 已批准 / 已拒绝）、按 Agent、按操作类型
- **批量操作**：全选同类审批一键批准

#### 数据来源

| 功能 | API |
|------|-----|
| 列表 | `GET /api/v1/approvals?status=pending` |
| 详情 | `GET /api/v1/approvals/:id` |
| 批准/拒绝 | `PATCH /api/v1/approvals/:id/resolve` |

#### 需要的 API 增强

- [ ] `GET /api/v1/approvals` 增加 `action` 筛选参数
- [ ] 审批 `payload` 中需要更多人类可读信息（商品名称、当前价格、建议价格、原因等）

---

### 2.3 `/agents` — Agent 团队

**设计目标：** 用「员工」的隐喻展示 Agent，让卖家理解「你有一支 AI 团队在帮你干活」

#### 布局

9 张 Agent 卡片（或列表），每张显示：
- Agent 名称 + 中文角色说明（如「Price Sentinel · 定价守卫」）
- 状态：运行中 🟢 / 暂停 🟡 / 离线 🔴
- 最近一次执行时间
- 本月执行次数 / 预算消耗
- 待审批数量
- **[配置] [查看历史]** 按钮

#### 数据来源

| 功能 | API |
|------|-----|
| Agent 列表 | `GET /api/v1/agents` |
| 健康/心跳 | `GET /api/v1/console/electroos`（Agent 级 `healthy`、`lastHeartbeat`） |
| 待审批数 | `GET /api/v1/approvals?status=pending&agentId=xxx` |

---

### 2.4 `/agents/[id]` — Agent 详情与配置

**设计目标：** 租户在这里定义「AI 员工的工作方式」

#### 两个 Tab

**Tab 1: 工作记录**
- Agent 最近操作的时间线（`GET /api/v1/agent-events?agentId=xxx`）
- 每条事件以人类可读方式展示

**Tab 2: 策略配置**（按 Agent 类型动态渲染表单）

| Agent | 可配置项 | 表单控件 |
|-------|---------|---------|
| Price Sentinel | 调价审批阈值（5%-30%） | 滑块 |
| Support Relay | 自动回复策略（非退款自动/全部手动） | 单选 |
| Ads Optimizer | 目标 ROAS | 数字输入 |
| Inventory Guard | 安全库存线、补货审批门槛 | 数字输入 |
| Content Writer | 文案语气（专业/休闲/奢华/性价比） | 下拉选择 |
| Market Intel | 监控平台、最大商品数 | 多选 + 数字 |
| Product Scout | 最大扫描商品数 | 数字输入 |

#### 数据来源

| 功能 | API |
|------|-----|
| Agent 详情 | `GET /api/v1/agents/:id` |
| 更新配置 | `PATCH /api/v1/agents/:id`（更新 `goalContext`） |
| 操作历史 | `GET /api/v1/agent-events?agentId=xxx` |

---

### 2.5 `/products` — 商品管理

**设计目标：** 查看 Agent 管理的商品目录

#### 功能

- 商品列表（表格：名称、平台、价格、库存、状态）
- 手动触发同步（`POST /api/v1/products/sync`）
- 查看 Agent 对商品的操作记录

#### 数据来源

| 功能 | API |
|------|-----|
| 商品列表 | `GET /api/v1/products` |
| 同步 | `POST /api/v1/products/sync` |

---

### 2.6 `/orders` — 订单概览

#### 功能

- 订单列表（表格：订单号、平台、金额、状态、日期）
- 支持查看平台实时订单

#### 数据来源

| 功能 | API |
|------|-----|
| DB 订单 | `GET /api/v1/orders` |
| 平台实时 | `GET /api/v1/orders/platform` |

---

### 2.7 `/ads` — 广告中心

#### 功能

- 广告活动列表（名称、状态、花费、ROAS）
- 性能概览（`GET /api/v1/ads/performance`）
- 与 Ads Optimizer Agent 的审批联动

#### 数据来源

| 功能 | API |
|------|-----|
| 活动列表 | `GET /api/v1/ads/campaigns` |
| 性能数据 | `GET /api/v1/ads/performance` |

---

### 2.8 `/inventory` — 库存预警

#### 功能

- 库存列表（SKU、当前数量、安全线、状态标签）
- 预警高亮（低库存黄色、缺货红色）
- 与 Inventory Guard Agent 的审批联动

#### 数据来源

| 功能 | API |
|------|-----|
| 全部库存 | `GET /api/v1/inventory` |
| 预警 | `GET /api/v1/inventory/alerts` |

---

### 2.9 `/platforms` — 平台连接

#### 功能

- 已连接平台卡片（Shopify / Amazon / TikTok / Shopee / Walmart / B2B）
- 连接状态（✅ 正常 / ⚠️ 即将过期 / ❌ 断开）
- 新增连接（OAuth 跳转）
- 凭证管理

#### 数据来源

| 功能 | API |
|------|-----|
| 凭证列表 | `GET /api/v1/platform-credentials` |
| 新增 | `POST /api/v1/platform-credentials` |
| OAuth | 各平台 `/api/v1/{platform}/auth` |
| B2B/Wayfair | `POST /api/v1/b2b/wayfair/credentials`、`GET /api/v1/b2b/wayfair/status` |

---

### 2.10 `/settings/governance` — 治理偏好

#### 功能

- 全局调价审批阈值（滑块 5%-30%）
- 广告预算审批开关
- 新品上架审批开关
- Human-in-the-loop Agent 选择（多选）

#### 数据来源

| 功能 | API |
|------|-----|
| 读取 | `GET /api/v1/settings/governance` |
| 更新 | `PUT /api/v1/settings/governance` |

---

### 2.11 `/settings/billing` — 账单与用量

#### 功能

- 本月用量/预算/剩余
- 逐 Agent 用量明细
- Stripe 客户门户入口（管理订阅/支付方式）

#### 数据来源

| 功能 | API |
|------|-----|
| 用量 | `GET /api/v1/billing/usage` |
| Stripe 门户 | `GET /api/v1/billing/portal-session` |

---

## 3. 实施优先级

### P0 — 核心体验（必须先做）

| # | 页面 | 理由 | 估时 |
|---|------|------|------|
| 1 | `/dashboard` 重新设计 | 卖家第一印象；汇聚所有关键信号 | 2d |
| 2 | `/approvals` 审批中心 | Human-in-the-loop 核心交互，无此页面产品不成立 | 2d |
| 3 | `/agents` + `/agents/[id]` | 让租户理解并配置 AI 团队 | 2d |
| 4 | 侧栏导航布局 | 信息架构骨架，所有页面依赖 | 1d |

### P1 — 业务可视化

| # | 页面 | 理由 | 估时 |
|---|------|------|------|
| 5 | `/products` | 卖家核心：我卖什么 | 1d |
| 6 | `/orders` | 卖家核心：今天卖了多少 | 1d |
| 7 | `/inventory` | 预警驱动，防缺货 | 0.5d |
| 8 | `/ads` | 广告花钱要看得到效果 | 1d |

### P2 — 设置与运维

| # | 页面 | 理由 | 估时 |
|---|------|------|------|
| 9 | `/platforms` | 从 onboarding 后的持续管理 | 1d |
| 10 | `/settings/governance` | 精细化治理策略 | 0.5d |
| 11 | `/settings/billing` | 用量透明 | 0.5d |

**总估时：** P0 约 7d，P1 约 3.5d，P2 约 2d = **~12.5d**

---

## 4. 需要的后端补充

大部分 API 已存在，但需要少量增强：

| # | 增强 | 当前 | 需要 |
|---|------|------|------|
| B1 | 审批 `payload` 人类可读 | Agent 写入的 raw JSON | 增加 `displayTitle`、`displayDescription` 字段 |
| B2 | `GET /api/v1/approvals` 增加 `action` 筛选 | 仅支持 `status`、`agentId` | 增加 `action` query 参数 |
| B3 | Agent 事件人类可读摘要 | raw action + payload | 增加 `summary` 或前端映射表 |
| B4 | Products/Orders count API | 只有全量列表 | 增加 `GET /api/v1/products/count`、`GET /api/v1/orders/count` |
| B5 | `adsBudgetApproval` 接线 | 治理设置有字段，Agent 运行时用常量 | 治理设置同步到 Ads Optimizer `goalContext` |
| B6 | `newListingApproval` 接线 | 同上 | 同步到 Product Scout |
| B7 | `humanInLoopAgents` 接线 | 已存未用 | Agent 运行时检查此列表 |

---

## 5. 与蓝图的关系

| 蓝图原设计 | 本方案调整 | 理由 |
|-----------|-----------|------|
| 三列 ElectroOS / DevOS / DataOS | 去掉 DevOS / DataOS 列 | 租户不关心平台基础设施 |
| 消费 Console API | 部分保留（ElectroOS Agent 状态） | 仅用于 `/agents` 页的 Agent 健康指示 |
| 待审批数量徽章 | 升级为完整审批中心 `/approvals` | 从数字升级为可操作的决策界面 |
| 月度用量仪表盘 | 保留，移入 Dashboard + `/settings/billing` | 用量仍然重要，但不是首屏唯一内容 |
| 无商品/订单/广告/库存页 | 新增 4 个业务页面 | 这些是卖家的核心关注点 |
| 无 Agent 配置入口 | 新增 `/agents/[id]` 配置页 | 租户定义经营策略的核心入口 |

---

## 6. SOP → Agent 上下文解析服务

### 6.0 问题定义

当前 Agent 配置只接受结构化参数（`goalContext` JSON），卖家必须理解 `approvalThresholdPercent`、`targetRoas` 等技术字段。这不是卖家思考问题的方式。

卖家思考的是**经营 SOP（标准操作流程）**：

> "我做高端护肤品，品牌形象比低价更重要。降价不超过 8%，竞品大幅降价我要亲自看。广告瞄准 25-45 岁女性，ROAS 至少 4.0。库存周转快的提前补，新品文案要我过目。客服退款超 $50 要我批准。"

SOP 中包含的信息远超 `goalContext` 能表达的范围：

| SOP 中的信息类型 | 当前系统是否能消费 |
|-----------------|-------------------|
| 数值阈值（降价 8%、ROAS 4.0） | 可以 → `goalContext` 结构化参数 |
| 行为策略（"不打价格战"、"退款要人工"） | 部分 → `systemPrompt` 但仅 LLM Agent 使用 |
| 品牌调性（"高端"、"温暖专业"） | 部分 → Content Writer `tone`、Support Relay `toneSystemPrompt` |
| 受众定位（"25-45 岁女性"） | 无 → 当前 Ads Optimizer 不消费此信息 |
| 经营哲学（"品牌 > 低价"） | 无 → 没有任何 Agent 接收此类上下文 |

---

### 6.1 架构设计

```
                    ┌─────────────────────────────┐
                    │  租户编写/编辑 SOP           │
                    │  （自然语言，按 Agent 分段）  │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │  SOP Parser Service          │
                    │  (LLM-powered extraction)    │
                    │                             │
                    │  Input:                      │
                    │    - SOP text                │
                    │    - agent type              │
                    │    - extraction schema       │
                    │                             │
                    │  Output:                     │
                    │    - goalContext (JSON)       │
                    │    - systemPrompt (text)     │
                    │    - governance (partial)    │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │ goalContext   │  │ systemPrompt │  │ governance       │
    │ (结构化参数)  │  │ (行为指导)    │  │ (全局治理设置)    │
    │              │  │              │  │                  │
    │ 所有 Agent   │  │ LLM Agent    │  │ tenant_governance│
    │ 消费         │  │ 消费         │  │ _settings 表     │
    └──────────────┘  └──────────────┘  └──────────────────┘
```

---

### 6.2 数据模型

#### 新增表：`tenant_sops`

```sql
CREATE TABLE tenant_sops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  agent_type   TEXT NOT NULL,              -- 'price-sentinel' | 'all' | ...
  sop_text     TEXT NOT NULL,              -- 卖家编写的原始 SOP 自然语言
  extracted_at TIMESTAMPTZ,                -- 最后一次 LLM 提取时间
  extracted_goal_context  JSONB,           -- 提取出的结构化参数
  extracted_system_prompt TEXT,            -- 提取出的行为指导
  extracted_governance    JSONB,           -- 提取出的治理设置片段
  version      INTEGER NOT NULL DEFAULT 1, -- SOP 版本号，每次编辑 +1
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, agent_type)            -- 每个租户每个 Agent 类型一份 SOP
);
```

#### 已有字段复用

| 字段 | 表 | 用途 |
|------|---|------|
| `goal_context` | `agents` | 接收 SOP 提取的结构化参数（合并写入） |
| `system_prompt` | `agents` | 接收 SOP 提取的行为指导（合并写入） |
| `tenant_governance_settings` 各字段 | `tenant_governance_settings` | 接收 SOP 提取的全局治理偏好 |

---

### 6.3 每个 Agent 的 SOP 映射分析

#### Price Sentinel（定价守卫）

**执行方式：** 规则引擎（无 LLM）— 基于阈值的 delta% 判断

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "降价不超过 8%" | `goalContext.approvalThresholdPercent: 8` | 直接消费（已支持） |
| "竞品大幅降价我要看" | 无对应参数 | **缺口** — 需新增 `competitorAlertThreshold` |
| "永远不主动发起价格战" | 无对应参数 | **缺口** — 需新增 `pricingStrategy: 'brand_protect' \| 'competitive' \| 'aggressive'` |
| "季末清仓可以放宽到 15%" | 无对应参数 | **缺口** — 需支持 `seasonalOverrides` |

**SOP 利用率：** ~25%（仅阈值数值可用）

**改进方案：** 扩展 `goalContext` schema 加入 `pricingStrategy`、`competitorAlertThreshold`；或在 Price Sentinel 执行前加一个 LLM pre-decision 步骤，将 SOP `systemPrompt` 注入定价建议生成。

---

#### Ads Optimizer（广告优化师）

**执行方式：** 规则引擎 + 常量阈值（无 LLM）

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "ROAS 至少 4.0" | `goalContext.targetRoas: 4.0` | 直接消费（已支持） |
| "日预算超 $500 要批准" | `APPROVAL_BUDGET_THRESHOLD_USD`（代码常量） | **缺口** — 需从 `goalContext` 读取 |
| "瞄准 25-45 岁女性" | 无对应参数 | **缺口** — Ads Optimizer 无受众定位能力 |
| "节日期间加预算" | 无对应参数 | **缺口** — 无时间敏感策略 |

**SOP 利用率：** ~20%

**改进方案：** 将 `APPROVAL_BUDGET_THRESHOLD_USD` 改为从 `goalContext.budgetApprovalThresholdUsd` 读取（B5 已列入后端补充）；受众定位需要平台 API 支持（Phase 6+）。

---

#### Support Relay（客服中继）

**执行方式：** 规则 + LLM（回复生成）

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "非退款自动回复" | `goalContext.autoReplyPolicy: 'auto_reply_non_refund'` | 直接消费（已支持） |
| "回复语气温暖专业" | `input.toneSystemPrompt` | **已支持** — Support Relay 在 LLM 调用中使用 `toneSystemPrompt` |
| "退款超 $50 要人工批准" | 无对应参数 | **缺口** — 当前按关键词判断，无金额阈值 |
| "说中文" | `systemPrompt` 注入语言 | 可通过 SOP → `toneSystemPrompt` 实现 |

**SOP 利用率：** ~50%（策略 + 语气都能用）

**改进方案：** 新增 `goalContext.refundApprovalThresholdUsd`；SOP 中的语气/品牌描述直接注入 `toneSystemPrompt`。

---

#### Inventory Guard（库存守卫）

**执行方式：** 规则引擎（无 LLM）

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "安全库存 20 件" | `goalContext.safetyThreshold: 20` | 直接消费（已支持） |
| "补货超 50 件要批准" | `goalContext.replenishApprovalMinUnits: 50` | 直接消费（已支持） |
| "每天早上 9 点检查" | `goalContext.timeZone` + `enforceDailyWindow` | 直接消费（已支持） |
| "周转快的提前 2 周补" | 无对应参数 | **缺口** — 无动态补货提前量 |

**SOP 利用率：** ~60%（大部分数值参数可用）

---

#### Content Writer（内容撰写师）

**执行方式：** LLM 驱动

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "语气专业" | `goalContext.tone: 'professional'` | 直接消费（已支持） |
| "高端护肤品，强调成分和功效" | `systemPrompt` | **可支持** — 注入到 LLM systemPrompt |
| "标题不超过 80 字" | `goalContext.maxLength` | 已支持（但是内容总长度，非标题单独限制） |
| "强调天然有机认证" | `systemPrompt` | 可支持 |
| "SEO 关键词要包含品牌名" | `systemPrompt` | 可支持 |

**SOP 利用率：** ~80%（LLM Agent，`systemPrompt` 能承载大部分 SOP 意图）

---

#### Market Intel（市场情报官）

**执行方式：** Harness 数据 + LLM 分析

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "监控 Shopify 和 Amazon" | `goalContext.platforms: ['shopify', 'amazon']` | 直接消费（已支持） |
| "最多扫描 100 个商品" | `goalContext.maxProducts: 100` | 直接消费（已支持） |
| "重点关注同品类竞品" | `systemPrompt` | 可支持 — 注入到 LLM 分析提示 |

**SOP 利用率：** ~70%

---

#### Product Scout（选品官）

**执行方式：** Harness 扫描 + 合规检查（含 LLM）

| SOP 可表达的意图 | 映射到 | 消费方式 |
|-----------------|--------|---------|
| "最多扫描 50 个" | `goalContext.maxProducts: 50` | 直接消费（已支持） |
| "新品上架要我审核" | `tenant_governance_settings.newListingApproval` | **缺口** — 字段已存但运行时未接线（B6） |
| "不要卖仿品/侵权品" | 合规引擎 `complianceMarkets` | 部分支持（关键词检测） |

**SOP 利用率：** ~40%

---

#### CEO Agent（CEO 协调官）/ Finance Agent（财务官）

**执行方式：** LLM 驱动

这两个 Agent 都重度使用 LLM，`systemPrompt` 可以承载卖家的：
- 经营优先级（"利润优先" vs "规模优先"）
- 跨 Agent 协调策略（"定价和广告要协同"）
- 财务指标偏好（"关注毛利率而非营收"）

**SOP 利用率：** ~80%（LLM 天然适合消费自然语言策略）

---

### 6.4 SOP 提取 Schema（每类 Agent 的 LLM 提取规则）

SOP Parser 对每种 Agent 类型使用不同的提取 schema：

```typescript
interface SopExtractionResult {
  goalContext: Record<string, unknown>
  systemPrompt: string | null
  governance: Partial<GovernanceSettings> | null
  warnings: string[]  // SOP 中无法映射的内容，告知卖家
}

// 每类 Agent 的提取指令
const EXTRACTION_SCHEMAS: Record<AgentType, SopExtractionInstruction> = {
  'price-sentinel': {
    extractableParams: [
      { key: 'approvalThresholdPercent', type: 'number', range: [5, 30], description: '价格变动审批阈值百分比' },
      { key: 'pricingStrategy', type: 'enum', values: ['brand_protect', 'competitive', 'aggressive'], description: '定价策略' },
    ],
    systemPromptUseful: false,  // 当前无 LLM 步骤
    governanceKeys: ['priceChangeThreshold'],
  },
  'support-relay': {
    extractableParams: [
      { key: 'autoReplyPolicy', type: 'enum', values: ['auto_reply_non_refund', 'all_manual'], description: '自动回复策略' },
    ],
    systemPromptUseful: true,   // LLM 生成回复，systemPrompt 直接影响语气
    systemPromptHint: '提取品牌调性、客服语气、语言偏好、处理原则等',
    governanceKeys: [],
  },
  'ads-optimizer': {
    extractableParams: [
      { key: 'targetRoas', type: 'number', range: [0.1, 100], description: '目标广告回报率' },
      { key: 'budgetApprovalThresholdUsd', type: 'number', range: [50, 10000], description: '日预算审批美元阈值' },
    ],
    systemPromptUseful: false,
    governanceKeys: ['adsBudgetApproval'],
  },
  'inventory-guard': {
    extractableParams: [
      { key: 'safetyThreshold', type: 'number', range: [0, 1000], description: '安全库存件数' },
      { key: 'replenishApprovalMinUnits', type: 'number', range: [1, 10000], description: '补货审批最小件数' },
      { key: 'timeZone', type: 'string', description: '时区' },
    ],
    systemPromptUseful: false,
    governanceKeys: [],
  },
  'content-writer': {
    extractableParams: [
      { key: 'tone', type: 'enum', values: ['professional', 'casual', 'luxury', 'value'], description: '文案语气' },
      { key: 'maxLength', type: 'number', range: [100, 10000], description: '最大内容长度' },
    ],
    systemPromptUseful: true,   // LLM 生成内容，systemPrompt 直接影响风格
    systemPromptHint: '提取品牌调性、内容风格、SEO 策略、目标受众特征、禁用词汇等',
    governanceKeys: ['newListingApproval'],
  },
  'market-intel': {
    extractableParams: [
      { key: 'platforms', type: 'string[]', description: '监控平台列表' },
      { key: 'maxProducts', type: 'number', range: [1, 500], description: '最大监控商品数' },
    ],
    systemPromptUseful: true,   // LLM 分析竞品
    systemPromptHint: '提取竞品分析关注点、品类偏好、市场定位策略',
    governanceKeys: [],
  },
  'product-scout': {
    extractableParams: [
      { key: 'maxProducts', type: 'number', range: [1, 500], description: '最大扫描商品数' },
    ],
    systemPromptUseful: false,
    governanceKeys: ['newListingApproval'],
  },
  'ceo-agent': {
    extractableParams: [],
    systemPromptUseful: true,
    systemPromptHint: '提取经营优先级、跨 Agent 协调策略、业务目标',
    governanceKeys: [],
  },
  'finance-agent': {
    extractableParams: [],
    systemPromptUseful: true,
    systemPromptHint: '提取财务指标偏好、利润率目标、成本控制策略',
    governanceKeys: [],
  },
}
```

---

### 6.5 API 设计

#### `POST /api/v1/sop/parse` — 解析 SOP（预览，不写入）

```typescript
// Request
{
  agentType: 'price-sentinel',
  sopText: '我做高端护肤品，降价不超过 8%...'
}

// Response
{
  extraction: {
    goalContext: { approvalThresholdPercent: 8, pricingStrategy: 'brand_protect' },
    systemPrompt: null,  // Price Sentinel 无 LLM 步骤
    governance: { priceChangeThreshold: 8 },
    warnings: [
      '「竞品大幅降价我要看」：当前 Price Sentinel 不支持竞品价格联动阈值，此规则暂无法生效',
      '「季末清仓放宽到 15%」：当前不支持季节性阈值覆盖，将使用全年统一阈值 8%',
    ],
  },
}
```

#### `PUT /api/v1/sop/{agentType}` — 保存 SOP + 应用提取结果

```typescript
// Request
{
  sopText: '我做高端护肤品，降价不超过 8%...',
  confirmedGoalContext: { approvalThresholdPercent: 8 },  // 卖家确认/微调后的参数
  confirmedSystemPrompt: null,
  confirmedGovernance: { priceChangeThreshold: 8 },
}

// Response — 写入 tenant_sops + 更新 agents.goal_context/system_prompt + 更新 governance
{ ok: true, appliedTo: { agentIds: ['uuid-xxx'], governanceUpdated: true } }
```

#### `GET /api/v1/sop` — 获取租户所有 SOP

```typescript
// Response
{
  sops: [
    {
      agentType: 'price-sentinel',
      sopText: '...',
      extractedGoalContext: { ... },
      extractedSystemPrompt: null,
      version: 2,
      updatedAt: '2026-03-30T...',
    },
    // ...
  ],
}
```

#### `PUT /api/v1/sop/global` — 全局 SOP（适用于所有 Agent 的经营理念）

```typescript
// Request
{
  sopText: '我们是高端护肤品牌，品牌形象最重要...',
}

// Response — 提取通用 systemPrompt 前缀，追加到所有 LLM Agent 的 systemPrompt
{ ok: true, appliedToAgents: ['content-writer', 'support-relay', 'market-intel', 'ceo-agent', 'finance-agent'] }
```

---

### 6.6 LLM 提取 Prompt 模板

```text
你是一个 SOP 解析专家。用户是一个电商卖家，他用自然语言描述了对 {agentType} Agent 的经营策略。

请从 SOP 中提取以下信息：

1. **结构化参数**（必须严格匹配 schema）：
{extractableParams as JSON schema}

2. **行为指导**（仅当 systemPromptUseful=true 时提取）：
从 SOP 中提取不能用结构化参数表达的品牌调性、语气、策略、偏好等，
合成一段简洁的 system prompt 指导文字。

3. **治理设置**（全局开关类）：
{governanceKeys}

4. **无法映射的内容**：
列出 SOP 中你识别到但当前系统不支持的意图，用中文简述。

SOP 原文：
---
{sopText}
---

请以 JSON 格式返回：
{
  "goalContext": { ... },
  "systemPrompt": "..." | null,
  "governance": { ... } | null,
  "warnings": ["...", ...]
}
```

---

### 6.7 SOP 与 ClipMart 模板的关系

ClipMart 模板已有 `config.agents[].goalContext` + `config.governance` 预设，可以理解为**行业标准 SOP 的结构化版本**：

```
ClipMart 模板 = 行业默认 SOP（结构化、无品牌定制）
卖家自定义 SOP = 个性化经营策略（自然语言，含品牌调性）
```

导入模板后，卖家可以在此基础上编写自己的 SOP 进行覆盖/增强：
1. 导入「Standard Cross-Border」模板 → 获得默认 `goalContext`
2. 在 Agent 详情页编写个性化 SOP → LLM 提取 → 合并覆盖模板默认值

---

### 6.8 实施路径

| 阶段 | 内容 | 依赖 | 估时 |
|------|------|------|------|
| **S1** | `tenant_sops` 表 + 迁移 | packages/db | 0.5d |
| **S2** | SOP Parser Service（`packages/sop/`） | LLM 集成 | 2d |
| **S3** | SOP API（parse + save + list） | S1 + S2 | 1d |
| **S4** | Agent 详情页 SOP 编辑器 UI | S3 + `/agents/[id]` 页面 | 1.5d |
| **S5** | Global SOP + 多 Agent systemPrompt 合并 | S2 | 1d |
| **S6** | Price Sentinel / Ads Optimizer `goalContext` 扩展（新参数） | Agent Runtime | 1d |
| **S7** | `systemPrompt` 注入到所有 LLM Agent 调用链 | Agent Runtime | 1d |

**总计：** ~8d（可与 UI P0 并行，S4 依赖 UI 侧栏 + Agent 页面骨架）

---

## 7. 更新后的 `/agents/[id]` 页面设计

引入 SOP 后，Agent 详情页从「纯参数配置」升级为「SOP 驱动配置」：

### 三个 Tab

**Tab 1: 我的 SOP**（核心入口）
```
┌─────────────────────────────────────────────────────┐
│  📋 定价策略 SOP                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 我做的是高端护肤品，品牌调性很重要。           │    │
│  │ 降价不超过 8%，如果竞品降价超过 20% 我要       │    │
│  │ 亲自看。永远不要主动发起价格战。               │    │
│  │ 季末清仓可以放宽到 15%。                       │    │
│  └─────────────────────────────────────────────┘    │
│                           [解析预览]  [保存并应用]    │
│                                                     │
│  🔧 系统提取的配置（可手动微调）                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ 审批阈值        [■■■■■■■■░░░░░░░] 8%       │    │
│  │ 定价策略        [品牌保护 ▼]                  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ⚠️ 暂不支持的意图                                    │
│  • 「季末清仓放宽到 15%」— 季节性阈值将在后续版本支持│
│  • 「竞品大幅降价我要看」— 竞品联动阈值开发中       │
└─────────────────────────────────────────────────────┘
```

**Tab 2: 工作记录**
- Agent 最近操作时间线（同原设计）

**Tab 3: 高级参数**
- 原始 `goalContext` JSON 编辑器（面向高级用户/开发者）
- `systemPrompt` 原始文本编辑器

### SOP 编辑交互流

```
编写 SOP → [解析预览] → 查看提取结果 + warnings → 可手动微调参数 → [保存并应用]
                                                          │
                                                          ▼
                                              写入 tenant_sops
                                              更新 agents.goal_context
                                              更新 agents.system_prompt
                                              更新 governance_settings
```

---

## 8. 更新后的实施优先级

### P0 — 核心体验（必须先做）

| # | 内容 | 估时 |
|---|------|------|
| 1 | 侧栏导航布局 | 1d |
| 2 | `/dashboard` 经营总览重新设计 | 2d |
| 3 | `/approvals` 审批中心 | 2d |
| 4 | `/agents` Agent 团队列表 | 1d |
| 5 | `/agents/[id]` Agent 详情（参数配置 Tab，SOP Tab 预留） | 1d |

### P0.5 — SOP 引擎（核心差异化）

| # | 内容 | 估时 |
|---|------|------|
| 6 | `tenant_sops` 表 + 迁移 | 0.5d |
| 7 | SOP Parser Service | 2d |
| 8 | SOP API（parse / save / list / global） | 1d |
| 9 | `/agents/[id]` SOP 编辑器 Tab | 1.5d |
| 10 | Agent Runtime `systemPrompt` 注入链 | 1d |
| 11 | `goalContext` schema 扩展（Price Sentinel、Ads Optimizer 新参数） | 1d |

### P1 — 业务可视化

| # | 内容 | 估时 |
|---|------|------|
| 12 | `/products` 商品管理 | 1d |
| 13 | `/orders` 订单概览 | 1d |
| 14 | `/inventory` 库存预警 | 0.5d |
| 15 | `/ads` 广告中心 | 1d |

### P2 — 设置与运维

| # | 内容 | 估时 |
|---|------|------|
| 16 | `/platforms` 平台连接管理 | 1d |
| 17 | `/settings/governance` 治理偏好 | 0.5d |
| 18 | `/settings/billing` 账单与用量 | 0.5d |

### 后端补充项（贯穿各阶段）

| # | 增强 | 关联 |
|---|------|------|
| B1 | 审批 `payload` 人类可读字段 | P0 #3 |
| B2 | `GET /api/v1/approvals` 增加 `action` 筛选 | P0 #3 |
| B3 | Agent 事件人类可读摘要 | P0 #2 |
| B4 | Products/Orders count API | P1 #12, #13 |
| B5 | `adsBudgetApproval` 从 goalContext 读取（替代常量） | P0.5 #11 |
| B6 | `newListingApproval` 接线到 Product Scout | P0.5 #11 |
| B7 | `humanInLoopAgents` 接线到 Agent 运行时 | P0 #5 |

**总估时：** P0 ~7d + P0.5 ~7d + P1 ~3.5d + P2 ~2d = **~19.5d**

---

## 9. 设计语言

- 保持现有 Tailwind 卡片式风格
- 侧栏导航 + 顶栏用户信息
- 状态色：🟢 正常 / 🟡 需注意 / 🔴 异常
- 审批中心使用突出的 CTA 按钮（批准绿色、拒绝红色）
- Agent 卡片使用图标区分类型
- SOP 编辑器使用大文本框 + 右侧实时提取预览面板
- 移动端响应式（侧栏折叠为汉堡菜单）
