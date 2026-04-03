# Phase 5B · 逐日执行计划 · Day-by-Day with Cards

**日期：** 2026-04-01
**周期：** 8 周（4 Sprint × 2 周）
**前序：** Phase 5 最终验收 GO（2026-03-29）
**并行资源：** 2 FTE（FE 1 人 + BE 1 人）
**每 Sprint 可用人日：** 20d（2 人 × 10 工作日）

---

## 优先级排序原则

```
P0 经营数据底座        ← 没数据，Agent Native 改造无米之炊
P0 Phase 5 stub 清障   ← 商业化链路接真线
P1 SOP 策略系统        ← 卖家战略意图进 Agent
P1 Agent Native 改造   ← 从规则脚本变真正 AI Agent
P1 审批产品化          ← 卖家信任 → 逐步交权
P2 广告 Harness 深度   ← Amazon 关键词级操作
P2 账号健康/售后面板   ← 专业卖家高频工作台
```

---

## Sprint 18 · Week 1–2 — 经营数据底座 + Phase 5 清障 + 前端骨架

**目标：** 把数据层从"基础设施指标"升级到"经营真相层"；清掉 Phase 5 遗留 stub；重建前端导航骨架

### Day 1 — Phase 5 stub 清障（阻塞项优先）

> **🃏 CARD-5B-D01-01 · `billing/usage` 接真实数据**
>
> **类型：** 代码变更
> **耗时：** 3h
> **优先级：** 🔴 P0 — 商业化链路必须真实
> **负责：** BE
>
> **操作：**
> 1. `apps/api/src/routes/billing.ts` 的 `GET /api/v1/billing/usage`：
>    - 删除 `usedUsd: 0` 硬编码
>    - 通过 `request.withDb` 查询 `billing_usage_logs` 当月合计
>    - plan 从 `request.auth.plan` 或 tenants 表读取，删除 `x-plan` header fallback
> 2. `GET /api/v1/billing/portal-session`：
>    - 删除 `x-stripe-customer-id` header 读取
>    - 通过 `request.withDb` 从 `tenants` 表查 `stripe_customer_id`
> 3. 补充/更新对应测试
>
> **验收：** `/billing/usage` 返回真实 `usedUsd`；`/portal-session` 从 DB 读 customer ID；现有测试通过

---

> **🃏 CARD-5B-D01-02 · `UserStore` 切到 PostgreSQL**
>
> **类型：** 代码变更
> **耗时：** 3h
> **优先级：** 🔴 P0 — 重启不丢用户数据
> **负责：** BE
>
> **操作：**
> 1. 在 `packages/db/src/schema/` 新增 `users.ts`（`id`, `email`, `password_hash`, `tenant_id`, `role`, `plan`, `company`, `created_at`）
> 2. 创建 migration `0012_users_table.sql`（含 RLS）
> 3. 在 `apps/api/src/routes/auth.ts` 创建 `createDbUserStore()`：实现 `UserStore` 接口，底层用 Drizzle
> 4. `server.ts` 启动时注入 `setUserStore(createDbUserStore())`
> 5. 保留 `createInMemoryUserStore()` 仅用于测试
>
> **验收：** 注册 → 重启 API → 登录成功（数据持久化）；13 个 auth 测试通过

---

> **🃏 CARD-5B-D01-03 · 前端侧栏导航 + 路由分组**
>
> **类型：** 前端重构
> **耗时：** 4h
> **优先级：** 🟡 P1 — 后续所有页面的骨架
> **负责：** FE
>
> **操作：**
> 1. `apps/web/src/app/` 下创建 `(tenant)/` route group
> 2. 将 `dashboard/`、`settings/`、`clipmart/` 迁入 `(tenant)/`
> 3. 创建 `(ops)/` route group（Phase 6 占位）
> 4. 新建 `components/Sidebar.tsx`：Dashboard / 审批 / Agent 团队 / 商品 / 订单 / 广告 / 库存 / 平台 / 设置
> 5. 更新 `layout.tsx` 集成侧栏
> 6. `middleware.ts` 按角色分流（seller → tenant, admin → ops）
>
> **验收：** 登录后看到侧栏导航；seller 无法访问 `(ops)/`

---

### Day 2 — 经营数据表创建 + Console 真实化

> **🃏 CARD-5B-D02-01 · 经营数据聚合表（4 张）**
>
> **类型：** DB migration
> **耗时：** 4h
> **优先级：** 🔴 P0 — 整个 5B 的数据基座
> **负责：** BE
>
> **操作：** 创建 `0013_business_data_tables.sql`
>
> ```sql
> -- 1. 单位经济模型（每日/每 SKU）
> CREATE TABLE unit_economics_daily (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   platform TEXT NOT NULL,
>   product_id TEXT NOT NULL,
>   date DATE NOT NULL,
>   gross_revenue NUMERIC(12,2),
>   net_revenue NUMERIC(12,2),
>   cogs NUMERIC(12,2),
>   platform_fee NUMERIC(12,2),
>   shipping_cost NUMERIC(12,2),
>   ad_spend NUMERIC(12,2),
>   refund_amount NUMERIC(12,2),
>   contribution_margin NUMERIC(12,2),
>   acos NUMERIC(8,4),
>   tacos NUMERIC(8,4),
>   units_sold INTEGER,
>   created_at TIMESTAMPTZ DEFAULT now(),
>   UNIQUE(tenant_id, platform, product_id, date)
> );
>
> -- 2. 在途库存 / 采购单
> CREATE TABLE inventory_inbound_shipments (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   platform TEXT NOT NULL,
>   product_id TEXT NOT NULL,
>   shipment_id TEXT,
>   quantity INTEGER NOT NULL,
>   status TEXT NOT NULL DEFAULT 'in_transit',
>   expected_arrival DATE,
>   supplier TEXT,
>   lead_time_days INTEGER,
>   moq INTEGER,
>   landed_cost_per_unit NUMERIC(10,2),
>   total_cost NUMERIC(12,2),
>   created_at TIMESTAMPTZ DEFAULT now()
> );
>
> -- 3. 账号健康事件
> CREATE TABLE account_health_events (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   platform TEXT NOT NULL,
>   event_type TEXT NOT NULL,
>   severity TEXT NOT NULL DEFAULT 'warning',
>   title TEXT NOT NULL,
>   description TEXT,
>   affected_entity TEXT,
>   resolved_at TIMESTAMPTZ,
>   created_at TIMESTAMPTZ DEFAULT now()
> );
>
> -- 4. 售后案例
> CREATE TABLE service_cases (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   platform TEXT NOT NULL,
>   case_type TEXT NOT NULL,
>   order_id TEXT,
>   product_id TEXT,
>   status TEXT NOT NULL DEFAULT 'open',
>   amount NUMERIC(10,2),
>   customer_message TEXT,
>   agent_response TEXT,
>   escalated BOOLEAN DEFAULT false,
>   created_at TIMESTAMPTZ DEFAULT now(),
>   resolved_at TIMESTAMPTZ
> );
> ```
>
> 每张表启用 `ROW LEVEL SECURITY` + `tenant_isolation` policy。
>
> **验收：** 4 张表存在；RLS 策略生效；Drizzle schema 文件对应创建

