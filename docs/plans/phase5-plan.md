# Phase 5 实施计划 · SaaS 商业化 · Onboarding · 计费 · ClipMart · 增长

**周期：** 12 周（Month 13–15）  
**目标：** 三档定价套餐；Stripe 双轨计费（订阅+用量）；7 步自助 Onboarding（<30min）；ClipMart 模板市场；Customer Success Agent；推荐增长机制；首批 20 个付费租户上线  
**验收：** 22 项（见 §9）  
**前提：** Phase 4 全部 28 项 AC 通过；系统稳定运行 ≥ 2 周；50 租户并发压测通过；Autonomous Dev Loop 能稳定跑通  
**不做：** 企业级私有部署（Phase 6）；白标 OEM；完全自治（Phase 6）；Shopify Inbox 完整对接（Phase 6）；合规关键词动态加载（Phase 6）

> 术语约定：**S15–S20** = Sprint 15–20（延续 Phase 1–4 编号）。

---

## 0. 架构决策（Phase 5 前提）

### 0.1 继承自 Phase 1–4 的决策

| # | 决策 | 结论 | 来源 |
|---|------|------|------|
| D1 | 仓库策略 | **独立 Monorepo**（`patioer/`）；Paperclip 并排服务 | ADR-0001 |
| D2 | Web 框架 | ElectroOS **Fastify**；Paperclip Express | Constitution Ch3.1 |
| D3 | ORM | **Drizzle ORM**；不侵入 Paperclip schema | Constitution Ch3.1 |
| D4 | Event 存储 | ClickHouse **Event Lake** + PG `agent_events` 审计 | ADR-0003 |
| D13 | DataOS 技术栈 | ClickHouse 24+ · pgvector:pg16 · Redis | ADR-0003 |
| D19 | Autonomous Loop | 9 阶段流水线；TaskGraph 拓扑排序 | ADR-0004 |
| D20 | CEO Agent 协调 | Ticket-only 协调；不直接调用其他 Agent | ADR-0004 |
| D21 | B2B 租户模型 | 独立 `tenant_id`；复用 RLS / 预算 / 审批 | ADR-0004 |
| D22 | 三层控制台 | Phase 4 API 层 + Grafana → **Phase 5 接 Next.js 前端** | ADR-0004 |

### 0.2 Phase 5 新增决策

| # | 决策 | 结论 | ADR |
|---|------|------|-----|
| D29 | 认证方案 | **NextAuth.js + JWT** + RBAC（admin / seller / agent / readonly） | ADR-0005 |
| D30 | 支付架构 | **Stripe Checkout + Customer Portal + Billing Meters**（零 PCI 负担；订阅用 Subscriptions，超额用 Meters） | ADR-0005 |
| D31 | 数据库策略 | **Drizzle ORM + 领域自治 schema**（每个新 package 拥有自己的 schema + migrations）；所有新表 `tenant_id + RLS` | ADR-0005 |
| D32 | 前端范围 | **最小 Next.js 壳**（`apps/web/`）；6 页面（register/login/onboarding/dashboard/clipmart/settings）；支付 UI 全走 Stripe 托管 | ADR-0005 |
| D33 | CS Agent 架构 | **平台级 Agent**（不属于任何租户）；每日 09:00 扫描全部活跃租户；模型 claude-sonnet-4-6；月预算 $200 | ADR-0005 |
| D34 | ClipMart 演进 | Phase 4 CLI 脚本 → Phase 5 **`packages/clipmart/` 完整服务**；5 个官方模板首发 | ADR-0005 |
| D35 | Phase 4 遗留 | Amazon/TikTok/Shopee 联调 S15 并行；agentTypeEnum S15 Day 1；Console 真实 API S17；Shopify Inbox / 动态关键词 Phase 6 | ADR-0005 |
| D36 | 定价套餐 | Starter $299 / Growth $799 / Scale $1,999；超额按 Stripe Billing Meters 实时计费 | ADR-0005 |
| D37 | 邮件服务 | **Resend**（TypeScript SDK + Next.js 生态契合）；用于注册验证 + CS Agent 干预 + NPS 问卷 | ADR-0005 |
| D38 | 环境策略 | S15–S19 **Stripe Test Mode** → S20 切 **Live Mode** | ADR-0005 |

### 关键约束回顾（Constitution 硬门槛 — 延续 Phase 1–4）

- Agent **绝不**直调平台 SDK → 必须经 Harness
- 所有核心表 **tenant_id + RLS**
- 价格变动 **>15%** 须人工审批
- 广告日预算 **>$500** 须人工审批
- 所有 Agent 操作写入**不可变审计日志**
- 测试覆盖率 **≥ 80%**
- 删除操作必须**软删除**
- **新增（Phase 5）：** ClipMart 模板不允许修改 System Constitution

---

## 1. Monorepo 目录结构变更（Phase 5 增量）

```
patioer/
├── apps/
│   ├── web/                                   # NEW: Next.js 前端应用
│   │   ├── src/
│   │   │   ├── app/                           # App Router
│   │   │   │   ├── layout.tsx                 # 根布局 + Tailwind + NextAuth Provider
│   │   │   │   ├── page.tsx                   # Landing → redirect /dashboard or /register
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── register/page.tsx      # 注册页（邮箱+密码+验证码）
│   │   │   │   │   └── login/page.tsx         # 登录页
│   │   │   │   ├── onboarding/
│   │   │   │   │   └── page.tsx               # 7 步向导
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx               # 三层状态面板
│   │   │   │   ├── clipmart/
│   │   │   │   │   ├── page.tsx               # 模板浏览 + 搜索
│   │   │   │   │   └── [id]/page.tsx          # 模板详情 + 导入 + 评分
│   │   │   │   └── settings/
│   │   │   │       └── page.tsx               # 治理偏好 + 账户
│   │   │   ├── components/
│   │   │   │   ├── onboarding-wizard.tsx       # 7 步向导组件
│   │   │   │   ├── plan-selector.tsx           # 套餐选择卡片
│   │   │   │   ├── oauth-connector.tsx         # OAuth 授权连接器
│   │   │   │   ├── agent-org-chart.tsx         # Agent 组织架构可视化
│   │   │   │   ├── health-check-panel.tsx      # 健康检查面板
│   │   │   │   └── template-card.tsx           # ClipMart 模板卡片
│   │   │   └── lib/
│   │   │       ├── auth.ts                    # NextAuth.js 配置
│   │   │       └── api-client.ts              # 后端 API 客户端
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── tsconfig.json
│   └── api/
│       └── src/
│           ├── app.ts                         # EXTEND: 注册新路由
│           └── routes/
│               ├── billing.ts                 # NEW: 计费 API
│               ├── webhook-stripe.ts          # NEW: Stripe Webhook
│               ├── onboarding-flow.ts         # NEW: Onboarding 7 步 API
│               ├── clipmart.ts                # NEW: ClipMart CRUD + 搜索 + 导入
│               ├── growth.ts                  # NEW: 推荐码 + NPS API
│               └── auth.ts                    # NEW: 注册 / 登录 / JWT
├── packages/
│   ├── billing/                               # NEW: 计费领域
│   │   ├── src/
│   │   │   ├── stripe-setup.ts                # Stripe 产品/价格/Meter 配置常量
│   │   │   ├── subscription.service.ts        # 创建/升降级/取消/试用
│   │   │   ├── subscription.service.test.ts
│   │   │   ├── usage-reporter.ts              # Agent token 用量实时上报
│   │   │   ├── usage-reporter.test.ts
│   │   │   ├── webhook-handler.ts             # 4 类 Stripe Webhook 事件处理
│   │   │   ├── webhook-handler.test.ts
│   │   │   ├── reconciliation.ts              # Stripe vs ClickHouse 对账
│   │   │   ├── reconciliation.test.ts
│   │   │   ├── plan-enforcer.ts               # 套餐权限执行（Agent 数/平台数/DataOS）
│   │   │   ├── plan-enforcer.test.ts
│   │   │   ├── billing.types.ts               # PlanName / StripeProduct / UsageEvent
│   │   │   ├── billing.schema.ts              # Drizzle schema: billing_usage_logs / billing_reconciliation
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── onboarding/                            # NEW: Onboarding 领域
│   │   ├── src/
│   │   │   ├── onboarding-machine.ts          # 7 步状态机
│   │   │   ├── onboarding-machine.test.ts
│   │   │   ├── oauth-guide.ts                 # 平台 OAuth 引导 + 4 种卡点预防
│   │   │   ├── oauth-guide.test.ts
│   │   │   ├── health-check.ts                # Agent 心跳 + API 连通性验证
│   │   │   ├── health-check.test.ts
│   │   │   ├── onboarding.types.ts            # OnboardingStep / OnboardingState
│   │   │   ├── onboarding.schema.ts           # Drizzle schema: onboarding_progress
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── clipmart/                              # NEW: ClipMart 领域
│   │   ├── src/
│   │   │   ├── template.service.ts            # 模板 CRUD + 搜索（品类/市场/平台）
│   │   │   ├── template.service.test.ts
│   │   │   ├── import.service.ts              # 一键导入 + 深度合并 + tenantId 强制覆盖
│   │   │   ├── import.service.test.ts
│   │   │   ├── review.service.ts              # 评分 + 评论 + GMV 变化
│   │   │   ├── review.service.test.ts
│   │   │   ├── security-validator.ts          # 模板安全校验（禁止修改 Constitution）
│   │   │   ├── security-validator.test.ts
│   │   │   ├── official-templates.ts          # 5 个官方模板种子数据
│   │   │   ├── official-templates.test.ts
│   │   │   ├── clipmart.types.ts              # ClipmartTemplate / TemplateReview
│   │   │   ├── clipmart.schema.ts             # Drizzle schema: clipmart_templates / template_reviews
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── growth/                                # NEW: 增长领域
│   │   ├── src/
│   │   │   ├── referral.service.ts            # 推荐码生成 + 核销
│   │   │   ├── referral.service.test.ts
│   │   │   ├── reward.service.ts              # 奖励兑现（试用延长 + 20% 折扣）
│   │   │   ├── reward.service.test.ts
│   │   │   ├── nps.service.ts                 # NPS 问卷（使用 30 天后自动发送）
│   │   │   ├── nps.service.test.ts
│   │   │   ├── auto-upsell.ts                 # 连续超额 → 升级建议
│   │   │   ├── auto-upsell.test.ts
│   │   │   ├── growth.types.ts                # ReferralCode / Reward / NpsResponse
│   │   │   ├── growth.schema.ts               # Drizzle schema: referral_codes / referral_rewards / nps_responses
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── agent-runtime/
│   │   └── src/
│   │       ├── agents/
│   │       │   └── customer-success.agent.ts      # NEW: E-10 CS Agent（平台级）
│   │       │   └── customer-success.agent.test.ts
│   │       ├── electroos-seed.ts                  # EXTEND: 新增 CS Agent 定义
│   │       └── types.ts                           # EXTEND: CustomerSuccessRunInput 等类型
│   ├── shared/
│   │   └── src/
│   │       └── constants.ts                       # EXTEND: 套餐常量 + SLA 等级 + CS Agent ID
│   └── db/                                        # EXTEND: tenants 表 Stripe 字段
│       └── migrations/
│           └── 003_stripe_tenant_fields.sql        # NEW: stripe_customer_id / stripe_subscription_id / plan / trial_ends_at
├── harness-config/
│   └── official-templates/                        # NEW: 5 个官方 ClipMart 模板
│       ├── standard-cross-border.json
│       ├── sea-marketplace.json
│       ├── amazon-ppc-pro.json
│       ├── fast-fashion.json
│       └── b2b-wholesale.json
├── scripts/
│   ├── stripe-setup.ts                            # NEW: Stripe 产品/价格/Meter 初始化脚本
│   ├── seed-official-templates.ts                 # NEW: 5 个官方模板 seed 脚本
│   └── phase5-ac-verify.ts                        # NEW: 22 项 AC 自动验证
└── docs/
    ├── plans/
    │   └── phase5-plan.md                         # 本文件
    └── adr/
        └── 0005-phase5-saas-billing.md            # NEW: ADR-0005
```

