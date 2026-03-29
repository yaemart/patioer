---
date: 2026-03-29
topic: phase5-saas-commercialization
source_pdf: "workspaceStorage/.../phase5-electroos.pdf (user local)"
related:
  - docs/plans/phase4-plan.md
  - docs/ops/sprint14-phase5-go-decision.md
  - docs/system-constitution.md
  - docs/brainstorms/2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md
---

# Phase 5 · SaaS 商业化 — 头脑风暴设计文档

## What We're Building

将 ElectroOS 从内部工具转变为可自助注册、付费使用的 SaaS 产品。12 周内完成：三档定价套餐、Stripe 双轨计费（订阅+用量）、7 步自助 Onboarding（<30 分钟）、ClipMart 模板市场、Customer Success Agent、推荐增长机制。最终目标：**首批 20 个付费租户上线，MRR > $10,000**。

## Why This Approach

### 混合架构：API-first 后端 + 轻量 Next.js 壳 + Stripe 托管支付

**方案对比：**

| 方案 | 优势 | 劣势 | 决策 |
|------|------|------|------|
| A: 纯 API + 无前端 | 后端交付速度快 | 自助 Onboarding 90% 成功率不可能达成 | ❌ |
| B: 完整 Next.js 前端 + 自建支付页 | 最佳用户体验 | 12 周内不够；PCI 合规负担 | ❌ |
| **C: 轻量 Next.js 壳 + Stripe Checkout/Portal** | 核心 UI 覆盖；支付零 PCI 负担；后端优先 | 非核心页面延后 | ✅ |

选择 C 的关键理由：
1. Stripe Checkout Session 处理支付页 + Stripe Customer Portal 处理订阅管理 → 省掉 60% 支付前端
2. 后端才是 Phase 5 技术核心（双轨计费、用量上报、对账、CS Agent）
3. Phase 6 可由 DevOS Frontend Agent 自主迭代前端

## Key Decisions

### D29: 认证方案 — NextAuth.js + JWT

- **方案：** NextAuth.js（`apps/web/`）+ JWT token
- **对齐：** Constitution Ch9（JWT Authentication + RBAC）
- **角色模型：** `admin` / `seller` / `agent` / `readonly`（Constitution Ch9 已定义）
- **实现：** NextAuth.js Credentials Provider（邮箱+密码）+ JWT session strategy

### D30: 支付架构 — Stripe Checkout + Customer Portal + Billing Meters

- **订阅收费：** Stripe Subscriptions（3 档 Price ID）
- **超额用量：** Stripe Billing Meters（实时上报 Agent token 用量）
- **支付 UI：** Stripe Checkout Session（注册付款）+ Stripe Customer Portal（升降级/取消/支付方式）
- **Webhook：** `invoice.payment_succeeded` / `payment_failed` / `subscription.deleted` / `subscription.updated`
- **环境策略：** S15–S19 Stripe Test Mode → S20 切 Live Mode
- **14 天免费试用：** Stripe `trial_period_days: 14`

### D31: 数据库策略 — Drizzle ORM + 领域自治 schema

- **ORM：** Drizzle（Constitution Ch3.1 强制）
- **原则：** Constitution Ch2.5 数据所有权 — 每个 package 拥有自己的 DB schema
- **RLS：** 所有新表强制 `tenant_id` + Row Level Security（Constitution Ch6）
- **Migration 管理：** 每个 package 独立 migrations 目录

| Package | 拥有的表 |
|---------|---------|
| `packages/db/` | `tenants` 表扩展（+`stripe_customer_id` / `stripe_subscription_id` / `plan` / `trial_ends_at`） |
| `packages/billing/` | `billing_usage_logs` · `billing_reconciliation` |
| `packages/clipmart/` | `clipmart_templates` · `template_reviews` |
| `packages/growth/` | `referral_codes` · `referral_rewards` · `nps_responses` |
| `packages/onboarding/` | `onboarding_progress`（7 步状态机） |

### D32: 前端范围 — Minimal Next.js Shell

- **位置：** `apps/web/`
- **技术栈：** Next.js + React + TypeScript + Tailwind（Constitution Ch3.1）
- **认证：** NextAuth.js
- **Phase 5 页面范围：**