---

> **🃏 CARD-5B-D02-02 · Console DataOS/Alerts 接真实数据**
>
> **类型：** 代码变更
> **耗时：** 3h
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `console.ts` 的 `loadDataOsStatus`：尝试通过 DataOS internal API 读取 Event Lake 统计，fallback 到现有 PG 查询
> 2. `GET /api/v1/console/alerts`：从 `account_health_events` 读取未解决事件，替换 `501`
> 3. 补测试
>
> **验收：** `/console/dataos` 优先读 DataOS；`/console/alerts` 返回真实数据而非 501

---

> **🃏 CARD-5B-D02-03 · Dashboard 经营总览页（前端）**
>
> **类型：** 前端新建
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：** 重构 `(tenant)/dashboard/page.tsx`
> - 顶部：待审批数 badge + 快速跳转
> - 左列：Agent 动态摘要（最近 20 条 `agent-events`）
> - 中列：商品/订单/用量指标
> - 右列：平台连接状态 + 库存预警
> - 消费现有 API：`/console/overview` + `/approvals?status=pending` + `/agent-events?limit=20`
>
> **验收：** Dashboard 从"基础设施视角"变成"经营总览视角"

---

### Day 3 — 利润驾驶舱 API + 前端

> **🃏 CARD-5B-D03-01 · 利润驾驶舱 API**
>
> **类型：** 新建路由
> **耗时：** 4h
> **优先级：** 🔴 P0 — 经营可视化核心
> **负责：** BE
>
> **操作：** `apps/api/src/routes/dashboard.ts` 新增：
> - `GET /api/v1/dashboard/overview`：增加 `grossRevenue`、`netRevenue`、`contributionMargin`、`adSpend`、`tacos`、`refundRate`、`feeRate` 字段（从 `unit_economics_daily` 聚合）
> - `GET /api/v1/finance/unit-economics?range=7d|30d`：按 SKU 维度返回利润明细
> - `GET /api/v1/inventory/alerts`：从 `inventory_inbound_shipments` + 现有库存数据计算断货预测
>
> **验收：** 利润字段非零（有种子数据时）；API schema 含 OpenAPI 定义

---

> **🃏 CARD-5B-D03-02 · 利润驾驶舱前端**
>
> **类型：** 前端新建
> **耗时：** 4h
> **优先级：** 🔴 P0
> **负责：** FE
>
> **操作：** 在 Dashboard 页面新增利润驾驶舱区域
> - 销售额拆分卡片：`grossRevenue` / `netRevenue`
> - 利润层：`contributionMargin` / `profitAfterAds`
> - 广告层：`acos` / `tacos`
> - 损耗层：`refundRate` / `feeRate`
> - 现金效率：`inventoryDays` / `cashTiedInInventory`
> - 使用 Tailwind 卡片式布局，数据从 `/dashboard/overview` 获取
>
> **验收：** 卖家登录后首屏能看到利润和费用数据

---

### Day 4 — 审批中心 API 增强 + 前端骨架

> **🃏 CARD-5B-D04-01 · 审批 API 增强**
>
> **类型：** 代码变更
> **耗时：** 4h
> **优先级：** 🟡 P1 — 治理产品化
> **负责：** BE
>
> **操作：**
> 1. `apps/api/src/routes/approvals.ts`：
>    - `GET /api/v1/approvals` 增加 `action` query 参数筛选
>    - 审批 payload 增加 `displayTitle` / `displayDescription` 字段（由 Agent 写入时填充）
>    - 审批 payload 增加 `impactPreview` / `expireAt` / `rollbackPlan` 字段
>    - `PATCH /api/v1/approvals/:id/resolve` 支持 `resolution` 扩展：`approve` / `reject` / `approve_with_limit` / `approve_and_observe`
> 2. 新增 `POST /api/v1/approvals/batch-resolve`：批量审批
> 3. 新增审批过期 cron：`expireAt` 到期的审批自动标记 `expired`
>
> **验收：** 按 action 筛选正常；批量审批正常；过期逻辑正确

---

> **🃏 CARD-5B-D04-02 · 审批中心前端**
>
> **类型：** 前端新建
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：** 新建 `(tenant)/approvals/page.tsx`
> - 审批列表：action 类型 icon + Agent 名 + `displayTitle` + `displayDescription` + 时间
> - 每张审批卡片展示 `impactPreview`（如有）
> - 一键批准 / 拒绝按钮
> - 筛选：状态（pending/approved/rejected/expired）、Agent、action 类型
> - 批量操作 checkbox + 批量批准/拒绝
>
> **验收：** 审批中心可查看、筛选、单条和批量操作

---

### Day 5 — Agent 团队页 + 经营目标中心

> **🃏 CARD-5B-D05-01 · Agent 团队页前端**
>
> **类型：** 前端新建
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/agents/page.tsx`：9 个 Agent 卡片网格（名称、角色描述、状态指示灯、最近执行时间、待审批数）
> - `(tenant)/agents/[id]/page.tsx`：三个 Tab
>   - **工作记录**：Agent 事件时间线（`/agent-events?agentId=X`）
>   - **SOP**：占位（Sprint 19 实现 SOP 编辑器后接入）
>   - **高级参数**：goalContext / systemPrompt 只读展示（开发者模式可编辑）
>
> **验收：** 可浏览 9 个 Agent；点击进入详情页查看工作记录

---

> **🃏 CARD-5B-D05-02 · 经营目标中心 API + 前端**
>
> **类型：** 新建
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `packages/db/src/schema/` 新增 `tenant-goals.ts`
>    ```sql
>    CREATE TABLE tenant_goals (
>      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>      tenant_id UUID NOT NULL REFERENCES tenants(id) UNIQUE,
>      growth_mode TEXT DEFAULT 'daily',
>      min_margin_percent NUMERIC(5,2) DEFAULT 15,
>      min_contribution_profit_usd NUMERIC(10,2),
>      inventory_strategy TEXT DEFAULT 'balanced',
>      ads_lifecycle_strategy TEXT DEFAULT 'daily',
>      updated_at TIMESTAMPTZ DEFAULT now()
>    );
>    ```
> 2. `GET/PUT /api/v1/settings/goals`：读写经营目标
> 3. FE 端：`(tenant)/settings/goals/page.tsx` — 增长模式选择 + 利润护栏 slider + 库存策略 + 广告生命周期策略
>
> **验收：** 卖家可配置 growth/profit/launch/clearance 等经营目标

---

### Day 6–7 — 业务页面（商品/订单/广告/库存/平台）

> **🃏 CARD-5B-D06-01 · `/products` + `/orders` 页面**
>
> **类型：** 前端新建
> **耗时：** 2d (FE)
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/products/page.tsx`：商品列表（消费 `GET /api/v1/products`）+ 同步按钮（`POST /api/v1/products/sync`）
> - `(tenant)/orders/page.tsx`：订单列表（消费 `GET /api/v1/orders`）+ 平台筛选
> - 两个页面均支持分页 + 搜索
>
> **验收：** 商品和订单页面可浏览、搜索、按平台筛选