---

## 2. Phase 4 遗留修复计划（嵌入 Sprint 时间轴）

> Phase 4 GO 决策文档列出 7 项延期到 Phase 5 的工作。全部在指定 Sprint 内完成或签署正式豁免。

### S15 Day 1 阻塞项

| # | 来源 | 修复 | 文件 |
|---|------|------|------|
| L-01 | Phase 4 | DB `agentTypeEnum` 扩展 finance-agent / ceo-agent | `packages/db/` migration |

### S15 并行（非阻塞）

| # | 来源 | 行动 | 产出 |
|---|------|------|------|
| L-02 | Phase 4 | Amazon SP-API 联调（审核通过则切换真实 API，否则维持 Sandbox） | 联调 ✅ or 维持降级 |
| L-03 | Phase 4 | TikTok Shop 联调（同上） | 联调 ✅ or 维持降级 |
| L-04 | Phase 4 | Shopee 联调（同上） | 联调 ✅ or 维持降级 |

### S17 修复

| # | 来源 | 行动 | 产出 |
|---|------|------|------|
| L-05 | Phase 4 | Console DataOS/Alert 接真实 API（Phase 4 用 synthetic） | Dashboard 真实数据 |

### Phase 6 延期

| # | 来源 | 理由 |
|---|------|------|
| L-06 | Phase 4 | Shopify Inbox 完整对接：非计费/增长关键路径 |
| L-07 | Phase 4 | 合规关键词动态加载：静态配置满足 Phase 5 需求 |

---

## 3. 六 Sprint 分解（12 周）

### Sprint 15 · Week 1–2 — 基础设施搭建 + 定价套餐 + 遗留修复

**交付物：** `apps/web/` Next.js 脚手架 · 5 个新 package 初始化 · DB migrations · Stripe 产品/价格配置 · 套餐常量 · NextAuth.js + JWT · 注册/登录 API + 页面 · agentTypeEnum 修复

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 15.1 | `apps/web/` Next.js 14+ App Router 脚手架（Tailwind + NextAuth.js） | `apps/web/` | — | 1d |
| 15.2 | `packages/billing/` 包初始化（package.json + tsconfig + src/index.ts） | `packages/billing/` | — | 0.5d |
| 15.3 | `packages/onboarding/` 包初始化 | `packages/onboarding/` | — | 0.5d |
| 15.4 | `packages/clipmart/` 包初始化 | `packages/clipmart/` | — | 0.5d |
| 15.5 | `packages/growth/` 包初始化 | `packages/growth/` | — | 0.5d |
| 15.6 | DB migration `003_stripe_tenant_fields.sql`：tenants +4 字段 | `packages/db/` | — | 0.5d |
| 15.7 | DB migration `004_clipmart_tables.sql`：`clipmart_templates` + `template_reviews` + RLS | `packages/clipmart/` | — | 1d |
| 15.8 | DB migration `005_growth_tables.sql`：`referral_codes` + `referral_rewards` + `nps_responses` + RLS | `packages/growth/` | — | 0.5d |
| 15.9 | DB migration `006_onboarding_progress.sql`：7 步状态追踪 + RLS | `packages/onboarding/` | — | 0.5d |
| 15.10 | DB migration `007_billing_tables.sql`：`billing_usage_logs` + `billing_reconciliation` + RLS | `packages/billing/` | — | 0.5d |
| 15.11 | `stripe-setup.ts`：3 档套餐 Product/Price + Billing Meter 常量 | `packages/billing/` | — | 1d |
| 15.12 | `packages/shared/src/constants.ts`：套餐常量 + Agent 预算映射 + SLA 等级 + `customer-success` Agent ID | `packages/shared/` | — | 0.5d |
| 15.13 | `billing.types.ts`：PlanName / StripeProduct / UsageEvent / OverageRate | `packages/billing/` | 15.11 | 0.5d |
| 15.14 | `plan-enforcer.ts`：根据套餐限制 Agent 数/平台数/DataOS 可用性 | `packages/billing/` | 15.13 | 1d |
| 15.15 | `apps/api/src/routes/auth.ts`：注册（邮箱+密码+验证码）+ 登录 + JWT 签发 | `apps/api/` | 15.1 | 1d |
| 15.16 | `apps/web/` 注册/登录页面 | `apps/web/` | 15.15 | 1d |
| 15.17 | 遗留 L-01：DB agentTypeEnum 扩展 | `packages/db/` | — | 0.5d |
| 15.18 | 遗留 L-02/03/04：Amazon/TikTok/Shopee 联调状态确认 | 外部操作 | — | 0.5d |
| 15.19 | `scripts/stripe-setup.ts`：Stripe Dashboard 初始化脚本 | `scripts/` | 15.11 | 0.5d |
| 15.20 | S15 typecheck + lint + 测试回归 | all | 15.1–15.19 | 0.5d |

**Sprint 15 验收：**
- [ ] `apps/web/` 可运行，`/register` 和 `/login` 页面可访问
- [ ] 5 个新 package 编译通过
- [ ] 所有 DB migrations 应用成功
- [ ] `tenants` 表包含 `stripe_customer_id` / `stripe_subscription_id` / `plan` / `trial_ends_at` 字段
- [ ] `clipmart_templates` / `template_reviews` 表存在 + RLS 策略生效
- [ ] Stripe Test Mode 中 3 个 Product + 3 个 Price + 1 个 Meter 已创建
- [ ] 注册 → 邮件验证 → 登录 → 获取 JWT 全链路通过
- [ ] `agentTypeEnum` 包含 `finance-agent` / `ceo-agent`
- [ ] CI 全绿

---

#### Sprint 15 · Day-by-Day 实施细节

##### Day 1 — Package 脚手架 + 遗留修复

> **🃏 CARD-S15-D1-01 · `apps/web/` Next.js 脚手架**
>
> **类型：** 新建应用  
> **耗时：** 4h  
> **优先级：** 🔴 Phase 5 基础设施
>
> **操作：**
> 1. `pnpm create next-app apps/web --typescript --tailwind --app --src-dir --import-alias "@/*"`
> 2. 配置 `package.json`：`name: "@patioer/web"`，添加 workspace 依赖 `@patioer/shared`
> 3. 安装 NextAuth.js：`pnpm -F @patioer/web add next-auth@5 @auth/core`
> 4. 配置 `tailwind.config.ts`：主题色、字体
> 5. 创建 `src/app/layout.tsx`：根布局 + SessionProvider
> 6. 创建 `src/lib/auth.ts`：NextAuth.js 配置（Credentials Provider + JWT strategy）
> 7. 创建 `src/lib/api-client.ts`：封装 fetch 调用后端 API（附 JWT header）
> 8. 验证：`pnpm -F @patioer/web dev` 启动正常
>
> **验收：** `http://localhost:3000` 显示 Next.js 默认页面；`pnpm -F @patioer/web typecheck` 通过

---

> **🃏 CARD-S15-D1-02 · 5 个新 package 初始化**
>
> **类型：** 新建包（批量）  
> **耗时：** 2h
>
> 对 `billing` / `onboarding` / `clipmart` / `growth` 各创建：
>
> ```
> packages/{name}/
> ├── src/
> │   ├── index.ts          # 空导出占位
> │   └── {name}.types.ts   # 核心类型定义
> ├── package.json           # @patioer/{name}
> └── tsconfig.json          # extends ../../tsconfig.base.json
> ```
>
> `package.json` 模板：
> ```json
> {
>   "name": "@patioer/{name}",
>   "version": "0.1.0",
>   "private": true,
>   "type": "module",
>   "exports": { ".": "./src/index.ts" },
>   "scripts": {
>     "typecheck": "tsc --noEmit",
>     "lint": "eslint src/",
>     "test": "vitest run",
>     "test:coverage": "vitest run --coverage --coverage.thresholds.lines=80"
>   },
>   "dependencies": {
>     "@patioer/shared": "workspace:*"
>   }
> }
> ```
>
> **验收：** `pnpm typecheck` 全 monorepo 通过（包含 4 个新包）

---

> **🃏 CARD-S15-D1-03 · 遗留 L-01：agentTypeEnum 扩展**
>
> **类型：** DB migration  
> **耗时：** 1h  
> **优先级：** 🟡 非阻塞但越早越干净
>
> **操作：**
> 1. 创建 migration `ALTER TYPE agent_type_enum ADD VALUE IF NOT EXISTS 'finance-agent'`
> 2. 同理添加 `'ceo-agent'`
> 3. 运行 migration 并验证 `SELECT unnest(enum_range(NULL::agent_type_enum))` 含新值
>
> **验收：** `agent_type_enum` 包含全部 11 种类型