| 路由 | 功能 | 复杂度 |
|------|------|--------|
| `/register` | 邮箱注册 + 邮件验证 | 低 |
| `/login` | 登录 | 低 |
| `/onboarding` | 7 步向导 | 中 |
| `/dashboard` | 三层状态（消费现有 console API） | 中 |
| `/clipmart` | 模板浏览 · 搜索 · 导入 · 评分 | 中 |
| `/settings` | 治理偏好 · 账户设置 | 低 |
| `/billing` → Stripe Customer Portal | 订阅管理（零自建 UI） | 无 |

### D33: CS Agent 架构 — 平台级 Agent

- **位置：** `packages/agent-runtime/src/agents/customer-success.agent.ts`
- **特殊性：** 平台级 Agent（不属于任何租户，扫描所有活跃租户）
- **心跳：** `0 9 * * *`（每天 09:00）
- **模型：** claude-sonnet-4-6
- **月预算：** $200（平台统一预算，不计入租户配额）
- **健康评分权重：** Agent 心跳 30% / 登录频率 20% / 审批响应 20% / GMV 趋势 30%

### D34: ClipMart 演进策略

Phase 4 已有 `clipmart-import.ts`（CLI）+ `clipmart-template.json`（单一模板）。Phase 5 将其**市场化**：

- Phase 4 CLI 脚本 → Phase 5 `packages/clipmart/` 完整服务
- 单一 JSON → PostgreSQL `clipmart_templates` 表 + 搜索 + 评分
- 5 个官方模板首发（PDF §04：Standard / SEA / Amazon PPC / Fast Fashion / B2B）
- 安全检查：禁止模板修改 System Constitution
- Phase 4 的 `clipmart-template.json` 作为 `Standard Cross-Border` 官方模板的数据源

### D35: Phase 4 遗留项处理

| 遗留项 | 处理 | Sprint | 理由 |
|--------|------|--------|------|
| Amazon SP-API 真实联调 | S15 并行 | S15 | Onboarding OAuth 需要 |
| TikTok Shop 真实联调 | S15 并行 | S15 | 同上 |
| Shopee 真实联调 | S15 并行 | S15 | 同上 |
| DB agentTypeEnum 扩展 | S15 Day 1 | S15 | 越早越干净 |
| Console DataOS/Alert 接真实 API | S17 | S17 | Dashboard 上线需要 |
| Shopify Inbox 完整对接 | Phase 6 | — | 非计费/增长关键路径 |
| 合规关键词动态加载 | Phase 6 | — | 静态配置满足需求 |

### D36: 定价套餐与 Agent 预算映射

| 套餐 | 月费 | 平台数 | Agent 数 | Agent 月预算 | DataOS |
|------|------|--------|---------|-------------|--------|
| Starter | $299 | 1 | 3（选品/定价/客服） | $160 | 无 |
| Growth | $799 | 3 | 7（全部运营 Agent） | $500 | Feature Store + Decision Memory |
| Scale | $1,999 | ≤5（含 B2B） | 全部 9 | $1,200 | 全部三层 + Benchmark |

超额计费（Stripe Billing Meters）：

| 用量类型 | Starter | Growth | Scale |
|---------|---------|--------|-------|
| Agent API Token（千 token） | $0.05 | $0.03 | $0.02 |
| 额外平台（月） | $99 | $79 | 已含 |
| 额外店铺（月） | 不支持 | $299 | $199 |
| DataOS 存储（GB/月） | 不支持 | $2 | $1 |

## Monorepo 增量结构（Phase 5）