---

> **🃏 CARD-5B-D06-02 · 经营 Port/Harness 接口设计文档**
>
> **类型：** 设计文档
> **耗时：** 1d (BE)
> **优先级：** 🔴 P0 — Stream D 的设计基座
> **负责：** BE
>
> **操作：** 定义 Phase 5B 新增的 4 个经营能力 Port 接口：
> ```typescript
> interface UnitEconomicsPort {
>   getSkuEconomics(tenantId: string, platform: string, productId: string, range: DateRange): Promise<UnitEconomics>
>   getDailyOverview(tenantId: string, range: DateRange): Promise<DailyOverview>
> }
>
> interface InventoryPlanningPort {
>   getInboundShipments(tenantId: string): Promise<InboundShipment[]>
>   getReplenishmentSuggestions(tenantId: string): Promise<ReplenishmentSuggestion[]>
> }
>
> interface AccountHealthPort {
>   getHealthSummary(tenantId: string, platform: string): Promise<AccountHealthSummary>
>   getListingIssues(tenantId: string): Promise<ListingIssue[]>
> }
>
> interface ServiceOpsPort {
>   getCases(tenantId: string, filters?: CaseFilters): Promise<ServiceCase[]>
>   getRefundSummary(tenantId: string, range: DateRange): Promise<RefundSummary>
> }
> ```
>
> **验收：** 接口定义写入 `packages/harness/src/` 或 `packages/shared/src/`；Agent 无平台 SDK 直调回退

---

> **🃏 CARD-5B-D07-01 · `/ads` + `/inventory` + `/platforms` 页面**
>
> **类型：** 前端新建
> **耗时：** 2d (FE, Day 7 延续)
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/ads/page.tsx`：广告活动列表 + 指标概览（`GET /api/v1/ads/campaigns` + `/ads/performance`）
> - `(tenant)/inventory/page.tsx`：库存列表 + 预警（`GET /api/v1/inventory` + `/inventory/alerts`）
> - `(tenant)/platforms/page.tsx`：平台连接状态 + OAuth 入口（`GET /api/v1/platform-credentials`）
>
> **验收：** 广告/库存/平台页面可浏览

---

### Day 8 — 设置增强 + Drizzle schema 对齐

> **🃏 CARD-5B-D08-01 · 治理设置接线**
>
> **类型：** 代码变更
> **耗时：** 4h
> **优先级：** 🟡 P1 — Constitution §6.2 租户级配置
> **负责：** BE
>
> **操作：** 当前 `tenant_governance_settings` 中三个字段未接线到 Agent Runtime：
>
> | 字段 | 当前状态 | 修复 |
> |------|---------|------|
> | `adsBudgetApproval` | 存了但 Ads Optimizer 用常量 | Agent 从 goalContext 读取 |
> | `newListingApproval` | 存了但 Product Scout 不检查 | Agent 执行时检查 |
> | `humanInLoopAgents` | 存了但无 Agent 消费 | Agent pre-flight 检查 |
>
> 1. `packages/agent-runtime/src/context.ts`：`AgentContext` 增加 `getGovernanceSettings()` 方法
> 2. 各 Agent `run()` 函数中读取对应治理设置
> 3. 补测试
>
> **验收：** 修改治理设置后，Agent 行为随之改变

---

> **🃏 CARD-5B-D08-02 · 设置页增强前端**
>
> **类型：** 前端变更
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/settings/governance/page.tsx`：治理偏好面板
>   - 调价阈值 slider（5%–30%）
>   - 广告审批额度输入
>   - 新品上架审批开关
>   - humanInLoopAgents 多选
> - `(tenant)/settings/billing/page.tsx`：用量 + Stripe 门户
>
> **验收：** 治理设置可编辑保存

---

### Day 9 — 经营数据种子 + 接线验证

> **🃏 CARD-5B-D09-01 · 经营数据种子脚本**
>
> **类型：** 新建脚本
> **耗时：** 3h
> **优先级：** 🔴 P0 — 开发期间需要数据验证 UI
> **负责：** BE
>
> **操作：** 创建 `scripts/seed-business-data.ts`
> - 为测试租户生成 30 天 `unit_economics_daily`（含利润、费用、退款）
> - 生成若干 `inventory_inbound_shipments`（在途/已到）
> - 生成若干 `account_health_events`（违规/警告/已解决）
> - 生成若干 `service_cases`（退款/退货/消息）
>
> **验收：** `pnpm exec tsx scripts/seed-business-data.ts <tenant-uuid>` → Dashboard 利润驾驶舱有数据

---

> **🃏 CARD-5B-D09-02 · Sprint 18 中间联调**
>
> **类型：** 联调
> **耗时：** 4h
> **优先级：** 🟡
> **负责：** FE + BE
>
> **操作：** FE 与 BE 端到端联调：
> 1. 注册新用户 → Onboarding → Dashboard 经营总览
> 2. 利润驾驶舱数据展示
> 3. 审批中心 CRUD
> 4. Agent 团队页浏览
> 5. 商品/订单/广告/库存/平台 5 个业务页面
>
> **验收：** 全链路走通无 500 错误

---

### Day 10 — Sprint 18 回归 + 检查点

> **🃏 CARD-5B-D10-01 · Sprint 18 最终回归**
>
> **类型：** 验证
> **耗时：** 1d
> **优先级：** 🔴
> **负责：** FE + BE
>
> **检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `pnpm typecheck` | 全仓通过 |
> | 2 | `pnpm lint` | 全仓通过 |
> | 3 | `pnpm test` | 全仓通过 |
> | 4 | 4 张经营数据表存在 + RLS | migration 应用成功 |
> | 5 | `billing/usage` 返回真实用量 | stub 已清 |
> | 6 | `UserStore` 持久化 | 重启不丢数据 |
> | 7 | Console alerts 非 501 | 真实数据 |
> | 8 | 侧栏导航 + 路由分组 | `(tenant)` / `(ops)` |
> | 9 | 利润驾驶舱有数据 | 种子数据可见 |
> | 10 | 审批中心可操作 | 筛选 + 批量 |