---

##### Day 2 — DB Migrations（全部 5 张新表）

> **🃏 CARD-S15-D2-01 · `003_stripe_tenant_fields.sql`**
>
> **类型：** DB migration  
> **耗时：** 1h  
> **目标：** 扩展 `tenants` 表支持 Stripe 计费
>
> ```sql
> ALTER TABLE tenants
>   ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
>   ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
>   ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'starter',
>   ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
>
> CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
>   ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
> ```
>
> **验收：** 4 个字段存在；现有租户数据不受影响

---

> **🃏 CARD-S15-D2-02 · `004_clipmart_tables.sql`**
>
> **类型：** DB migration  
> **耗时：** 2h  
> **目标：** ClipMart 模板市场数据表
>
> ```sql
> CREATE TABLE clipmart_templates (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   author_tenant_id UUID REFERENCES tenants(id),
>   name TEXT NOT NULL,
>   description TEXT,
>   category TEXT NOT NULL,
>   target_markets TEXT[] DEFAULT '{}',
>   target_categories TEXT[] DEFAULT '{}',
>   platforms TEXT[] DEFAULT '{}',
>   config JSONB NOT NULL,
>   performance JSONB DEFAULT '{}',
>   downloads INTEGER DEFAULT 0,
>   rating NUMERIC(3,2),
>   is_official BOOLEAN DEFAULT false,
>   is_public BOOLEAN DEFAULT true,
>   created_at TIMESTAMPTZ DEFAULT NOW(),
>   deleted_at TIMESTAMPTZ
> );
>
> CREATE TABLE template_reviews (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   template_id UUID REFERENCES clipmart_templates(id),
>   tenant_id UUID REFERENCES tenants(id),
>   rating INTEGER CHECK (rating BETWEEN 1 AND 5),
>   comment TEXT,
>   gmv_change NUMERIC(5,2),
>   created_at TIMESTAMPTZ DEFAULT NOW(),
>   deleted_at TIMESTAMPTZ
> );
>
> ALTER TABLE clipmart_templates ENABLE ROW LEVEL SECURITY;
> ALTER TABLE template_reviews ENABLE ROW LEVEL SECURITY;
>
> -- 公开模板所有人可读；写操作限 author
> CREATE POLICY clipmart_read ON clipmart_templates
>   FOR SELECT USING (is_public = true OR author_tenant_id = current_setting('app.tenant_id')::uuid);
> CREATE POLICY clipmart_write ON clipmart_templates
>   FOR ALL USING (author_tenant_id = current_setting('app.tenant_id')::uuid);
>
> CREATE POLICY review_read ON template_reviews
>   FOR SELECT USING (true);
> CREATE POLICY review_write ON template_reviews
>   FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
>
> CREATE INDEX idx_clipmart_category ON clipmart_templates(category);
> CREATE INDEX idx_clipmart_platforms ON clipmart_templates USING GIN(platforms);
> ```
>
> **验收：** 两表存在；RLS 策略生效（跨租户写入被拒绝）

---

> **🃏 CARD-S15-D2-03 · `005_growth_tables.sql` + `006_onboarding_progress.sql` + `007_billing_tables.sql`**
>
> **类型：** DB migration（3 张表打包）  
> **耗时：** 2h
>
> **`referral_codes`：**
> ```sql
> CREATE TABLE referral_codes (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   tenant_id UUID REFERENCES tenants(id) NOT NULL,
>   code TEXT UNIQUE NOT NULL,
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
> ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
> CREATE POLICY referral_codes_tenant ON referral_codes
>   USING (tenant_id = current_setting('app.tenant_id')::uuid);
> ```
>
> **`referral_rewards`：**
> ```sql
> CREATE TABLE referral_rewards (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   referrer_tenant_id UUID REFERENCES tenants(id) NOT NULL,
>   new_tenant_id UUID REFERENCES tenants(id) NOT NULL,
>   reward_type TEXT NOT NULL DEFAULT '20_pct_discount_1_month',
>   status TEXT NOT NULL DEFAULT 'pending',
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
> ```
>
> **`nps_responses`：**
> ```sql
> CREATE TABLE nps_responses (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   tenant_id UUID REFERENCES tenants(id) NOT NULL,
>   score INTEGER CHECK (score BETWEEN 0 AND 10),
>   feedback TEXT,
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
> ```
>
> **`onboarding_progress`：**
> ```sql
> CREATE TABLE onboarding_progress (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   tenant_id UUID REFERENCES tenants(id) NOT NULL UNIQUE,
>   current_step INTEGER NOT NULL DEFAULT 1,
>   step_data JSONB DEFAULT '{}',
>   started_at TIMESTAMPTZ DEFAULT NOW(),
>   completed_at TIMESTAMPTZ,
>   oauth_status JSONB DEFAULT '{}',
>   health_check_passed BOOLEAN DEFAULT false
> );
> ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
> CREATE POLICY onboarding_tenant ON onboarding_progress
>   USING (tenant_id = current_setting('app.tenant_id')::uuid);
> ```
>
> **`billing_usage_logs`：**
> ```sql
> CREATE TABLE billing_usage_logs (
>   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
>   tenant_id UUID REFERENCES tenants(id) NOT NULL,
>   agent_id TEXT NOT NULL,
>   tokens_used INTEGER NOT NULL,
>   cost_usd NUMERIC(10,4) NOT NULL,
>   model TEXT NOT NULL,
>   is_overage BOOLEAN DEFAULT false,
>   reported_to_stripe BOOLEAN DEFAULT false,
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
> CREATE INDEX idx_billing_usage_tenant_month
>   ON billing_usage_logs(tenant_id, created_at);
> ```
>
> **验收：** 全部 6 张新表存在 + RLS 生效

---

##### Day 3 — Stripe 产品配置 + 套餐常量

> **🃏 CARD-S15-D3-01 · `stripe-setup.ts` + `billing.types.ts`**
>
> **类型：** 新建文件  
> **耗时：** 4h  
> **目标文件：** `packages/billing/src/stripe-setup.ts` + `packages/billing/src/billing.types.ts`
>
> **`billing.types.ts` 核心类型：**
> ```typescript
> export type PlanName = 'starter' | 'growth' | 'scale'
>
> export interface PlanFeatures {
>   platforms: number
>   agents: number
>   budgetUsd: number
>   dataos: 'none' | 'partial' | 'full'
>   slaUptime: number
>   supportLevel: 'email' | 'chat' | 'dedicated'
> }
>
> export interface StripeProduct {
>   productId: string
>   priceId: string
>   yearlyPriceId?: string
>   features: PlanFeatures
> }
>
> export interface OverageRate {
>   tokenPer1k: number
>   extraPlatform: number
>   extraShop: number | null
>   dataosStoragePerGb: number | null
> }
> ```
>
> **`stripe-setup.ts` 核心常量（PDF §01 对齐）：**
> ```typescript
> export const STRIPE_PRODUCTS: Record<PlanName, StripeProduct> = {
>   starter: {
>     productId: process.env.STRIPE_PRODUCT_STARTER!,
>     priceId: process.env.STRIPE_PRICE_STARTER_MONTHLY!,
>     features: { platforms: 1, agents: 3, budgetUsd: 160, dataos: 'none', slaUptime: 99.5, supportLevel: 'email' }
>   },
>   growth: {
>     productId: process.env.STRIPE_PRODUCT_GROWTH!,
>     priceId: process.env.STRIPE_PRICE_GROWTH_MONTHLY!,
>     features: { platforms: 3, agents: 7, budgetUsd: 500, dataos: 'partial', slaUptime: 99.9, supportLevel: 'chat' }
>   },
>   scale: {
>     productId: process.env.STRIPE_PRODUCT_SCALE!,
>     priceId: process.env.STRIPE_PRICE_SCALE_MONTHLY!,
>     features: { platforms: 5, agents: 9, budgetUsd: 1200, dataos: 'full', slaUptime: 99.95, supportLevel: 'dedicated' }
>   },
> }
> ```
>
> **验收：** 类型编译通过；`STRIPE_PRODUCTS` 三档套餐数据与 PDF §01 完全对齐

---

> **🃏 CARD-S15-D3-02 · `packages/shared/src/constants.ts` 扩展**
>
> **类型：** 代码变更  
> **耗时：** 1h  
> **目标文件：** `packages/shared/src/constants.ts`
>
> **新增常量：**
> ```typescript
> export const PLAN_NAMES = ['starter', 'growth', 'scale'] as const
> export type PlanName = (typeof PLAN_NAMES)[number]
>
> export const PLAN_AGENT_LIMITS: Record<PlanName, readonly string[]> = {
>   starter: ['product-scout', 'price-sentinel', 'support-relay'],
>   growth: ['product-scout', 'price-sentinel', 'support-relay', 'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel'],
>   scale: ELECTROOS_AGENT_IDS,
> }
>
> export const SLA_LEVELS = {
>   starter: { uptime: 99.5, p0ResponseH: 4, p1ResponseH: 24 },
>   growth: { uptime: 99.9, p0ResponseH: 2, p1ResponseH: 8 },
>   scale: { uptime: 99.95, p0ResponseH: 0.5, p1ResponseH: 4 },
> } as const
>
> export const CUSTOMER_SUCCESS_AGENT_ID = 'customer-success'
> ```
>
> **验收：** 现有测试不受影响；新常量类型正确

---

##### Day 4 — plan-enforcer + auth API

> **🃏 CARD-S15-D4-01 · `plan-enforcer.ts`**
>
> **类型：** 新建文件  
> **耗时：** 4h  
> **目标文件：** `packages/billing/src/plan-enforcer.ts`
>
> 根据租户套餐执行权限限制：
> - `canUseAgent(plan, agentId)` → 检查 `PLAN_AGENT_LIMITS`
> - `canAddPlatform(plan, currentCount)` → 检查平台数上限
> - `canUseDataOS(plan)` → 检查 DataOS 可用性
> - `getMonthlyBudget(plan)` → 返回套餐内 Agent 预算
>
> **验收：** 单元测试覆盖全部 3 档套餐 × 4 种检查 = 12 case

---