```
patioer/
├── apps/
│   ├── web/                              # NEW: Next.js 前端应用
│   │   ├── src/
│   │   │   ├── app/                      # App Router
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── register/page.tsx
│   │   │   │   │   └── login/page.tsx
│   │   │   │   ├── onboarding/page.tsx
│   │   │   │   ├── dashboard/page.tsx
│   │   │   │   ├── clipmart/page.tsx
│   │   │   │   └── settings/page.tsx
│   │   │   ├── components/               # 共享 UI 组件
│   │   │   └── lib/
│   │   │       ├── auth.ts               # NextAuth.js 配置
│   │   │       └── api-client.ts         # 后端 API 客户端
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── tsconfig.json
│   └── api/
│       └── src/
│           └── routes/
│               ├── billing.ts            # NEW: 计费 API
│               ├── webhook.stripe.ts     # NEW: Stripe Webhook
│               ├── onboarding.ts         # NEW: Onboarding API
│               ├── clipmart.ts           # NEW: ClipMart API
│               ├── growth.ts             # NEW: 推荐码 + NPS API
│               └── auth.ts              # NEW: 注册/登录 API
├── packages/
│   ├── billing/                          # NEW: 计费领域
│   │   └── src/
│   │       ├── stripe-setup.ts           # Stripe 产品/价格配置
│   │       ├── subscription.service.ts   # 订阅创建/升降级/取消
│   │       ├── usage-reporter.ts         # Agent token 用量实时上报
│   │       ├── webhook-handler.ts        # Stripe Webhook 事件处理
│   │       ├── reconciliation.ts         # 内部 ClickHouse 对账
│   │       ├── billing.types.ts
│   │       ├── billing.schema.ts         # Drizzle schema
│   │       └── index.ts
│   ├── onboarding/                       # NEW: Onboarding 领域
│   │   └── src/
│   │       ├── onboarding-machine.ts     # 7 步状态机
│   │       ├── oauth-guide.ts            # 平台 OAuth 引导 + 卡点预防
│   │       ├── health-check.ts           # 上线验证（Agent 心跳检查）
│   │       ├── onboarding.types.ts
│   │       ├── onboarding.schema.ts      # Drizzle schema
│   │       └── index.ts
│   ├── clipmart/                         # NEW: ClipMart 领域（替代 CLI 脚本）
│   │   └── src/
│   │       ├── template.service.ts       # 模板 CRUD + 搜索
│   │       ├── import.service.ts         # 一键导入（从 Phase 4 scripts 迁移）
│   │       ├── review.service.ts         # 评分 + 评论
│   │       ├── security-validator.ts     # 模板安全校验（禁止修改 Constitution）
│   │       ├── official-templates.ts     # 5 个官方模板种子数据
│   │       ├── clipmart.types.ts
│   │       ├── clipmart.schema.ts        # Drizzle schema
│   │       └── index.ts
│   ├── growth/                           # NEW: 增长领域
│   │   └── src/
│   │       ├── referral.service.ts       # 推荐码生成 + 核销
│   │       ├── reward.service.ts         # 奖励兑现（20% 折扣）
│   │       ├── nps.service.ts            # NPS 问卷 + 统计
│   │       ├── auto-upsell.ts            # 自动扩容建议
│   │       ├── growth.types.ts
│   │       ├── growth.schema.ts          # Drizzle schema
│   │       └── index.ts
│   ├── agent-runtime/
│   │   └── src/
│   │       └── agents/
│   │           └── customer-success.agent.ts  # NEW: CS Agent（平台级）
│   └── shared/
│       └── src/
│           └── constants.ts              # EXTEND: 新增套餐常量 + SLA 等级
├── harness-config/
│   └── official-templates/               # NEW: 5 个官方 ClipMart 模板 JSON
│       ├── standard-cross-border.json
│       ├── sea-marketplace.json
│       ├── amazon-ppc-pro.json
│       ├── fast-fashion.json
│       └── b2b-wholesale.json
└── docs/
    ├── plans/
    │   └── phase5-plan.md                # → 下一步：从本 brainstorm 生成
    └── adr/
        └── 0005-phase5-saas-billing.md   # NEW: ADR-0005
```

## Sprint 时间轴（S15–S20 · 12 周）

### S15 · W1–2 — 基础设施 + 定价套餐 + 遗留修复

**交付物：** `apps/web/` 脚手架 · `packages/billing/` 骨架 · Stripe 产品/价格配置 · DB migrations（tenants 扩展 + billing 表） · agentTypeEnum 修复 · 平台联调启动