**Sprint 18 交付物：**
- ✅ Phase 5 stub 全部清障
- ✅ 4 张经营数据表 + RLS
- ✅ 利润驾驶舱 API + 前端
- ✅ 审批中心增强（payload + 批量 + 过期）
- ✅ 前端侧栏 + 路由分组 + 7 个业务页面骨架
- ✅ 经营目标中心
- ✅ 治理设置接线

---

## Sprint 19 · Week 3–4 — SOP 策略系统 + 场景化 + Prompt 栈

**目标：** 卖家策略和经营目标做对；锁死 prompt 优先级栈；场景化 SOP 创建体验上线

### Day 11 — SOP 数据模型 + 场景表

> **🃏 CARD-5B-D11-01 · `tenant_sops` + `tenant_sop_scenarios` + 模板表**
>
> **类型：** DB migration
> **耗时：** 4h
> **优先级：** 🔴 P0 — SOP 系统数据基座
> **负责：** BE
>
> **操作：** 创建 `0014_sop_tables.sql`
>
> ```sql
> CREATE TABLE tenant_sops (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   scope TEXT NOT NULL,
>   platform TEXT,
>   entity_type TEXT,
>   entity_id TEXT,
>   scenario_id UUID,
>   scenario TEXT,
>   sop_text TEXT NOT NULL,
>   extracted_goal_context JSONB,
>   extracted_system_prompt TEXT,
>   extracted_governance JSONB,
>   extraction_warnings JSONB,
>   status TEXT NOT NULL DEFAULT 'active',
>   effective_from TIMESTAMPTZ,
>   effective_to TIMESTAMPTZ,
>   previous_version_id UUID,
>   version INTEGER NOT NULL DEFAULT 1,
>   created_at TIMESTAMPTZ DEFAULT now(),
>   updated_at TIMESTAMPTZ DEFAULT now(),
>   UNIQUE(tenant_id, scope, platform, entity_type, entity_id, version)
> );
>
> CREATE TABLE tenant_sop_scenarios (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   tenant_id UUID NOT NULL REFERENCES tenants(id),
>   scenario_name TEXT,
>   scenario TEXT NOT NULL,
>   platform TEXT,
>   entity_type TEXT,
>   entity_id TEXT,
>   effective_from TIMESTAMPTZ,
>   effective_to TIMESTAMPTZ,
>   status TEXT NOT NULL DEFAULT 'active',
>   version INTEGER NOT NULL DEFAULT 1,
>   previous_version_id UUID,
>   created_at TIMESTAMPTZ DEFAULT now(),
>   updated_at TIMESTAMPTZ DEFAULT now(),
>   UNIQUE(tenant_id, scenario, platform, entity_type, entity_id, version)
> );
>
> CREATE TABLE sop_scenario_templates (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   scenario TEXT NOT NULL,
>   scope TEXT NOT NULL,
>   platform TEXT,
>   default_sop_text TEXT NOT NULL,
>   default_goal_context JSONB NOT NULL,
>   editable_fields JSONB NOT NULL,
>   locked_fields JSONB NOT NULL,
>   UNIQUE(scenario, scope, platform)
> );
> ```
>
> 每张含 `tenant_id` 的表启用 RLS。
>
> **验收：** 3 张表 + RLS + Drizzle schema 文件

---

> **🃏 CARD-5B-D11-02 · SOP 动态作用域规则实现**
>
> **类型：** 新建代码
> **耗时：** 4h
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：** 在 `packages/sop/src/` 创建 `sop-resolver.ts`：
> ```typescript
> async function resolveSop(agentScope: string, ctx: AgentContext): Promise<ResolvedSop | null>
> ```
> 实现优先级规则：
> 1. entity > platform > global（窄优先）
> 2. 有时间窗 > 无时间窗（限时优先）
> 3. 同层同时间窗 → 最新版本
> 4. 窄层 goalContext 完全覆盖宽层（不合并）
> 5. SOP 过期自动 archived → 回落下一优先级
>
> **验收：** 单元测试覆盖 5 条规则 + 边界情况

---

### Day 12 — SOP Parser Service

> **🃏 CARD-5B-D12-01 · SOP Parser（LLM 驱动提取）**
>
> **类型：** 新建包
> **耗时：** 1d (BE)
> **优先级：** 🔴 P0 — SOP 的核心引擎
> **负责：** BE
>
> **操作：** `packages/sop/src/sop-parser.ts`
>
> 1. 定义每个 Agent 的 extraction schema（可提取的参数 + 类型 + 范围）
> 2. LLM Prompt 模板：提取结构化参数 + 行为指导 + 治理设置 + 无法映射的 warnings
> 3. 输出三层：`goalContext` (JSON) + `systemPrompt` (text) + `governance` (partial)
> 4. **安全检查**：拒绝包含"忽略以上规则"/"取消所有审批"/"override constitution"的 SOP 输入
> 5. 无法映射的内容返回 `extraction_warnings`
>
> **关键：** Parser 不做决策——它只把自然语言转成结构化参数。决策由 Agent 在 `reason()` 阶段完成。
>
> **验收：** 输入"新品上架期间允许定价低于竞品5-10%，最低利润率5%" → 输出 `{ pricingStrategy: 'aggressive-match', minMarginPercent: 5 }`；恶意输入被拒绝

---

### Day 13 — 场景模板引擎 + 展开逻辑

> **🃏 CARD-5B-D13-01 · 12 套场景模板种子 + 展开引擎**
>
> **类型：** 新建代码 + 种子数据
> **耗时：** 1d (BE)
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：**
> 1. `packages/sop/src/scenario-templates.ts`：4 场景 × 3 Agent = 12 套模板
>
> | scenario \ scope | price-sentinel | ads-optimizer | inventory-guard |
> |-----------------|----------------|---------------|-----------------|
> | `launch` | 激进跟价 minMargin=5% | 高预算宽匹配 | 小批量快补 |
> | `defend` | 守利润底线 minMargin=15% | 精准投放控浪费 | 正常节奏 |
> | `clearance` | 低于成本可卖 | 停广告/仅品牌词 | 不补货消库存 |
> | `daily` | 平衡增长与利润 | 稳定 ROAS | 常规安全库存 |
>
> 2. `packages/sop/src/scenario-expander.ts`：展开逻辑
>    - 读取模板 → 合并卖家修改 → locked_fields 保护 → 调用 SOP Parser → 写入 `tenant_sops`
>    - 发射 `sop.scenario.created` 事件
>
> 3. `scripts/seed-sop-templates.ts`：种子脚本
>
> **验收：** 12 套模板写入 `sop_scenario_templates`；展开为 `tenant_sops` 正确

---

### Day 14 — SOP API（场景级 + 原子级）