> **🃏 CARD-S15-D4-02 · `apps/api/src/routes/auth.ts` + NextAuth.js 配置**
>
> **类型：** 新建文件  
> **耗时：** 4h  
> **目标文件：** `apps/api/src/routes/auth.ts` + `apps/web/src/lib/auth.ts`
>
> **API 端点：**
> - `POST /api/v1/auth/register` — 邮箱 + 密码 → 创建 user + tenant → 发送验证邮件 → 返回 JWT
> - `POST /api/v1/auth/verify-email` — 验证码确认
> - `POST /api/v1/auth/login` — 邮箱 + 密码 → JWT
> - `GET /api/v1/auth/me` — JWT → 用户信息
>
> **NextAuth.js 配置（`apps/web/src/lib/auth.ts`）：**
> - Credentials Provider（调用后端 `/auth/login`）
> - JWT session strategy（Constitution Ch9 对齐）
> - Token 中包含 `tenantId` / `role` / `plan`
>
> **验收：** 注册 → 验证 → 登录 → JWT 解码含 `tenantId` + `role`

---

##### Day 5 — 注册/登录页面 + 平台联调确认

> **🃏 CARD-S15-D5-01 · `/register` + `/login` 前端页面**
>
> **类型：** 新建前端页面  
> **耗时：** 4h  
> **目标文件：** `apps/web/src/app/(auth)/register/page.tsx` + `apps/web/src/app/(auth)/login/page.tsx`
>
> **设计要求：**
> - 现代简洁 UI，Tailwind 卡片式布局
> - 表单验证（邮箱格式 + 密码强度）
> - 注册成功后跳转 `/onboarding`
> - 登录成功后跳转 `/dashboard`
> - 错误状态友好提示
>
> **验收：** 注册流程可视化完成；响应式适配移动端

---

> **🃏 CARD-S15-D5-02 · 遗留平台联调状态确认 + Stripe Setup 脚本**
>
> **类型：** 外部操作 + 脚本  
> **耗时：** 2h
>
> 1. 确认 Amazon SP-API / TikTok / Shopee 开发者控制台审核状态
> 2. 运行 `pnpm exec tsx scripts/stripe-setup.ts` → 在 Stripe Test Mode 创建 3 Product + 3 Price + 1 Meter
> 3. 记录 Stripe ID 到 `.env.test`
>
> **产出：** 平台联调状态已知；Stripe Test Mode 配置就绪

---

##### Day 6–7 — Sprint 15 回归 + 检查点

> **🃏 CARD-S15-D6-01 · Sprint 15 最终回归**
>
> **检查点清单：**
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `pnpm typecheck` | 全 monorepo 通过（含 5 新包 + 1 新 app） |
> | 2 | `pnpm lint` | 全通过 |
> | 3 | `pnpm test` | 全通过 |
> | 4 | DB migrations | 全部应用成功 |
> | 5 | `apps/web/ dev` | 注册/登录页面可访问 |
> | 6 | Stripe Test Mode | 3 Product + 3 Price + 1 Meter 存在 |
> | 7 | agentTypeEnum | 含 finance-agent + ceo-agent |

---

### Sprint 16 · Week 3–4 — Stripe 计费核心

**交付物：** 订阅创建 + 14 天试用 · 用量实时上报 · Webhook 4 事件处理 · ClickHouse 对账 · 付款失败宽限期 · 升降级套餐 · 退订数据保留 · 计费 API 路由

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 16.1 | `subscription.service.ts`：`createSubscription`（Stripe Customer + Subscription + 14 天试用） | `packages/billing/` | S15 | 1d |
| 16.2 | `subscription.service.ts`：`upgradePlan` / `downgradePlan`（proration + 配置同步） | `packages/billing/` | 16.1 | 1d |
| 16.3 | `subscription.service.ts`：`cancelSubscription`（立即暂停 Agent + 30 天数据保留） | `packages/billing/` | 16.1 | 0.5d |
| 16.4 | `usage-reporter.ts`：Agent LLM 调用完成 → 计算套餐内额度 → 超额上报 Stripe Billing Meter | `packages/billing/` | S15 | 1.5d |
| 16.5 | `usage-reporter.ts`：ClickHouse 双写（无论是否超额都记录，用于内部对账） | `packages/billing/` | 16.4 | 0.5d |
| 16.6 | `webhook-handler.ts`：`invoice.payment_succeeded` → 重置月度用量计数 | `packages/billing/` | 16.1 | 0.5d |
| 16.7 | `webhook-handler.ts`：`invoice.payment_failed` → 3 天宽限期 → 暂停所有 Agent | `packages/billing/` | 16.1 | 1d |
| 16.8 | `webhook-handler.ts`：`customer.subscription.deleted` → 暂停 Agent + 调度 30 天数据删除 | `packages/billing/` | 16.1 | 0.5d |
| 16.9 | `webhook-handler.ts`：`customer.subscription.updated` → 升降级配置即时同步 | `packages/billing/` | 16.2 | 0.5d |
| 16.10 | `reconciliation.ts`：Stripe 月度账单 vs ClickHouse `billing_usage_logs` 自动对账 | `packages/billing/` | 16.5 | 1d |
| 16.11 | `apps/api/src/routes/billing.ts`：`POST /api/v1/billing/checkout-session` + `GET /billing/portal-session` | `apps/api/` | 16.1 | 0.5d |
| 16.12 | `apps/api/src/routes/webhook-stripe.ts`：Webhook 路由 + 签名验证 | `apps/api/` | 16.6–16.9 | 0.5d |
| 16.13 | `apps/api/app.ts`：注册 `billingRoute` + `webhookStripeRoute` + `authRoute` | `apps/api/` | 16.11–16.12 | 0.5d |
| 16.14 | 计费全链路测试（Stripe Test Mode：创建订阅 → 使用 → 超额 → 付款 → 升级 → 取消） | `packages/billing/` | 16.1–16.12 | 1d |
| 16.15 | S16 typecheck + lint + 回归 | all | 16.1–16.14 | 0.5d |

**Sprint 16 验收：**
- [ ] `createSubscription` 后 Stripe Dashboard 有客户 + 订阅记录（**AC-P5-01**）
- [ ] 14 天试用结束后 Stripe 自动收费（Test Clock 验证）（**AC-P5-02**）
- [ ] 模拟信用卡失败 → 3 天后 Agent 暂停（**AC-P5-03**）
- [ ] Agent token 超额 → Stripe Meter 收到上报 → 月底含超额费用（**AC-P5-04**）
- [ ] Growth → Scale 升级后新 Agent 权限立即生效（**AC-P5-05**）
- [ ] 取消订阅后 Agent 暂停 + 30 天数据删除调度（**AC-P5-06**）

---

#### Sprint 16 · Day-by-Day 实施细节

##### Day 1–2 — 订阅服务

> **🃏 CARD-S16-D1-01 · `subscription.service.ts` 完整实现**
>
> **类型：** 新建文件  
> **耗时：** 2d  
> **目标文件：** `packages/billing/src/subscription.service.ts`
>
> **核心函数（PDF §02 对齐）：**
>
> ```typescript
> export async function createSubscription(tenantId: string, plan: PlanName): Promise<void>
> // 1. stripe.customers.create({ metadata: { tenantId } })
> // 2. stripe.subscriptions.create({ items: [{ price }], trial_period_days: 14 })
> // 3. db.tenants.update(tenantId, { stripeCustomerId, stripeSubscriptionId, plan, trialEndsAt })
>
> export async function upgradePlan(tenantId: string, newPlan: PlanName): Promise<void>
> // 1. stripe.subscriptions.update(subId, { items: [{ price: newPriceId }], proration_behavior: 'create_prorations' })
> // 2. syncPlanFeatures(tenantId, newPlan) — 新 Agent 立即 ACTIVE，预算上限更新
>
> export async function downgradePlan(tenantId: string, newPlan: PlanName): Promise<void>
> // 1. 检查当前使用是否超出新套餐限制 → 超出的 Agent 暂停
> // 2. stripe.subscriptions.update(subId, { items: [{ price }], proration_behavior: 'create_prorations' })
>
> export async function cancelSubscription(tenantId: string): Promise<void>
> // 1. stripe.subscriptions.cancel(subId)
> // 2. suspendAllAgents(tenantId)
> // 3. scheduleDataDeletion(tenantId, { days: 30 })
> ```
>
> **验收：** 全部 4 函数单元测试通过（Stripe mock）

---

##### Day 3–4 — 用量上报 + Webhook

> **🃏 CARD-S16-D3-01 · `usage-reporter.ts`**
>
> **类型：** 新建文件  
> **耗时：** 1.5d  
> **目标文件：** `packages/billing/src/usage-reporter.ts`
>
> **核心逻辑（PDF §02 STEP 2.2 对齐）：**
> ```typescript
> export async function reportTokenUsage(tenantId: string, tokensUsed: number, model: string): Promise<void>
> // 1. 查询当月已用预算
> // 2. 计算本次 token 成本
> // 3. 若超出套餐额度 → stripe.billing.meterEvents.create({ event_name: "token_usage", payload: { stripe_customer_id, value } })
> // 4. 无论是否超额 → ClickHouse eventLake.record({ tenantId, eventType: "token_usage", payload })
> // 5. 写入 billing_usage_logs 表
> ```
>
> **验收：** 套餐内用量不触发 Stripe 上报；超额触发 Meter Event + ClickHouse 双写

---

> **🃏 CARD-S16-D3-02 · `webhook-handler.ts` 四事件处理**
>
> **类型：** 新建文件  
> **耗时：** 2d  
> **目标文件：** `packages/billing/src/webhook-handler.ts`
>
> **四种事件（PDF §02 STEP 2.3 对齐）：**
>
> | 事件 | 处理逻辑 |
> |------|---------|
> | `invoice.payment_succeeded` | 续费成功 → 重置当月用量计数 → 更新 `billing_usage_logs` 月度标记 |
> | `invoice.payment_failed` | 付款失败 → 3 天宽限期（BullMQ delayed job）→ 到期暂停所有 Agent |
> | `customer.subscription.deleted` | 退订 → 立即暂停所有 Agent → 调度 30 天后数据删除 |
> | `customer.subscription.updated` | 升降级 → `syncPlanFeatures()` 更新 Agent 配置和预算上限 |
>
> **验收：** 4 事件各有独立测试用例；付款失败宽限期用 BullMQ mock 验证

---

##### Day 5–6 — 对账 + API 路由