| 任务 | 描述 |
|------|------|
| 15.1 | `apps/web/` Next.js + NextAuth.js + Tailwind 脚手架 |
| 15.2 | `packages/billing/` 包初始化 + Stripe SDK 依赖 |
| 15.3 | `packages/onboarding/` 包初始化 |
| 15.4 | `packages/clipmart/` 包初始化 |
| 15.5 | `packages/growth/` 包初始化 |
| 15.6 | DB migration: `tenants` 表新增 Stripe 字段 |
| 15.7 | DB migration: `clipmart_templates` + `template_reviews` 表 |
| 15.8 | DB migration: `referral_codes` + `referral_rewards` 表 |
| 15.9 | DB migration: `onboarding_progress` 表 |
| 15.10 | `stripe-setup.ts`: 3 档套餐产品/价格配置 + Billing Meter |
| 15.11 | `packages/shared/src/constants.ts`: 套餐常量 + Agent 预算映射 |
| 15.12 | 遗留修复: DB `agentTypeEnum` 扩展 finance-agent / ceo-agent |
| 15.13 | 遗留并行: Amazon SP-API / TikTok / Shopee 联调启动 |
| 15.14 | S15 typecheck + 测试回归 |

### S16 · W3–4 — Stripe 计费核心

**交付物：** 订阅创建 · 14 天试用 · 用量实时上报 · Webhook 4 事件 · ClickHouse 对账 · 付款失败宽限期 · 升降级

| 任务 | 描述 |
|------|------|
| 16.1 | `subscription.service.ts`: 创建订阅 + 14 天试用 |
| 16.2 | `usage-reporter.ts`: Agent token 用量实时上报 Stripe Billing Meter |
| 16.3 | `usage-reporter.ts`: 套餐内额度判断 + 超额触发 |
| 16.4 | `webhook-handler.ts`: `invoice.payment_succeeded` → 重置月度用量 |
| 16.5 | `webhook-handler.ts`: `invoice.payment_failed` → 3 天宽限 → 暂停 Agent |
| 16.6 | `webhook-handler.ts`: `customer.subscription.deleted` → 暂停 Agent + 30 天数据保留 |
| 16.7 | `webhook-handler.ts`: `customer.subscription.updated` → 升降级配置同步 |
| 16.8 | `reconciliation.ts`: Stripe 账单 vs ClickHouse 内部记录对账 |
| 16.9 | `apps/api/src/routes/billing.ts`: 计费 API 路由 |
| 16.10 | `apps/api/src/routes/webhook.stripe.ts`: Webhook 路由 + 签名验证 |
| 16.11 | 全量计费测试（Stripe Test Mode） |
| 16.12 | S16 回归 |

### S17 · W5–6 — 自助 Onboarding

**交付物：** 注册/登录 API · 7 步 Onboarding 状态机 · OAuth 引导 · 卡点预防 · 健康检查 · 前端向导页面 · Dashboard 页面

| 任务 | 描述 |
|------|------|
| 17.1 | `apps/api/src/routes/auth.ts`: 注册 + 邮件验证 + 登录 + JWT |
| 17.2 | `apps/web/`: `/register` + `/login` 页面 |
| 17.3 | `onboarding-machine.ts`: 7 步状态机（注册→套餐→公司信息→OAuth→Agent→治理→验证） |
| 17.4 | `oauth-guide.ts`: Shopify/Amazon/TikTok/Shopee OAuth 引导 + 卡点预防 |
| 17.5 | `health-check.ts`: Agent 心跳 + API 连通性验证 |
| 17.6 | `apps/api/src/routes/onboarding.ts`: Onboarding API 路由 |
| 17.7 | `apps/web/`: `/onboarding` 7 步向导页面 |
| 17.8 | `apps/web/`: `/dashboard` 消费现有 console API |
| 17.9 | Console DataOS/Alert 接真实 API（遗留 P3 修复） |
| 17.10 | Onboarding E2E 测试（10 个模拟用户 <30 分钟验证） |
| 17.11 | S17 回归 |

### S18 · W7–8 — ClipMart 市场化