> **🃏 CARD-5B-D14-01 · SOP API 7+5 条路由**
>
> **类型：** 新建路由
> **耗时：** 1d (BE)
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：** `apps/api/src/routes/sop.ts`
>
> **场景级 API（卖家主入口）：**
> ```
> POST /api/v1/sop/scenarios                — 创建场景（自动展开）
> GET  /api/v1/sop/scenarios                — 获取所有场景
> GET  /api/v1/sop/scenarios/:id            — 场景详情
> PUT  /api/v1/sop/scenarios/:id            — 更新场景
> POST /api/v1/sop/scenarios/:id/activate   — 启用
> POST /api/v1/sop/scenarios/:id/archive    — 归档
> POST /api/v1/sop/scenarios/:id/duplicate  — 复制
> ```
>
> **原子级 API（高级用户）：**
> ```
> POST /api/v1/sop/parse                    — 解析预览
> PUT  /api/v1/sop/{scope}                  — 保存+应用
> GET  /api/v1/sop                          — 获取所有 SOP
> POST /api/v1/sop/{scope}/activate         — 启用版本
> POST /api/v1/sop/{scope}/rollback         — 回滚
> ```
>
> **模板 API：**
> ```
> GET  /api/v1/sop/templates                — 获取所有模板
> GET  /api/v1/sop/templates/:scenario      — 特定场景模板
> ```
>
> 所有路由含 OpenAPI schema。
>
> **验收：** 创建场景 → 展开为多条 SOP → 查询正确；回滚正确

---

### Day 15 — `buildSystemPrompt()` L0-L4 + Agent Runtime 消费 SOP

> **🃏 CARD-5B-D15-01 · Prompt 优先级栈 L0-L4**
>
> **类型：** 新建代码
> **耗时：** 4h
> **优先级：** 🔴 P0 — Phase 6 Autonomy Constitution 的锚点
> **负责：** BE
>
> **操作：** `packages/agent-runtime/src/prompt-stack.ts`
>
> ```typescript
> function buildSystemPrompt(ctx: AgentContext, sop: ExtractedSop | null): ChatMessage[] {
>   return [
>     {
>       role: 'system',
>       content: [
>         SYSTEM_CONSTITUTION_PROMPT,        // L0 — 永远最前，不可覆盖
>         // L1 — Phase 6 插入 AUTONOMY_CONSTITUTION_PROMPT
>         getPlatformPolicyPrompt(ctx),      // L2 — 平台级硬限制
>       ].filter(Boolean).join('\n\n---\n\n'),
>     },
>     {
>       role: 'user',
>       content: [
>         sop?.extracted_system_prompt,      // L3 — 租户 SOP（动态）
>         // L4 — task-specific prompt 由 Agent reason() 自生成
>       ].filter(Boolean).join('\n\n'),
>     },
>   ]
> }
> ```
>
> **关键约束：** Constitution 在 `system` message，SOP 在 `user` message，二者物理隔离。
>
> **验收：** L0 永远在输出最前；SOP 不在 system message 中

---

> **🃏 CARD-5B-D15-02 · Agent Runtime 消费 SOP**
>
> **类型：** 代码变更
> **耗时：** 4h
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：**
> 1. Agent `gather()` 阶段调用 `resolveSop(agentScope, ctx)`
> 2. 读取到的 SOP 的 `extracted_goal_context` 注入到 Agent 决策输入
> 3. 读取到的 `extracted_system_prompt` 通过 `buildSystemPrompt()` 注入 LLM 调用
> 4. Global SOP 的 systemPrompt 作为所有 LLM Agent 的前缀
> 5. SOP Parser 拒绝与 §5.2/§5.4 冲突的内容
>
> **验收：** 设置 SOP "最低利润率 20%" → Price Sentinel 的 LLM 调用包含此约束

---

### Day 16–17 — 场景化前端 + 库存/服务/账号健康页面