> **🃏 CARD-S16-D5-01 · `reconciliation.ts` + 计费 API 路由**
>
> **类型：** 新建文件  
> **耗时：** 1.5d
>
> **对账逻辑：**
> - 每日 cron 拉取 Stripe 最近 24h 的 Meter Events
> - 与 `billing_usage_logs` 中 `reported_to_stripe = true` 的记录做差异比对
> - 差异 >1% 时创建 P2 告警 Ticket
>
> **API 路由（`apps/api/src/routes/billing.ts`）：**
> - `POST /api/v1/billing/checkout-session` — 创建 Stripe Checkout Session → 返回 URL
> - `GET /api/v1/billing/portal-session` — 创建 Stripe Customer Portal Session → 返回 URL
> - `GET /api/v1/billing/usage` — 当月用量概览（已用/额度/超额）
>
> **Webhook 路由（`apps/api/src/routes/webhook-stripe.ts`）：**
> - `POST /api/v1/webhooks/stripe` — 签名验证 + 分发到 `webhook-handler.ts`
>
> **验收：** Checkout Session URL 可打开 Stripe 支付页面

---

##### Day 7 — 全链路测试 + 回归

> **🃏 CARD-S16-D7-01 · 计费全链路 E2E 测试**
>
> **类型：** 测试  
> **耗时：** 1d
>
> **测试场景（Stripe Test Mode）：**
> 1. 创建 Starter 订阅 → 验证 Stripe Dashboard
> 2. 14 天 Trial → 使用 Stripe Test Clock 快进 → 自动扣款
> 3. 模拟 Agent 用量 → 超额 → Meter Event 存在
> 4. 模拟付款失败 → 3 天宽限 → Agent 暂停
> 5. Starter → Growth 升级 → 新 Agent 立即可用
> 6. 取消订阅 → Agent 暂停 → 30 天后数据删除
>
> **验收：** 6 场景全绿 → AC-P5-01~06 全部 PASS

---

### Sprint 17 · Week 5–6 — 自助 Onboarding

**交付物：** 7 步 Onboarding 状态机 · OAuth 引导 + 卡点预防 · Agent 健康检查 · Onboarding API · 前端 7 步向导 · Dashboard 页面 · Console 真实 API

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 17.1 | `onboarding-machine.ts`：7 步状态机（前进/后退/跳过/完成） | `packages/onboarding/` | S15 | 1d |
| 17.2 | `oauth-guide.ts`：4 平台 OAuth 引导 + 4 种卡点预防（PDF §03） | `packages/onboarding/` | 17.1 | 1.5d |
| 17.3 | `health-check.ts`：Agent 心跳检查 + API 连通性验证 + 自动重启 | `packages/onboarding/` | 17.1 | 1d |
| 17.4 | `apps/api/src/routes/onboarding-flow.ts`：Onboarding 7 步 API | `apps/api/` | 17.1–17.3 | 1d |
| 17.5 | `apps/web/src/components/onboarding-wizard.tsx`：7 步向导主组件 | `apps/web/` | 17.4 | 1d |
| 17.6 | `apps/web/src/components/plan-selector.tsx`：套餐选择卡片（3 档对比） | `apps/web/` | S16 | 0.5d |
| 17.7 | `apps/web/src/components/oauth-connector.tsx`：OAuth 授权连接器 | `apps/web/` | 17.2 | 1d |
| 17.8 | `apps/web/src/components/agent-org-chart.tsx`：Agent 组织架构可视化 | `apps/web/` | — | 0.5d |
| 17.9 | `apps/web/src/components/health-check-panel.tsx`：健康检查面板 | `apps/web/` | 17.3 | 0.5d |
| 17.10 | `apps/web/src/app/onboarding/page.tsx`：整合向导页面 | `apps/web/` | 17.5–17.9 | 0.5d |
| 17.11 | `apps/web/src/app/dashboard/page.tsx`：消费 console API（Phase 4 已有） | `apps/web/` | S15 | 1d |
| 17.12 | 遗留 L-05：Console DataOS/Alert 接真实 API | `apps/api/` | — | 0.5d |
| 17.13 | Onboarding E2E 测试（10 个模拟用户 <30min 验证） | 全栈 | 17.1–17.12 | 1d |
| 17.14 | S17 typecheck + lint + 回归 | all | 17.1–17.13 | 0.5d |

**Sprint 17 验收：**
- [ ] 全流程 < 30 分钟（10 个测试用户计时）（**AC-P5-07**）
- [ ] OAuth 失败 → 清晰报错 + 重试按钮（**AC-P5-08**）
- [ ] Amazon 未申请资质 → 引导跳过先接其他平台（**AC-P5-09**）
- [ ] 健康检查全通过 → Dashboard 显示所有 Agent ACTIVE（**AC-P5-10**）

---

#### Sprint 17 · Day-by-Day 实施细节

##### Day 1 — Onboarding 状态机

> **🃏 CARD-S17-D1-01 · `onboarding-machine.ts` 7 步状态机**
>
> **类型：** 新建文件  
> **耗时：** 1d  
> **目标文件：** `packages/onboarding/src/onboarding-machine.ts`
>
> **7 步定义（PDF §03 对齐）：**
>
> | Step | 名称 | 输入 | 完成条件 |
> |------|------|------|---------|
> | 1 | 注册账号 | 邮箱+密码 | tenant 创建 + 邮件验证 |
> | 2 | 选择套餐 | 套餐选择 | Stripe Checkout 完成 |
> | 3 | 公司信息 | 公司名/品类/市场 | 写入 tenant config |
> | 4 | 平台授权 | OAuth 授权 | ≥1 平台授权成功 |
> | 5 | Agent 配置 | 自动 seed | Agent Org Chart 展示 |
> | 6 | 治理偏好 | 调价阈值/广告额度/上架审批 | 配置保存 |
> | 7 | 上线验证 | 自动健康检查 | 全部通过 → Dashboard |
>
> **状态机核心：**
> ```typescript
> export interface OnboardingState {
>   currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7
>   stepData: Record<number, unknown>
>   oauthStatus: Record<string, 'pending' | 'success' | 'failed'>
>   healthCheckPassed: boolean
>   completedAt: Date | null
> }
>
> export function advanceStep(state: OnboardingState, stepResult: unknown): OnboardingState
> export function canAdvance(state: OnboardingState): boolean
> export function skipPlatform(state: OnboardingState, platform: string): OnboardingState
> ```
>
> **验收：** 单元测试覆盖：正常 7 步前进、跳过平台、后退、Step 4 OAuth 失败重试

---

##### Day 2–3 — OAuth 引导 + 健康检查

> **🃏 CARD-S17-D2-01 · `oauth-guide.ts` 卡点预防**
>
> **类型：** 新建文件  
> **耗时：** 1.5d  
> **目标文件：** `packages/onboarding/src/oauth-guide.ts`
>
> **4 种卡点预防（PDF §03 对齐）：**
>
> | 卡点 | 发生率 | 预防措施 |
> |------|--------|---------|
> | Shopify OAuth 失败 | ~15% | 详细报错 + 视频引导链接 + 一键重新授权 |
> | Amazon SP-API 未审核 | ~40% | 自动检测 → 显示申请指引 → 跳过 Amazon 先接其他平台 |
> | Shopee 多市场混淆 | ~20% | 引导先接 SG → 验证通过 → 再扩展 |
> | Agent 心跳首次不触发 | ~5% | 健康检查异常 → 自动重启 Agent + 刷新提示 |
>
> **验收：** 每种卡点有对应的错误处理和引导策略

---

> **🃏 CARD-S17-D3-01 · `health-check.ts` 上线验证**
>
> **类型：** 新建文件  
> **耗时：** 1d  
> **目标文件：** `packages/onboarding/src/health-check.ts`
>
> **检查项：**
> 1. 平台 API 连通性（至少 1 个平台 `getProducts` 返回数据）
> 2. Agent 心跳（套餐内所有 Agent 至少触发 1 次心跳）
> 3. 数据写入（`agent_events` 表有该租户记录）
> 4. 审批系统（创建测试审批 → 可查询到）
>
> 异常处理：单项检查失败 → 自动重试 1 次 → 仍失败 → 显示具体错误 + 建议操作
>
> **验收：** 全部通过 → 返回 `{ passed: true }`；部分失败 → 返回详细错误列表

---

##### Day 4–5 — 前端向导 + API

> **🃏 CARD-S17-D4-01 · Onboarding API + 前端 7 步向导**
>
> **类型：** 新建文件（API + 前端）  
> **耗时：** 2.5d
>
> **API 端点（`apps/api/src/routes/onboarding-flow.ts`）：**
> - `GET /api/v1/onboarding/status` — 当前步骤 + 状态
> - `POST /api/v1/onboarding/step/:step` — 提交步骤数据
> - `POST /api/v1/onboarding/skip-platform/:platform` — 跳过平台
> - `POST /api/v1/onboarding/health-check` — 触发健康检查
>
> **前端组件：**
> - `onboarding-wizard.tsx`：步骤进度条 + 内容切换
> - `plan-selector.tsx`：3 档套餐对比卡片 → 选择后跳 Stripe Checkout
> - `oauth-connector.tsx`：平台 OAuth 按钮 + 状态指示器（pending/success/failed）
> - `agent-org-chart.tsx`：Agent 组织架构树形图
> - `health-check-panel.tsx`：4 项检查实时状态
>
> **验收：** 从 `/onboarding` 可走完全部 7 步

---

##### Day 6 — Dashboard + Console 真实 API

> **🃏 CARD-S17-D6-01 · Dashboard 页面 + Console 真实 API**
>
> **类型：** 新建前端页面 + 遗留修复  
> **耗时：** 1.5d
>
> **Dashboard（`apps/web/src/app/dashboard/page.tsx`）：**
> - 三列布局：ElectroOS 状态 | DevOS 状态 | DataOS 状态
> - 消费 Phase 4 已有 `GET /api/v1/console/electroos` / `devos` / `dataos` API
> - 待审批数量徽章 + 快速跳转
> - 月度用量仪表盘（当前/额度/超额）
>
> **遗留 L-05：Console 真实 API**
> - 将 `console.ts` 中的 synthetic 数据替换为真实 DataOS 查询
> - Alert 数据从 Prometheus AlertManager 拉取
>
> **验收：** Dashboard 展示真实 Agent 状态和用量数据

---

##### Day 7 — E2E 测试 + 回归