**交付物：** 模板 CRUD API · 搜索 · 安全校验 · 评分 · 5 个官方模板 · 一键导入 · 前端浏览页面

| 任务 | 描述 |
|------|------|
| 18.1 | `template.service.ts`: 模板 CRUD + 按品类/市场/平台搜索 |
| 18.2 | `security-validator.ts`: 模板配置安全校验（禁止修改 Constitution） |
| 18.3 | `import.service.ts`: 一键导入（从 Phase 4 `clipmart-import.ts` 迁移+增强） |
| 18.4 | `review.service.ts`: 评分 + 评论 + GMV 变化自愿填写 |
| 18.5 | `official-templates.ts`: 5 个官方模板种子数据 |
| 18.6 | `apps/api/src/routes/clipmart.ts`: ClipMart API 路由 |
| 18.7 | `apps/web/`: `/clipmart` 模板浏览 + 搜索 + 导入 + 评分页面 |
| 18.8 | ClipMart 安全测试（恶意模板拦截验证） |
| 18.9 | S18 回归 |

### S19 · W9–10 — 客户成功 + SLA

**交付物：** CS Agent · 健康评分体系 · NPS 问卷 · SLA 赔偿逻辑 · 流失干预 · 升级建议

| 任务 | 描述 |
|------|------|
| 19.1 | `customer-success.agent.ts`: 平台级 CS Agent 主体 |
| 19.2 | CS Agent: `calcHealthScore` 4 维度加权评分 |
| 19.3 | CS Agent: 健康 <40 → 干预邮件 + P1 Ticket |
| 19.4 | CS Agent: 健康 >80 → 升级建议 + 邀请评价 |
| 19.5 | `nps.service.ts`: 使用满 30 天自动发送 NPS 问卷 |
| 19.6 | `auto-upsell.ts`: 连续 2 月超额 >20% 触发升级建议 |
| 19.7 | `packages/shared/src/constants.ts`: SLA 等级定义（99.5%/99.9%/99.95%） |
| 19.8 | SLA 赔偿逻辑（可用性不足 / 数据丢失 / Agent 误操作） |
| 19.9 | `apps/web/`: `/settings` 治理偏好页面 |
| 19.10 | CS Agent 全量测试 |
| 19.11 | S19 回归 |

### S20 · W11–12 — 增长 + 最终验收

**交付物：** 推荐码系统 · 模板贡献激励 · Stripe Live Mode 切换 · 全 22 项 AC · 首批 20 租户冲刺

| 任务 | 描述 |
|------|------|
| 20.1 | `referral.service.ts`: 推荐码生成 + 核销 |
| 20.2 | `reward.service.ts`: 被推荐方试用延长 30 天 + 推荐方 20% 折扣 |
| 20.3 | 模板贡献激励: 下载 ≥5 次赠送 1 月服务费折扣 |
| 20.4 | `apps/api/src/routes/growth.ts`: 增长 API 路由 |
| 20.5 | 年付套餐: Annual 8 折 + 提前解约 50% |
| 20.6 | Stripe Live Mode 切换 + 生产环境验证 |
| 20.7 | 全 22 项 AC 逐项验证 |
| 20.8 | 首批 20 租户注册冲刺 |
| 20.9 | Phase 6 GO/NOGO 决策文档 |

## 验收清单（22 项 · PDF §08 对齐）

### 计费系统（6 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P5-01 | Stripe Subscription 创建正常 | S16 |
| AC-P5-02 | 14 天试用结束后自动扣款 | S16 |
| AC-P5-03 | 付款失败 → 3 天宽限 → Agent 暂停 | S16 |
| AC-P5-04 | Token 超额 → Stripe Meter 上报 → 月底账单含超额 | S16 |
| AC-P5-05 | Growth → Scale 升级 → 新权限即时生效 → 按日差额 | S16 |
| AC-P5-06 | 退订 → Agent 暂停 → 30 天数据删除 | S16 |

### 自助 Onboarding（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P5-07 | 全流程 < 30 分钟（10 个测试用户） | S17 |
| AC-P5-08 | OAuth 失败 → 清晰报错 + 重试按钮 | S17 |
| AC-P5-09 | Amazon 未申请资质 → 引导跳过先接其他平台 | S17 |
| AC-P5-10 | 健康检查全通过 → Dashboard 显示所有 Agent ACTIVE | S17 |