> **🃏 CARD-5B-D16-01 · 场景化创建向导前端**
>
> **类型：** 前端新建
> **耗时：** 2d (FE)
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/settings/sop/page.tsx`：场景管理视图（活跃/即将过期/已归档卡片列表）
> - 创建向导 4 步：
>   1. **选择场景** — 6 张卡片（launch/scale/defend/clearance/promotion/daily）
>   2. **选择范围** — 平台 + 对象类型 + 生效时间 + 场景名称
>   3. **配置策略** — 基于模板预填，展示各 Agent 策略文本和可编辑参数；`locked_fields` 灰显
>   4. **解析预览** — 展示每个 Agent 的 goalContext 提取结果和 warnings → 确认保存
>
> **验收：** 可走完创建向导；保存后 `tenant_sop_scenarios` 有记录

---

> **🃏 CARD-5B-D17-01 · `/inventory` 增强 + `/service` + `/account-health` 骨架**
>
> **类型：** 前端 + 后端
> **耗时：** 1d (FE) + 0.5d (BE API)
> **优先级：** 🟡 P1
> **负责：** FE + BE
>
> **操作：**
> - `(tenant)/inventory/page.tsx` 增强：可售 + 在途 + 断货预测 + 建议补货金额
> - `(tenant)/service/page.tsx`：消息线程 + 退款/退货案例 + 人工接管状态
> - `(tenant)/account-health/page.tsx`：违规 + Listing issues + Buy Box 丢失
> - BE 端新增 3 个路由：`GET /api/v1/service/cases`、`GET /api/v1/account-health`、`GET /api/v1/inventory/inbound`
>
> **验收：** 3 个页面可浏览种子数据

---

### Day 18–19 — 经营目标结构化解析 + 经营数据聚合层

> **🃏 CARD-5B-D18-01 · 经营目标结构化注入 Agent**
>
> **类型：** 代码变更
> **耗时：** 1d (BE)
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `tenant_goals` 的经营模式 schema 转化为 Agent `goalContext` 字段
> 2. `profit-first` → minMarginPercent 提高、广告收缩
> 3. `launch` → minMarginPercent 放宽、广告激进
> 4. `clearance` → 接受亏损、停广告、不补货
> 5. 回写到 Price / Ads / Inventory 三个 Agent 的 `goalContext`
>
> **验收：** 切换经营模式后，Agent 行为相应变化

---

> **🃏 CARD-5B-D19-01 · 经营数据聚合层实现**
>
> **类型：** 新建代码
> **耗时：** 1d (BE)
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `UnitEconomicsPort` 实现：从 `unit_economics_daily` 聚合
> 2. `InventoryPlanningPort` 实现：从 `inventory_inbound_shipments` + 现有库存数据
> 3. `AccountHealthPort` 实现：从 `account_health_events`
> 4. `ServiceOpsPort` 实现：从 `service_cases`
> 5. 注入到 `AgentContext` 供 Agent `gather()` 阶段使用
>
> **验收：** Agent 可通过 Port 读取经营数据

---

### Day 20 — Sprint 19 回归 + 检查点

> **🃏 CARD-5B-D20-01 · Sprint 19 最终回归**
>
> **类型：** 验证
> **耗时：** 1d
>
> **检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `pnpm typecheck && pnpm lint && pnpm test` | 全绿 |
> | 2 | SOP 3 张表 + RLS | 存在且策略生效 |
> | 3 | 12 套场景模板种子 | `sop_scenario_templates` 有 12 条 |
> | 4 | 场景创建 → 展开 → 查询 | 场景 API 全链路 |
> | 5 | `buildSystemPrompt()` L0-L4 | Constitution 在 system，SOP 在 user |
> | 6 | SOP Parser 拒绝恶意输入 | "取消所有审批" 被拒 |
> | 7 | 场景化前端向导 | 4 步可走完 |
> | 8 | 经营数据 Port 注入 AgentContext | Agent 可读利润/库存/健康数据 |
> | 9 | 经营目标结构化注入 | 切换模式 Agent 行为变化 |
> | 10 | `/inventory` + `/service` + `/account-health` | 骨架页面可浏览 |

**Sprint 19 交付物：**
- ✅ SOP 策略系统完整落地
- ✅ 场景化创建向导（4 步）
- ✅ 12 套预置模板
- ✅ `buildSystemPrompt()` L0-L4 分层
- ✅ SOP Parser + 安全检查
- ✅ 经营数据 Port 聚合层
- ✅ 经营目标结构化注入

---

## Sprint 20 · Week 5–6 — Agent Native 改造 + 审批渐进

**目标：** 3 个高频经营 Agent 升级为真正的 AI Agent；审批系统支持模式渐进

### Day 21 — 统一决策管线抽象

> **🃏 CARD-5B-D21-01 · `DecisionPipeline` 接口 + 自主降级护栏**
>
> **类型：** 新建代码
> **耗时：** 1d (BE)
> **优先级：** 🔴 P0 — Agent Native 改造的基石
> **负责：** BE
>
> **操作：** `packages/agent-runtime/src/decision-pipeline.ts`
>
> ```typescript
> interface DecisionPipeline<TInput, TDecision> {
>   gather(ctx: AgentContext): Promise<DecisionContext>
>   reason(ctx: AgentContext, context: DecisionContext): Promise<TDecision[]>
>   govern(ctx: AgentContext, decisions: TDecision[]): Promise<GovernedDecision<TDecision>[]>
>   execute(ctx: AgentContext, governed: GovernedDecision<TDecision>[]): Promise<void>
>   remember(ctx: AgentContext, decisions: TDecision[], results: unknown): Promise<void>
> }
> ```
>
> **自主降级护栏（`decision-degradation.ts`）：**
> - 利润数据缺失 → 禁止自动调价/加预算，只允许发建议
> - 账户健康异常 → 收缩高风险动作
> - 现金流紧张 → 只输出优先级排序，不生成大额采购建议
>
> **验收：** 接口定义 + 降级逻辑 + 单元测试

---

### Day 22–24 — Price Sentinel 五阶段改造

> **🃏 CARD-5B-D22-01 · Price Sentinel → 智能定价顾问**
>
> **类型：** 代码重构
> **耗时：** 3d (BE)
> **优先级：** 🔴 P0 — 最核心 Agent
> **负责：** BE
>
> **Day 22 — gather() + reason()：**
> 1. `gather()`：
>    - 从各平台 Harness 拉取商品当前价格
>    - 从 DataOS Feature Store 读取 `conv_rate_7d`、`sales_velocity`、`competitor_prices`
>    - 从 `unit_economics_daily` 读取利润/费用
>    - 从 DataOS `recallMemory('price-sentinel', { productId })` 回忆历史决策
>    - 读取 SOP（通过 `resolveSop`）
> 2. `reason()`：
>    - 用 `claude-haiku-4-5` 批量分析全部商品
>    - 输出 structured JSON：每个商品的 `proposedPrice` / `action(hold/adjust)` / `reason` / `confidence` / `expectedMarginDelta`
>
> **Day 23 — govern() + execute()：**
> 3. `govern()`：
>    - Constitution §5.2 安全网：`|delta%| > threshold` → `requires_approval`
>    - `minMarginPercent` / `minContributionProfitUsd` 硬护栏
>    - 利润数据缺失 → 自动降级为 `requires_approval`
> 4. `execute()`：
>    - `auto_execute` → Harness `updatePrice()`
>    - `requires_approval` → `requestApproval()` 带 LLM 生成的业务分析 reason
>    - 审批 payload 含 `displayTitle`、`impactPreview`、`rollbackPlan`
>
> **Day 24 — remember() + 测试：**
> 5. `remember()`：
>    - `recordMemory()`：记录决策上下文和行动
>    - 7 天后 `writeOutcome()`：追踪调价后转化率/利润变化
> 6. 完整测试套件：LLM mock + DataOS mock + Harness mock
>
> **验收：**
> - Price Sentinel 自主扫描生成建议（不再依赖外部 proposals）
> - 审批 reason 是业务语言，不是"delta -16.67% exceeds 15%"
> - 利润数据缺失时自动降级
> - 单 Agent 月 LLM 成本估算 < $5

---

### Day 25–26 — Ads Optimizer 五阶段改造

> **🃏 CARD-5B-D25-01 · Ads Optimizer → 智能广告策略师**
>
> **类型：** 代码重构
> **耗时：** 2d (BE)
> **优先级：** 🔴 P0
> **负责：** BE
>
> **Day 25 — gather() + reason()：**
> 1. `gather()`：
>    - 广告数据 + 关联商品特征 + 单位经济模型
>    - 从 `tenant_goals` 读取生命周期目标（launch/defend/clearance）
>    - 从 DataOS `recallMemory('ads-optimizer', { campaignId })` 回忆历史
> 2. `reason()`：
>    - LLM (claude-haiku-4-5) 输出 4 种决策：`increase` / `decrease` / `pause` / `maintain`
>    - 每条建议含 `lifecycleObjective`、`inventoryConstraint`、`expectedTacosDelta`
>
> **Day 26 — govern() + execute() + remember() + 测试：**
> 3. `govern()`：日预算变动 >30% 需审批 + 绝对值 >$500 需审批 + 低库存时收缩
> 4. `execute()`：通过 Harness 操作 + 审批 payload 含生命周期解释
> 5. `remember()`：3 天后 writeOutcome（ROAS/CPA 变化）
> 6. 测试套件
>
> **验收：** Ads Optimizer 能做出加/减/暂停/维持 4 种决策

---

### Day 27–28 — Inventory Guard 改造 + 审批模式渐进

> **🃏 CARD-5B-D27-01 · Inventory Guard → 智能库存管家**
>
> **类型：** 代码重构
> **耗时：** 1.5d (BE)
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：**
> 1. `gather()`：+ 在途库存 + 交期 + MOQ + 落地成本 + 销售速度
> 2. `reason()`：LLM 计算断货预测 + 智能补货量 + 采购优先级 + `expectedStockoutDate`
> 3. `govern()`：总补货金额 > 月预算 X% → approval + 现金流压力校验
> 4. `execute()`：审批含 `suggestedPoQty`、`cashRequired`、`leadTimeDays`
> 5. `remember()`：到货后 writeOutcome（断货是否避免、资金占用是否超预算）
>
> **验收：** 补货建议含交期/MOQ/现金需求；不再是 `safety×2 - qty` 固定公式

---

> **🃏 CARD-5B-D28-01 · 审批模式渐进机制**
>
> **类型：** 新建代码
> **耗时：** 1d (BE)
> **优先级：** 🟡 P1 — Phase 6 自治的前置
> **负责：** BE
>
> **操作：**
> 1. `tenant_governance_settings` 增加 `approval_mode` 字段：`approval_required`（默认）/ `approval_informed`
> 2. API 层 `PUT /api/v1/settings/governance`：对 `mode: 'autonomous'` 直接 400
> 3. 审批 payload 增加 `autoApprovable` + `autoApproveReason` 字段
> 4. Agent 在安全网范围内 + confidence > 0.9 时标记 `autoApprovable: true`
> 5. `approval_informed` 模式下：Agent 自动执行 + 事后通知 + 48h 可回滚
> 6. Dashboard 暴露自治成熟度指标：`approvalRequiredRate` / `approvalAdoptionRate` / `rollbackRate`
>
> **验收：** 切换到 `approval_informed` 后，安全范围内的决策自动执行 + 通知

---

### Day 29 — 审批 payload 展示升级 + 事件兼容

> **🃏 CARD-5B-D29-01 · 审批 payload 展示组件升级（前端）**
>
> **类型：** 前端变更
> **耗时：** 1d (FE)
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - 审批卡片展示 LLM 生成的 `displayTitle` + `displayDescription`
> - `impactPreview` 区域：预计利润影响、转化率预测
> - `rollbackPlan` 区域：出错如何回滚
> - `similarPastDecisions` 区域：历史相似决策效果
> - `expireAt` 倒计时
> - `autoApprovable` 标记 badge
> - 审批模式渐进 UI：`approval_informed` 切换 + 自治成熟度指标面板
>
> **验收：** 审批卡片从"纯数字"变成"可理解的业务建议"

---

> **🃏 CARD-5B-D29-02 · Phase 6 兼容事件字段 + Prometheus 指标**
>
> **类型：** 代码变更
> **耗时：** 0.5d (BE)
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> - `agent.decision.made` payload 增加 `confidence` + `metrics.gmvImpact` + `metrics.marginImpact` + `scenarioId?`
> - Prometheus 暴露：`harness_api_error_rate` / `agent_decision_quality_score` / `tenant_gmv_daily` / `sop_scenario_active_count`
>
> **验收：** 事件 payload 含 Phase 6 兼容字段

---

### Day 30 — Sprint 20 回归

> **🃏 CARD-5B-D30-01 · Sprint 20 最终回归**
>
> **类型：** 验证
> **耗时：** 1d
>
> **检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `pnpm typecheck && pnpm lint && pnpm test` | 全绿 |
> | 2 | Price Sentinel 自主生成调价建议 | 不依赖外部 proposals |
> | 3 | Ads Optimizer 4 种决策 | 加/减/暂停/维持 |
> | 4 | Inventory Guard 含交期/MOQ/现金 | 非固定公式 |
> | 5 | 审批 reason 是业务语言 | LLM 生成 |
> | 6 | 利润数据缺失自动降级 | 只建议不执行 |
> | 7 | Decision Memory 使用 | recall + record + outcome |
> | 8 | `approval_informed` 模式 | 自动执行 + 通知 |
> | 9 | Constitution §5.2 门控仍生效 | >15% 仍需审批 |
> | 10 | 单 Agent 月 LLM 成本 < $5 | 批量推理 Haiku |

**Sprint 20 交付物：**
- ✅ `DecisionPipeline` 统一五阶段抽象
- ✅ Price Sentinel 智能定价顾问
- ✅ Ads Optimizer 智能广告策略师
- ✅ Inventory Guard 智能库存管家
- ✅ 审批模式渐进（required → informed）
- ✅ 审批 payload 产品化
- ✅ Phase 6 兼容事件字段

---

## Sprint 21 · Week 7–8 — 广告 Harness 深度 + 账号健康/售后 + 结果回写

**目标：** Amazon SP 关键词级操作；账号健康与售后工作台落地；经营成效可衡量

### Day 31–32 — 广告 Harness 接口分层 + Amazon SP 实现

> **🃏 CARD-5B-D31-01 · `KeywordAdsHarness` 接口定义 + Amazon SP 实现**
>
> **类型：** 新建代码
> **耗时：** 2d (BE)
> **优先级：** 🟡 P2 — Amazon 广告是卖家 80% 支出
> **负责：** BE
>
> **Day 31 — 接口 + 数据表：**
> ```typescript
> interface KeywordAdsHarness extends AdsCapableHarness {
>   readonly supportsKeywordAds: true
>   getKeywords(campaignId: string): Promise<AdKeyword[]>
>   updateKeywordBid(keywordId: string, bid: number): Promise<void>
>   addNegativeKeywords(campaignId: string, keywords: string[]): Promise<void>
>   getSearchTermReport(campaignId: string, range: DateRange): Promise<SearchTermRow[]>
> }
> ```
>
> Migration `0015_ads_keyword_tables.sql`：
> - `ads_keywords`（关键词 + 匹配类型 + 出价 + 状态）
> - `ads_negative_keywords`
> - `ads_search_terms`（搜索词报告同步）
> - `ads_metrics_daily`（活动级指标快照）
>
> **Day 32 — Amazon SP Harness 实现：**
> - 对接 Amazon Advertising API v3
> - `getCampaignMetrics`、`getKeywords`、`getSearchTermReport`（P0）
> - `updateKeywordBid`、`addNegativeKeywords`（P0）
> - **降级策略：** API 未批复 → fixture/mock 返回真实格式数据
>
> **验收：** `KeywordAdsHarness` 接口 + Amazon SP 实现 + 集成测试

---

### Day 33–34 — 账号健康/售后 Harness + `/ads` 页面增强

> **🃏 CARD-5B-D33-01 · 账号健康与售后 Harness**
>
> **类型：** 新建代码
> **耗时：** 1.5d (BE)
> **优先级：** 🟡 P2
> **负责：** BE
>
> **操作：** 只读能力优先：
> - `getAccountHealth()`：账户绩效摘要
> - `getListingIssues()`：被抑制/被删除的 Listing
> - `getBuyBoxStatus()`：Buy Box 占比
> - `getRefundCases()`：退款案例列表
> - `getSupportThreads()`：消息线程
>
> 写能力（如 refund approve / message send）继续沿用已有治理门控。
>
> **验收：** 5 个只读 Harness 方法 + 集成测试

---

> **🃏 CARD-5B-D34-01 · `/ads` 页面增强 + `/service` + `/account-health` 落地**
>
> **类型：** 前端变更
> **耗时：** 1.5d (FE)
> **优先级：** 🟡 P2
> **负责：** FE
>
> **操作：**
> - `/ads`：增加 SKU/ASIN 经营视图（默认展示），下钻到 campaign → keyword → search term
> - `/service`：消息线程 + 退款/退货案例 + 人工接管状态 + 金额统计
> - `/account-health`：违规列表 + Listing issues + Buy Box 占比 + 健康评分
>
> **验收：** 3 个页面展示真实 Harness 数据（或 fixture）

---

### Day 35–36 — 结果回写 + 经营成效评估

> **🃏 CARD-5B-D35-01 · 结果回写与经营成效评估**
>
> **类型：** 新建代码
> **耗时：** 1.5d (BE)
> **优先级：** 🟡 P1 — 验收以经营结果为准
> **负责：** BE
>
> **操作：** `packages/agent-runtime/src/outcome-tracker.ts`
>
> - **Price**：7 天/14 天后回写毛利变化、转化率变化
> - **Ads**：7 天后回写 TACoS、贡献利润、无效花费变化
> - **Inventory**：回写断货是否避免、资金占用是否超预算
> - **审批**：回写采纳率、驳回率、回滚率、后悔率
>
> 使用 BullMQ delayed job 实现延迟回写。
>
> Dashboard 增加"Agent 成效面板"：
> - `agent_decision_outcomes` 可查询采纳率/回滚率
> - Prometheus `agent_decision_quality_score`
>
> **验收：** 调价后 7 天可查到效果数据；Dashboard 有成效面板

---

### Day 37 — `AgentError` 扩展 + 错误类型化

> **🃏 CARD-5B-D37-01 · 场景化错误类型 + 经营预算护栏**
>
> **类型：** 代码变更
> **耗时：** 0.5d (BE)
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：** `packages/shared/src/errors.ts` 扩展 `AgentError`：
>
> ```typescript
> | { type: 'sop_scenario_error';
>     code: 'template_not_found' | 'locked_field_violation'
>           | 'parser_extraction_failed' | 'version_conflict';
>     scenarioId: string; detail: string }
> | { type: 'degraded_mode';
>     reason: 'missing_profit_data' | 'account_health_risk' | 'cash_flow_pressure';
>     agentId: string }
> ```
>
> **验收：** 新错误类型有对应测试

---

### Day 38–39 — 全流程联调 + 验收走查

> **🃏 CARD-5B-D38-01 · Phase 5B 全流程联调**
>
> **类型：** 联调
> **耗时：** 2d (FE + BE)
> **优先级：** 🔴
> **负责：** FE + BE
>
> **验收走查场景：**
>
> | # | 场景 | 验证路径 |
> |---|------|---------|
> | 1 | 新卖家 Onboarding → 选 Growth → 连 Shopify → Dashboard 利润可见 | 注册 → Onboarding → Dashboard |
> | 2 | 创建 "新品上架" 场景 → 三个 Agent SOP 自动展开 | SOP 向导 → Agent 详情页查看 SOP |
> | 3 | Price Sentinel 自主扫描 → LLM 建议降价 8% → 审批含业务理由 | Agent 执行 → 审批中心 |
> | 4 | Inventory Guard 检测断货风险 → 审批含交期/MOQ/金额 | Agent 执行 → 审批中心 |
> | 5 | Ads Optimizer 建议暂停低效活动 → 审批含 ROAS 分析 | Agent 执行 → 审批中心 |
> | 6 | 利润数据缺失 → Agent 自动降级为只建议 | 删除种子数据 → 触发 Agent |
> | 7 | 切换到 approval_informed → 自动执行 + 通知 | 设置 → Agent 执行 |
> | 8 | 7 天后成效回写 → Dashboard 可查效果 | 手动触发 outcome tracker |
> | 9 | `/ads` SKU 视图 + 搜索词 | 广告页面 |
> | 10 | `/account-health` + `/service` | 账号健康 + 售后页面 |

---

### Day 40 — Sprint 21 回归 + Phase 5B 最终验收

> **🃏 CARD-5B-D40-01 · Phase 5B 最终回归**
>
> **类型：** 验证
> **耗时：** 1d
>
> **最终检查点：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `pnpm typecheck && pnpm lint && pnpm test` | 全绿 |
> | 2 | 经营数据底座（4 表 + 聚合层） | 可查利润/在途/健康/售后 |
> | 3 | SOP 策略系统（3 表 + Parser + 12 模板） | 场景化创建可走通 |
> | 4 | `buildSystemPrompt()` L0-L4 | Constitution 永远在 system message |
> | 5 | 3 Agent 五阶段管线 | LLM 决策 + 规则安全网 |
> | 6 | 审批产品化 | 业务理由 + 影响预估 + 回滚 |
> | 7 | 审批模式渐进 | required ↔ informed |
> | 8 | Amazon SP Harness | 关键词级操作（或 fixture） |
> | 9 | 账号健康/售后 Harness | 5 个只读方法 |
> | 10 | 结果回写 | 7 天后成效可查 |
> | 11 | Phase 6 兼容 | 事件字段 + Prometheus + 路由分组 |
> | 12 | 前端 UI | 利润驾驶舱 + 审批中心 + Agent 团队 + 7 业务页面 + SOP 向导 |

---

## 总时间线汇总

```
Sprint 18 (Day 1–10)  · 经营数据底座 + 清障 + 前端骨架        FE:16d BE:14d
Sprint 19 (Day 11–20) · SOP 策略系统 + 场景化 + Prompt 栈     FE:5d  BE:15d
Sprint 20 (Day 21–30) · Agent Native 改造 + 审批渐进          FE:4d  BE:16d
Sprint 21 (Day 31–40) · 广告深度 + 账号健康 + 结果回写        FE:5d  BE:15d
                                                              ─────────────
                                                     总计      FE:30d BE:60d
                                                     (2 FTE × 40d = 80d 可用)
```

**缓冲：** 80d 可用 - (30+60)/2 ≈ 35d 有效工作量/人，含 5d/人联调+回归缓冲。

---

## Related

- [Phase 5B 实施计划](./phase5b-tenant-product-plan.md)
- [Agent Native 改进方案](./agent-native-upgrade-plan.md)
- [System Constitution v1.0](../system-constitution.md)
- [Phase 5 最终验收](../ops/phase5-final-acceptance-review.md)