> **🃏 CARD-S17-D7-01 · Onboarding E2E 测试**
>
> **类型：** 测试  
> **耗时：** 1d
>
> **测试场景：**
> 1. 标准路径：注册 → Starter → 公司信息 → Shopify OAuth → Agent seed → 默认治理 → 健康检查 ✅ → Dashboard（记录耗时 <30min）
> 2. OAuth 失败：Shopify OAuth 返回错误 → 显示重试按钮 → 重试成功
> 3. Amazon 跳过：Step 4 选 Amazon → 检测未审核 → 引导跳过 → 先接 Shopify
> 4. 健康检查失败：模拟 Agent 心跳超时 → 自动重启 → 重试通过
>
> **验收：** 4 场景覆盖 AC-P5-07~10

---

### Sprint 18 · Week 7–8 — ClipMart 模板市场

**交付物：** 模板 CRUD + 搜索 · 安全校验 · 一键导入 · 评分 · 5 个官方模板 · 前端浏览页面 · ClipMart API

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 18.1 | `template.service.ts`：模板 CRUD + 按品类/市场/平台搜索 | `packages/clipmart/` | S15 | 1.5d |
| 18.2 | `security-validator.ts`：模板配置深度递归校验 | `packages/clipmart/` | — | 1d |
| 18.3 | `import.service.ts`：一键导入（深度合并 + tenantId 强制覆盖） | `packages/clipmart/` | 18.1 | 1d |
| 18.4 | `review.service.ts`：评分 + 评论 + GMV 变化 + 平均分计算 | `packages/clipmart/` | 18.1 | 1d |
| 18.5 | `official-templates.ts`：5 个官方模板种子数据 + JSON 文件 | `packages/clipmart/` + `harness-config/` | 18.1 | 1d |
| 18.6 | `apps/api/src/routes/clipmart.ts`：ClipMart API 路由 | `apps/api/` | 18.1–18.5 | 1d |
| 18.7 | `apps/web/src/app/clipmart/page.tsx`：模板浏览 + 搜索 | `apps/web/` | 18.6 | 1d |
| 18.8 | `apps/web/src/app/clipmart/[id]/page.tsx`：模板详情 + 导入 + 评分 | `apps/web/` | 18.6 | 0.5d |
| 18.9 | `scripts/seed-official-templates.ts`：官方模板 seed 脚本 | `scripts/` | 18.5 | 0.5d |
| 18.10 | ClipMart 安全测试（恶意模板拦截） + S18 回归 | 全栈 | 18.1–18.9 | 1d |

**Sprint 18 验收：**
- [ ] 5 个官方模板上线，搜索"定价"命中（**AC-P5-11**）
- [ ] 一键导入 Standard 模板 → Agent 配置一致（**AC-P5-12**）
- [ ] 恶意模板（修改 Constitution）被拒绝（**AC-P5-13**）
- [ ] 下载计数递增 + 评分正常保存（**AC-P5-14**）

---

#### Sprint 18 · Day-by-Day 实施细节

##### Day 1–2 — 模板服务 + 安全校验

> **🃏 CARD-S18-D1-01 · `template.service.ts`**
>
> **类型：** 新建文件  
> **耗时：** 1.5d  
> **目标文件：** `packages/clipmart/src/template.service.ts`
>
> **核心函数：**
> ```typescript
> export async function createTemplate(input: CreateTemplateInput): Promise<ClipmartTemplate>
> export async function getTemplate(id: string): Promise<ClipmartTemplate | null>
> export async function searchTemplates(filters: TemplateSearchFilters): Promise<ClipmartTemplate[]>
> // filters: { category?, targetMarkets?, platforms?, query? }
> // query 做 name + description 的 ILIKE 搜索
> export async function incrementDownloads(templateId: string): Promise<void>
> export async function updateRating(templateId: string): Promise<void>
> // 从 template_reviews 重新计算平均分
> ```
>
> **验收：** CRUD + 搜索测试通过；搜索"定价"返回含相关模板

---

> **🃏 CARD-S18-D2-01 · `security-validator.ts` 模板安全校验**
>
> **类型：** 新建文件  
> **耗时：** 1d  
> **目标文件：** `packages/clipmart/src/security-validator.ts`
>
> **校验规则：**
> 1. **Constitution 保护：** 模板 config 中不允许包含修改 `system-constitution.md` 的指令
> 2. **字段白名单：** 只允许已知 Agent 配置字段（`agents[]` / `governance` / `dataosTier`）
> 3. **递归深度限制：** JSON 嵌套不超过 10 层
> 4. **敏感字段过滤：** 自动移除 `apiKeys` / `tokens` / `credentials` 等字段
> 5. **跨租户保护：** `tenantId` 字段不允许出现在模板中（导入时强制覆盖）
>
> ```typescript
> export function validateTemplateConfig(config: unknown): ValidationResult
> // throws SecurityValidationError if any rule violated
> ```
>
> **验收：** 恶意模板（含 Constitution 修改指令）被拒绝 → AC-P5-13

---

##### Day 3–4 — 导入 + 评分 + 官方模板

> **🃏 CARD-S18-D3-01 · `import.service.ts` 一键导入**
>
> **类型：** 新建文件  
> **耗时：** 1d  
> **目标文件：** `packages/clipmart/src/import.service.ts`
>
> **核心逻辑（PDF §04 STEP 4.2 对齐）：**
> ```typescript
> export async function importTemplate(
>   tenantId: string,
>   templateId: string,
>   overrides?: Partial<AgentConfig>
> ): Promise<void>
> // 1. 获取模板 config
> // 2. validateTemplateConfig(config) — 安全检查
> // 3. deepMerge(config, overrides, { tenantId }) — tenantId 强制覆盖
> // 4. 遍历 agents → upsert 每个 Agent 配置
> // 5. incrementDownloads(templateId)
> // 6. eventLake.record({ tenantId, eventType: "template_imported" })
> ```
>
> **验收：** 导入 Standard 模板后 → 租户 Agent 配置与模板完全一致 → AC-P5-12

---

> **🃏 CARD-S18-D4-01 · `review.service.ts` + `official-templates.ts`**
>
> **类型：** 新建文件（2 个）  
> **耗时：** 1.5d
>
> **评分服务：**
> - `createReview(templateId, tenantId, rating, comment?, gmvChange?)` → 写入 + 更新模板平均分
> - `getReviews(templateId)` → 分页获取评论
>
> **5 个官方模板（PDF §04 对齐）：**
>
> | 模板名 | 品类 | 平台 | Agent 配置 |
> |--------|------|------|-----------|
> | Standard Cross-Border | full-stack | Shopify + Amazon | 全部 9 Agent |
> | SEA Marketplace | 东南亚多平台 | TikTok + Shopee | 定价+客服+广告 |
> | Amazon PPC Pro | 广告优化 | Amazon | Ads Optimizer 深度配置 |
> | Fast Fashion | 服装高频上新 | 全平台 | 选品+内容+库存 |
> | B2B Wholesale | 企业采购 | B2B Portal + Amazon Business | B2B Harness + 全套 |
>
> **验收：** 5 模板 JSON 文件完整；seed 脚本写入 DB

---

##### Day 5–7 — API + 前端 + 测试

> **🃏 CARD-S18-D5-01 · ClipMart API + 前端**
>
> **类型：** 新建路由 + 页面  
> **耗时：** 2.5d
>
> **API 端点（`apps/api/src/routes/clipmart.ts`）：**
> - `GET /api/v1/clipmart/templates` — 搜索模板（query/category/market/platform）
> - `GET /api/v1/clipmart/templates/:id` — 模板详情
> - `POST /api/v1/clipmart/templates` — 发布模板（需认证）
> - `POST /api/v1/clipmart/templates/:id/import` — 一键导入
> - `POST /api/v1/clipmart/templates/:id/reviews` — 提交评分
> - `GET /api/v1/clipmart/templates/:id/reviews` — 获取评分列表
>
> **前端页面：**
> - `/clipmart`：网格布局展示模板卡片；顶部搜索栏 + 品类/平台筛选
> - `/clipmart/[id]`：模板详情 + 配置预览 + "一键导入"按钮 + 评分列表
>
> **验收：** 搜索"定价"返回结果；导入流程走通；评分提交后平均分更新

---

### Sprint 19 · Week 9–10 — 客户成功 + SLA

**交付物：** Customer Success Agent · 健康评分体系 · NPS 问卷 · 自动升级建议 · SLA 等级定义 · 赔偿逻辑 · Settings 页面

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 19.1 | `customer-success.agent.ts`：CS Agent 主体 + heartbeat 配置 | `packages/agent-runtime/` | S15 | 1.5d |
| 19.2 | CS Agent `calcHealthScore`：4 维度加权评分 | `packages/agent-runtime/` | 19.1 | 1d |
| 19.3 | CS Agent 干预逻辑：健康 <40 → Resend 邮件 + P1 Ticket | `packages/agent-runtime/` | 19.2 | 1d |
| 19.4 | CS Agent 升级逻辑：健康 >80 → 升级建议 + 邀请评价 | `packages/agent-runtime/` | 19.2 | 0.5d |
| 19.5 | `nps.service.ts`：使用满 30 天自动发送 NPS 问卷（Resend） | `packages/growth/` | — | 1d |
| 19.6 | `auto-upsell.ts`：连续 2 月超额 >20% → 自动发送升级建议邮件 | `packages/growth/` | S16 | 1d |
| 19.7 | SLA 赔偿逻辑（可用性计算 + 赔偿百分比） | `packages/billing/` | — | 1d |
| 19.8 | `apps/web/src/app/settings/page.tsx`：治理偏好 + 账户设置 | `apps/web/` | — | 1d |
| 19.9 | `packages/agent-runtime/src/types.ts`：新增 CS Agent 类型 | `packages/agent-runtime/` | 19.1 | 0.5d |
| 19.10 | `packages/agent-runtime/src/electroos-seed.ts`：新增 CS Agent 种子 | `packages/agent-runtime/` | 19.1 | 0.5d |
| 19.11 | CS Agent 全量测试 + S19 回归 | all | 19.1–19.10 | 1d |

**Sprint 19 验收：**
- [ ] CS Agent 每日扫描 → 健康 <40 收到干预邮件（**AC-P5-15**）
- [ ] NPS 问卷：使用满 30 天自动发送（**AC-P5-17**）