### ClipMart 模板市场（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P5-11 | 5 个官方模板上线 + 搜索"定价"命中 | S18 |
| AC-P5-12 | 一键导入 Standard 模板 → Agent 配置一致 | S18 |
| AC-P5-13 | 恶意模板（修改 Constitution）被拒绝 | S18 |
| AC-P5-14 | 下载计数递增 + 评分正常保存 | S18 |

### 客户成功 & 增长（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P5-15 | CS Agent 每日扫描 → 健康 <40 收到干预邮件 | S19 |
| AC-P5-16 | 推荐码注册 → 试用延长 30 天 + 付费后推荐方折扣 | S20 |
| AC-P5-17 | NPS 问卷：使用满 30 天自动发送 | S19 |
| AC-P5-18 | 模板贡献：下载 ≥5 → 赠送 1 月折扣 | S20 |

### 首批 20 租户目标（4 项）

| # | 验收条件 | Sprint |
|---|---------|--------|
| AC-P5-19 | 20 个付费租户注册（含试用） + MRR ≥ $6,000 | S20 |
| AC-P5-20 | 月留存率 ≥ 85%（首月无主动退订） | S20 |
| AC-P5-21 | 自助 Onboarding 成功率 ≥ 90%（≥18/20 无需人工） | S20 |
| AC-P5-22 | Support Ticket < 5 个/租户/月 | S20 |

## Constitution 合规检查

| Constitution 条款 | Phase 5 对齐方式 |
|------------------|-----------------|
| Ch2.1 模块化 | 5 个新 package 独立边界 |
| Ch2.2 API First | 所有新路由 OpenAPI 3.0 Schema |
| Ch2.3 Harness 不可绕过 | Onboarding OAuth 经由 Harness |
| Ch2.5 数据所有权 | 每个 package 拥有自己的 schema |
| Ch3.1 技术栈 | Next.js + Tailwind / Fastify / Drizzle |
| Ch4.1 命名规则 | kebab-case 文件名 |
| Ch5.2 禁止行为 | ClipMart 安全校验禁止修改 Constitution |
| Ch5.4 审批门控 | 保留所有既有门控 |
| Ch6 多租户 RLS | 所有新表 tenant_id + RLS |
| Ch8 监控 | 新增 `billing.subscription.active` / `billing.usage.overage` 指标 |
| Ch9 安全 | NextAuth.js + JWT + RBAC + AES-256 |

## 关键风险

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| Stripe 计费与 Agent 预算对账不准 | 中 | 高 | ClickHouse 双写 + 每日自动对账脚本 |
| ClipMart 恶意模板绕过安全检查 | 低 | 高 | 深度递归校验 + 白名单字段策略 |
| OAuth 授权卡点导致 Onboarding 失败率高 | 高 | 高 | 4 种卡点预防措施（PDF §03）+ 视频引导 |
| 12 周交付前端+后端压力大 | 中 | 中 | 前端最小壳；支付 UI 全交 Stripe |
| 首批 20 租户招募困难 | 中 | 高 | S18 起同步启动 Beta 邀请；推荐码激励 |
| Amazon/TikTok/Shopee 审核仍未通过 | 高 | 中 | Onboarding 支持"跳过该平台"；降级到 Shopify-only |

## Open Questions

1. **邮件服务**：Onboarding 邮件验证、CS Agent 干预邮件、NPS 问卷需要邮件发送能力。用哪个服务？（建议 Resend / SendGrid）
2. **Status Page**：PDF §07 提到"每月通过 Status Page 公示可用性"。是否自建还是用 Statuspage.io？
3. **年付套餐**：PDF §06 提到年付 8 折。S20 实现还是 Phase 6？（建议 S20 实现，增加 ARPU）

## Next Steps

→ **`/workflows:plan`** 生成 `docs/plans/phase5-plan.md`：逐 Sprint Day-by-Day 实施卡片 + 文件级任务分解