---

#### Sprint 19 · Day-by-Day 实施细节

##### Day 1–2 — Customer Success Agent 核心

> **🃏 CARD-S19-D1-01 · `customer-success.agent.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2.5d  
> **目标文件：** `packages/agent-runtime/src/agents/customer-success.agent.ts`
>
> **特殊性：** 平台级 Agent — 不属于任何租户，扫描全部活跃租户
>
> **核心实现（PDF §05 对齐）：**
> ```typescript
> export const customerSuccessAgent = {
>   name: 'customer-success',
>   heartbeat: '0 9 * * *', // 每日 09:00
>   model: 'claude-sonnet-4-6',
>   budget: { monthly_usd: 200 },
>
>   async run(ctx: AgentContext): Promise<CsAgentResult> {
>     const tenants = await getAllActiveTenants()
>     const results: TenantHealthResult[] = []
>     for (const tenant of tenants) {
>       const score = await this.calcHealthScore(tenant)
>       if (score < 40) {
>         await this.handleChurnRisk(ctx, tenant, score)
>       } else if (score > 80) {
>         await this.handleHighSatisfaction(ctx, tenant, score)
>       }
>       results.push({ tenantId: tenant.id, score })
>     }
>     return { tenantsScanned: tenants.length, results }
>   }
> }
> ```
>
> **健康评分（PDF §05 STEP 5.2 对齐）：**
>
> | 维度 | 权重 | 绿色 | 黄色 | 红色 |
> |------|------|------|------|------|
> | Agent 心跳正常率 | 30% | >95% | 80–95% | <80% |
> | 30 天登录次数 | 20% | >10 次 | 3–10 次 | <3 次 |
> | 审批平均响应 | 20% | <4h | 4–24h | >24h |
> | GMV 30 天趋势 | 30% | +增长 | ±5% | 下降>10% |
>
> **验收：** 扫描 mock 租户 → 低分租户触发邮件 + Ticket

---

##### Day 3–4 — NPS + 自动升级建议

> **🃏 CARD-S19-D3-01 · `nps.service.ts` + `auto-upsell.ts`**
>
> **类型：** 新建文件（2 个）  
> **耗时：** 2d
>
> **NPS 服务：**
> - `checkAndSendNps(tenantId)` — 检查注册 ≥30 天且未发过 NPS → 通过 Resend 发送
> - `recordNpsResponse(tenantId, score, feedback)` → 写入 `nps_responses`
> - NPS 分类：Promoter (9-10) / Passive (7-8) / Detractor (0-6)
>
> **自动升级建议：**
> - `checkUpsellEligibility(tenantId)` — 查询最近 2 个月 `billing_usage_logs` → 超额 >20% → 触发
> - 通过 Resend 发送个性化升级建议邮件（含用量数据 + 升级后收益预测 + 一键升级链接）
>
> **验收：** 30 天后触发 NPS；连续超额触发升级建议

---

##### Day 5 — SLA 赔偿逻辑

> **🃏 CARD-S19-D5-01 · SLA 赔偿计算**
>
> **类型：** 新建逻辑  
> **耗时：** 1d  
> **目标文件：** `packages/billing/src/sla-compensation.ts`
>
> **SLA 赔偿规则（PDF §07 对齐）：**
>
> | 场景 | 赔偿标准 |
> |------|---------|
> | 可用性低于 SLA 每 0.1% | 当月账单 5% |
> | 可用性低于 99% | 当月账单 30% |
> | 可用性低于 95% | 当月账单 100% |
> | DataOS 数据丢失 >1h | 当月账单 20% |
> | Agent 系统 Bug 导致未审批操作 | 直接损失 100% |
>
> **计算公式：**
> ```typescript
> export function calculateSlaCompensation(
>   plan: PlanName,
>   actualUptime: number,
>   incidents: SlaIncident[]
> ): CompensationResult
> ```
>
> **验收：** 边界测试（99.5% 精确匹配 Starter SLA）

---

##### Day 6–7 — Settings 页面 + 回归

> **🃏 CARD-S19-D6-01 · Settings 页面 + CS Agent 测试**
>
> **类型：** 前端 + 测试  
> **耗时：** 2d
>
> **Settings 页面（`apps/web/src/app/settings/page.tsx`）：**
> - 治理偏好：调价阈值滑块（5%–30%）、广告审批额度、新品上架审批开关
> - 账户信息：公司名、主营品类、目标市场
> - 套餐信息：当前套餐 + 用量概览 + "管理订阅"按钮（→ Stripe Customer Portal）
> - 推荐码显示 + 复制按钮
>
> **CS Agent 全量测试场景：**
> 1. 健康评分 35（低于 40）→ 干预邮件发送 + P1 Ticket 创建
> 2. 健康评分 85（高于 80）→ 升级建议发送
> 3. 注册满 30 天 → NPS 问卷发送
> 4. 连续 2 月超额 25% → 升级建议邮件
>
> **验收：** AC-P5-15 + AC-P5-17

---

### Sprint 20 · Week 11–12 — 增长机制 + 最终验收

**交付物：** 推荐码系统 · 模板贡献激励 · 年付套餐 · Growth API · Stripe Live Mode 切换 · 全 22 项 AC · 首批 20 租户冲刺 · Phase 6 GO 决策

| # | 任务 | 包/目录 | 依赖 | 估时 |
|---|------|---------|------|------|
| 20.1 | `referral.service.ts`：推荐码生成（`ELEC-XXXX`）+ 核销 | `packages/growth/` | S15 | 1d |
| 20.2 | `reward.service.ts`：被推荐方试用延长 30 天 + 推荐方 20% 折扣 | `packages/growth/` | 20.1 | 1d |
| 20.3 | 模板贡献激励：下载 ≥5 → 赠送 1 月服务费折扣 | `packages/growth/` + `packages/clipmart/` | S18 | 0.5d |
| 20.4 | 年付套餐：Stripe 新增 yearly Price（8 折）+ 提前解约 50% | `packages/billing/` | S16 | 0.5d |
| 20.5 | `apps/api/src/routes/growth.ts`：推荐码 + NPS API 路由 | `apps/api/` | 20.1–20.2 | 0.5d |
| 20.6 | `apps/api/app.ts`：注册 `onboardingFlowRoute` + `clipmartRoute` + `growthRoute` | `apps/api/` | S17–S20 | 0.5d |
| 20.7 | Stripe Live Mode 切换 + 生产环境 Webhook 配置 | 运维操作 | — | 0.5d |
| 20.8 | `scripts/phase5-ac-verify.ts`：22 项 AC 自动验证脚本 | `scripts/` | — | 1d |
| 20.9 | 全 22 项 AC 逐项验证 | 全栈 | 20.1–20.8 | 2d |
| 20.10 | 首批 20 租户注册冲刺 | 运营操作 | 20.7 | 2d |
| 20.11 | Phase 6 GO/NOGO 决策文档 | 文档 | 20.9–20.10 | 0.5d |

**Sprint 20 验收：**
- [ ] 推荐码注册 → 试用延长 30 天 + 付费后推荐方折扣（**AC-P5-16**）
- [ ] 模板贡献：下载 ≥5 → 赠送 1 月折扣（**AC-P5-18**）
- [ ] 20 个付费租户注册 + MRR ≥ $6,000（**AC-P5-19**）
- [ ] 月留存率 ≥ 85%（**AC-P5-20**）
- [ ] 自助 Onboarding 成功率 ≥ 90%（**AC-P5-21**）
- [ ] Support Ticket < 5 个/租户/月（**AC-P5-22**）

---

#### Sprint 20 · Day-by-Day 实施细节

##### Day 1–2 — 推荐码系统

> **🃏 CARD-S20-D1-01 · `referral.service.ts` + `reward.service.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2d
>
> **推荐码服务（PDF §06 STEP 6.1 对齐）：**
> ```typescript
> export class ReferralService {
>   async generateCode(tenantId: string): Promise<string>
>   // 生成 8 位短码：ELEC-AB12
>
>   async applyReferral(newTenantId: string, code: string): Promise<void>
>   // 1. 查找推荐方
>   // 2. 被推荐方：试用从 14 天延长到 30 天（stripe.subscriptions.update trial_end）
>   // 3. 推荐方：创建 pending 奖励（被推荐方付费后兑现 20% 折扣 1 个月）
>
>   async fulfillReward(newTenantId: string): Promise<void>
>   // 被推荐方首次付费后调用 → 推荐方获得 Stripe coupon 20% off
> }
> ```
>
> **验收：** 推荐码生成唯一；核销后试用延长；付费后折扣生效

---

##### Day 3 — 模板激励 + 年付套餐

> **🃏 CARD-S20-D3-01 · 模板贡献激励 + 年付套餐**
>
> **类型：** 代码变更  
> **耗时：** 1d
>
> **模板贡献激励：**
> - 在 `import.service.ts` 中 `incrementDownloads` 后检查：下载数 ≥5 且未发过奖励 → 自动赠送 1 月服务费折扣
> - Stripe Coupon：`100_pct_off_1_month`，绑定 author_tenant_id
>
> **年付套餐：**
> - 在 Stripe 新增 3 个 yearly Price（`price_starter_yearly_xxx` 等）
> - `subscription.service.ts` 新增 `switchToAnnual(tenantId)` — 切换到年付 8 折
> - 提前解约：剩余月数 50% 作为违约金（通过 Stripe Invoice 手动创建）
>
> **验收：** 年付价格 = 月付 × 12 × 0.8

---

##### Day 4 — Growth API + App 路由注册

> **🃏 CARD-S20-D4-01 · Growth API + App 路由完整注册**
>
> **类型：** 新建路由 + 变更  
> **耗时：** 1d
>
> **Growth API（`apps/api/src/routes/growth.ts`）：**
> - `GET /api/v1/growth/referral-code` — 获取当前租户推荐码
> - `POST /api/v1/growth/apply-referral` — 使用推荐码
> - `POST /api/v1/growth/nps` — 提交 NPS 评分
>
> **`apps/api/src/app.ts` 更新：**
> ```typescript
> // Phase 5 新增路由
> import authRoute from './routes/auth.js'
> import billingRoute from './routes/billing.js'
> import webhookStripeRoute from './routes/webhook-stripe.js'
> import onboardingFlowRoute from './routes/onboarding-flow.js'
> import clipmartRoute from './routes/clipmart.js'
> import growthRoute from './routes/growth.js'
>
> // 注册
> app.register(authRoute)
> app.register(billingRoute)
> app.register(webhookStripeRoute)
> app.register(onboardingFlowRoute)
> app.register(clipmartRoute)
> app.register(growthRoute)
> ```
>
> **验收：** 全部 Phase 5 API 路由可访问

---

##### Day 5 — Stripe Live Mode + AC 脚本

> **🃏 CARD-S20-D5-01 · Stripe Live Mode 切换 + AC 验证脚本**
>
> **类型：** 运维 + 脚本  
> **耗时：** 1.5d
>
> **Live Mode 切换：**
> 1. 在 Stripe Live Mode 创建 3 Product + 3 Price + 1 Meter（镜像 Test Mode 配置）
> 2. 更新 `.env.production` 中所有 `STRIPE_*` 环境变量
> 3. 配置 Live Mode Webhook endpoint → 指向生产 API
> 4. 验证：创建真实 $1 测试订阅 → 确认扣款 → 立即退款
>
> **AC 验证脚本（`scripts/phase5-ac-verify.ts`）：**
> - 自动检查 22 项 AC 中可自动化验证的项目
> - 输出 JSON 格式报告：`{ ac: "AC-P5-01", status: "pass", evidence: "..." }`
>
> **验收：** Live Mode 配置就绪；AC 脚本可运行

---

##### Day 6–7 — 全量验收 + 20 租户冲刺

> **🃏 CARD-S20-D6-01 · 全 22 项 AC 验证 + Phase 6 GO 决策**
>
> **类型：** 验收 + 文档  
> **耗时：** 2.5d
>
> **验收流程：**
> 1. 运行 `pnpm exec tsx scripts/phase5-ac-verify.ts` → 自动化检查
> 2. 手动验证需人工确认的 AC（如 20 租户注册、留存率、Ticket 数量）
> 3. 编写 `docs/ops/sprint20-acceptance-evidence.md`
> 4. 编写 `docs/ops/sprint20-phase6-go-decision.md`
>
> **20 租户冲刺：**
> - Beta 邀请名单（S18 起积累）→ 逐批注册
> - 监控 Onboarding 成功率 → 卡点实时修复
> - 首周 MRR 统计
>
> **验收：** 22/22 AC 全部通过 → Phase 6 GO

---

## 9. 验收清单（22 项）

### 计费系统（6 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P5-01 | Stripe Subscription 创建正常：注册+选套餐后 Stripe Dashboard 有客户和订阅记录 | S16 | ⬜ |
| AC-P5-02 | 14 天试用结束后自动扣款：Stripe Test Clock 验证 | S16 | ⬜ |
| AC-P5-03 | 付款失败处理：模拟信用卡失败，3 天宽限期后 Agent 暂停 | S16 | ⬜ |
| AC-P5-04 | Token 超额计费：Agent 用量超过套餐 → Stripe Meter 收到上报 → 月底含超额 | S16 | ⬜ |
| AC-P5-05 | 升降级套餐：Growth → Scale 后新 Agent 立即生效，按日差额计费 | S16 | ⬜ |
| AC-P5-06 | 退订流程：取消后 Agent 暂停，30 天后数据删除（定时任务触发） | S16 | ⬜ |

### 自助 Onboarding（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P5-07 | 全流程 < 30 分钟：10 个测试用户从注册到首个 Agent 运行完整耗时 | S17 | ⬜ |
| AC-P5-08 | OAuth 失败时有清晰报错 + 重试按钮（Shopify/TikTok/Shopee 各测 1 次） | S17 | ⬜ |
| AC-P5-09 | Amazon 未申请资质时，引导跳过先接其他平台 | S17 | ⬜ |
| AC-P5-10 | 健康检查全通过后，Dashboard 显示所有 Agent ACTIVE | S17 | ⬜ |

### ClipMart 模板市场（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P5-11 | 5 个官方模板上线，搜索"定价"命中 | S18 | ⬜ |
| AC-P5-12 | 一键导入 Standard 模板：导入后租户 Agent 配置与模板一致 | S18 | ⬜ |
| AC-P5-13 | 恶意模板（含修改 System Constitution 指令）被系统拒绝 | S18 | ⬜ |
| AC-P5-14 | 下载计数正确递增，评分功能正常保存 | S18 | ⬜ |

### 客户成功 & 增长（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P5-15 | CS Agent 每日扫描所有租户，健康 <40 的租户收到干预邮件 | S19 | ⬜ |
| AC-P5-16 | 推荐码：用推荐码注册后试用延长 30 天，推荐方在被推荐方付费后收到折扣 | S20 | ⬜ |
| AC-P5-17 | NPS 调查：使用满 30 天自动发送 | S19 | ⬜ |
| AC-P5-18 | ClipMart 模板贡献：下载 ≥5 次后赠送 1 月服务费折扣 | S20 | ⬜ |

### 首批 20 租户目标（4 项）

| # | 验收条件 | Sprint | 状态 |
|---|---------|--------|------|
| AC-P5-19 | 完成 20 个付费租户注册（含试用期），MRR ≥ $6,000 | S20 | ⬜ |
| AC-P5-20 | 月留存率 ≥ 85%：第一个月内没有租户主动退订 | S20 | ⬜ |
| AC-P5-21 | 自助 Onboarding 成功率 ≥ 90%：≥18/20 租户无需人工介入 | S20 | ⬜ |
| AC-P5-22 | Support Ticket < 5 个/租户/月 | S20 | ⬜ |

---

## 10. 关键风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Stripe 计费与 Agent 预算对账不准 | 中 | 高 | ClickHouse 双写 + 每日对账脚本 + 差异 >1% 自动告警 |
| ClipMart 恶意模板绕过安全检查 | 低 | 高 | 深度递归校验 + 白名单字段策略 + 模板发布需人工审核（Phase 5 后期可放松） |
| OAuth 卡点导致 Onboarding 失败率高 | 高 | 高 | 4 种卡点预防（PDF §03）+ 视频引导 + "跳过平台"功能 |
| 12 周交付前端+后端压力大 | 中 | 中 | 前端最小壳；支付 UI 全交 Stripe；非核心页面 Phase 6 迭代 |
| 首批 20 租户招募困难 | 中 | 高 | S18 起同步 Beta 邀请；推荐码激励；14 天免费试用降低门槛 |
| Amazon/TikTok/Shopee 审核仍未通过 | 高 | 中 | Onboarding 支持"跳过该平台"；Shopify-only 也可完整使用 |
| 试用期结束大量退订 | 中 | 高 | CS Agent 提前干预；NPS 收集反馈；优质模板提升粘性 |

---

## 11. Agent 配置总览（Phase 5 后）

### ElectroOS 9 Agent + 1 平台级 Agent

| Agent | 触发 | 模型 | 月预算 | Phase | 套餐限制 |
|-------|------|------|--------|-------|---------|
| CEO Agent | daily 08:00 | claude-opus-4-6 | $80 | Phase 4 | Scale only |
| Product Scout | daily 06:00 | claude-sonnet-4-6 | $30 | Phase 1 | All plans |
| Price Sentinel | hourly | claude-haiku-4-5 | $50 | Phase 1 | All plans |
| Support Relay | event-driven | claude-sonnet-4-6 | $80 | Phase 1 | All plans |
| Ads Optimizer | 每 4h | claude-haiku-4-5 | $60 | Phase 2 | Growth+ |
| Inventory Guard | daily 08:00 | claude-haiku-4-5 | $20 | Phase 2 | Growth+ |
| Content Writer | on-demand | claude-sonnet-4-6 | $40 | Phase 3 | Growth+ |
| Market Intel | weekly 周一 | claude-sonnet-4-6 | $30 | Phase 3 | Growth+ |
| Finance Agent | monthly 1日 | claude-sonnet-4-6 | $40 | Phase 4 | Scale only |
| **Customer Success** | **daily 09:00** | **claude-sonnet-4-6** | **$200** | **Phase 5** | **平台级（不计入租户）** |

**ElectroOS 月总预算：$430/租户（不含 CS Agent 平台层 $200）**

### DevOS 12 Agent（不变）

月总预算：$720（与 Phase 4 相同）

---

## 12. Constitution 合规自查

| Constitution 条款 | Phase 5 对齐方式 | 状态 |
|------------------|-----------------|------|
| Ch2.1 模块化 | 5 个新 package 独立边界；API 通信 | ✅ |
| Ch2.2 API First | 6 条新 API 路由 + OpenAPI Schema | ✅ |
| Ch2.3 Harness 不可绕过 | Onboarding OAuth 经由现有 Harness；ClipMart 导入走 Agent seed | ✅ |
| Ch2.4 事件驱动 | 新增 `tenant.subscribed` / `billing.overage` / `template.imported` 事件 | ✅ |
| Ch2.5 数据所有权 | 每 package 独立 schema；跨域通过 API | ✅ |
| Ch3.1 技术栈 | Next.js + Tailwind + Fastify + Drizzle + PostgreSQL | ✅ |
| Ch4.1 命名规则 | kebab-case 文件名；PascalCase 类型 | ✅ |
| Ch5.2 禁止行为 | ClipMart 安全校验禁止修改 Constitution | ✅ |
| Ch5.4 审批门控 | 保留全部既有门控 + 新增模板发布审核 | ✅ |
| Ch6 多租户 RLS | 6 张新表全部 `tenant_id + RLS` | ✅ |
| Ch8.1 监控 | 新增 `billing.subscription.active` / `billing.usage.overage` / `cs.health_score` 指标 | ✅ |
| Ch9 安全 | NextAuth.js + JWT + RBAC + Stripe 签名验证 | ✅ |

---

## Related

- [System Constitution v1.0](../system-constitution.md)
- [Phase 5 Brainstorm](../brainstorms/2026-03-29-phase5-saas-commercialization-brainstorm.md)
- [Phase 5 PDF](Phase 5 ElectroOS SaaS 商业化 — 用户本地 PDF)
- [ADR-0005 · SaaS Billing 架构决策](../adr/0005-phase5-saas-billing.md) _(待创建)_
- [Phase 4 实施计划](./phase4-plan.md)
- [Phase 4 GO 决策](../ops/sprint14-phase5-go-decision.md)
- [Sprint 14 验收证据](../ops/sprint14-acceptance-evidence.md)
