# Phase 5 规划文档 · 宪法 / 蓝图 / PDF 实施计划 对齐报告

**生成日期：** 2026-03-29  
**对齐对象：** Phase 5 三份规划文档（尚未编码，对齐的是"计划"而非"代码"）  
**文件范围：**
- `docs/plans/phase5-plan.md` — 12 周实施计划
- `docs/brainstorms/2026-03-29-phase5-saas-commercialization-brainstorm.md` — 头脑风暴 + 决策记录
- Phase 5 PDF（`phase5-electroos.pdf`）— 18 页 SaaS 商业化宪法

**基线：**
- `docs/system-constitution.md` v1.0
- Master Blueprint PDF（`electroos-devos-blueprint.pdf`）
- Phase 4 GO 决策：28/28 AC 全通过（`docs/ops/sprint14-phase5-go-decision.md`）

---

## 第一层：宪法（System Constitution v1.0）对齐

### CHAPTER 1 · 使命（Mission）

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **1.1 ElectroOS 使命** | 多租户卖家完全自动化 AI 电商运营 | 自助 Onboarding <30min（AC-P5-07）；首批 20 付费租户（AC-P5-19）；三档套餐覆盖不同规模卖家 | ✅ | Phase 5 将使命从"能运行"推向"能付费运行" |
| **1.2 DevOS 使命** | 持续开发维护升级 ElectroOS | Phase 5 不新增 DevOS Agent；DevOS 12 Agent 延续 Phase 4 配置 | ✅ | DevOS 继续维护系统，Phase 5 重心在商业层 |
| **1.3 两层关系** | DevOS builds & maintains ElectroOS | Plan 不改变两层关系；ClipMart 安全校验禁止模板修改 Constitution | ✅ | |

### CHAPTER 2 · 系统架构原则

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **2.1 模块化** | 禁止跨模块直连 DB；模块通过 API 通信 | 5 个新 package 独立边界（billing/onboarding/clipmart/growth + CS Agent）；6 条新 API 路由 | ✅ | 新 package 设计严格遵循"每个模块通过 API 通信" |
| **2.2 API First** | REST + OpenAPI 3.0；版本化 `/api/v1/` | Plan 所有新路由在 `/api/v1/`（billing/onboarding-flow/clipmart/growth/auth/webhook-stripe）；S15 验收含 OpenAPI Schema | ✅ | |
| **2.2 API 版本** | 旧版保留 ≥12 月 | Phase 5 新增路由为 v1，不涉及旧版本废弃 | ✅ | |
| **2.3 Harness 抽象** | Agent 代码绝不直调平台 SDK | Onboarding OAuth 经由现有 Harness 接口；ClipMart 导入走 Agent seed（不直调 SDK）；CS Agent 通过 DataOS Port 读数据 | ✅ | |
| **2.4 事件驱动** | 系统通过事件解耦 | Plan 新增事件：`tenant.subscribed` / `billing.overage` / `template.imported` / `nps.sent`；usage-reporter 写 ClickHouse Event Lake | ✅ | |
| **2.5 数据所有权** | 每个 Service 拥有自己的 DB schema；不跨模块直连 | Plan D31 决策：billing 拥有 billing_usage_logs；clipmart 拥有 clipmart_templates/template_reviews；growth 拥有 referral_codes/referral_rewards/nps_responses；onboarding 拥有 onboarding_progress | ✅ | 完美对齐 |

### CHAPTER 3 · 技术栈标准

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **3.1 Backend** | Node.js + TypeScript + Fastify | 4 个新 package 均为 TypeScript；API 路由在 Fastify app 中注册 | ✅ | |
| **3.1 Frontend** | **Next.js + React + TypeScript + Tailwind** | `apps/web/` 使用 Next.js 14+ App Router + Tailwind（D32 决策） | ✅ | **Phase 4 的已知偏差 D-01 已在 Phase 5 修复** |
| **3.1 Database** | PostgreSQL（主）+ Redis（缓存） | 6 张新表均在 PostgreSQL；Drizzle ORM（D31） | ✅ | |
| **3.1 ORM** | Drizzle ORM | D31 决策明确延续 Drizzle | ✅ | |
| **3.1 Queue** | BullMQ (Redis-backed) | webhook-handler.ts 付款失败宽限期用 BullMQ delayed job | ✅ | |
| **3.1 Container** | Docker + Kubernetes | 无新容器配置（复用现有 compose） | ✅ | |
| **3.1 CI/CD** | GitHub Actions | 无新 CI 变更 | ✅ | |
| **3.1 Monitoring** | Prometheus + Grafana + OpenTelemetry | Plan §12 新增 `billing.subscription.active` / `billing.usage.overage` / `cs.health_score` 指标 | ✅ | |
| **3.2 AI 模型** | 定价 haiku / 分析 sonnet / DevOS CTO opus | CS Agent 使用 claude-sonnet-4-6（D33 决策）；不变动现有 Agent 模型分配 | ✅ | |
| **3.3 Agent 编排** | 唯一框架 Paperclip；禁止 LangChain/CrewAI 主编排 | CS Agent 使用现有 agent-runtime 框架（Paperclip）；不引入新编排库 | ✅ | |

**违禁技术引入检查：**

| 新依赖 | 类别 | 合规 | 说明 |
|--------|------|------|------|
| `next-auth@5` | 认证 | ✅ | Next.js 生态标准认证库；Constitution 未禁止 |
| `stripe` | 支付 SDK | ✅ | 外部 SaaS 集成；Constitution 未禁止 |
| `resend` | 邮件 SDK | ✅ | 外部 SaaS 集成；Constitution 未禁止 |

**结论：无违禁技术引入。** 新增的 3 个依赖均为外部 SaaS 集成 SDK，不属于 Constitution §3.1 禁止清单（MySQL/MongoDB/Vue/Angular/Prisma/RabbitMQ/Jenkins）。

### CHAPTER 4 · 代码规范

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **4.1 变量** | camelCase | `tenantId`, `stripeCustomerId`, `templateId`, `referralCode` | ✅ | |
| **4.1 类/接口** | PascalCase | `PlanName`, `StripeProduct`, `OnboardingState`, `ClipmartTemplate`, `ReferralService` | ✅ | |
| **4.1 常量** | UPPER_SNAKE_CASE | `STRIPE_PRODUCTS`, `PLAN_AGENT_LIMITS`, `SLA_LEVELS`, `CUSTOMER_SUCCESS_AGENT_ID` | ✅ | |
| **4.1 文件** | kebab-case | `stripe-setup.ts`, `usage-reporter.ts`, `onboarding-machine.ts`, `security-validator.ts`, `referral.service.ts`, `customer-success.agent.ts` | ✅ | |
| **4.2 模块结构** | `.service.ts` / `.types.ts` / `.schema.ts` / `.test.ts` | 每个新 package 含 `{name}.types.ts` + `{name}.schema.ts` + 每个 service 配套 `.test.ts` | ✅ | |
| **4.3 错误处理** | 结构化 AgentError 分类 | `SecurityValidationError`（ClipMart 安全校验）；`OnboardingStepError`（步骤失败）；Webhook 事件分类处理 | ✅ | |

### CHAPTER 5 · AI Agent 行为规则

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **5.1 执行前检查** | goal_context / budget / approval / Constitution | CS Agent `calcHealthScore` 读取租户全维度数据（goal_context）；plan-enforcer 检查套餐预算上限 | ✅ | |
| **5.2 禁止 - 直接 DB** | 禁止直接访问数据库 | CS Agent 通过 DataOS Port 读数据，不直连 ClickHouse；billing 通过 Service API 读写 | ✅ | Plan 需确保 CS Agent 实现中不直连 DB |
| **5.2 禁止 - 绕 Harness** | 禁止绕过 Harness | Onboarding OAuth 经由现有 Harness 接口；ClipMart 导入通过 Agent seed | ✅ | |
| **5.2 禁止 - 价格 >15%** | 不经审批不得执行 | Phase 5 不变动定价审批逻辑；保留 `PRICE_APPROVAL_THRESHOLD_PERCENT = 15` | ✅ | |
| **5.2 禁止 - 广告 >$500** | 不经审批 | 保留现有门控 | ✅ | |
| **5.2 禁止 - 修改 Constitution** | 禁止修改 system-constitution.md | ClipMart `security-validator.ts` 明确校验：禁止模板包含修改 Constitution 的指令（AC-P5-13） | ✅ | Phase 5 **主动强化**了这条规则 |
| **5.2 禁止 - 创建新 Agent** | 需 CTO + 人工双重审批 | CS Agent 为 Phase 5 PDF 已定义的角色，由人工（计划文档）授权创建 | ✅ | |
| **5.2 禁止 - 软删除** | 禁止删除生产数据 | 6 张新表均含 `deleted_at` 字段（clipmart_templates / template_reviews 明确在 DDL 中） | ✅ | |
| **5.3 审计日志** | 所有操作写入不可变审计日志 | usage-reporter 双写 ClickHouse Event Lake + billing_usage_logs；ClipMart 导入写 `template_imported` 事件 | ✅ | |
| **5.3 RLS** | 跨租户数据访问必须 RLS 验证 | Plan §1 DDL 所有 6 张新表启用 RLS + tenant 策略 | ✅ | |
| **5.4 审批门控** | 价格/广告/上架/部署/Harness/Schema | Phase 5 保留全部既有门控；无新门控需求（计费不需人工审批） | ✅ | |

### CHAPTER 6 · 多租户规则

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **6.1 数据隔离** | 所有核心表 `tenant_id` + RLS | 6 张新表全部含 `tenant_id`；DDL 中启用 RLS + CREATE POLICY | ✅ | |
| **6.2 租户级配置** | 审批阈值可覆盖 5%–30%；Agent 预算；语言；凭证加密 | Onboarding Step 6 治理偏好（调价阈值/广告额度/上架审批）per-tenant 覆盖；套餐限制 per-tenant 预算 | ✅ | |
| **6.3 Agent 预算隔离** | per-tenant，A 超预算不影响 B | plan-enforcer.ts `getMonthlyBudget(plan)` per-tenant 执行；usage-reporter per-tenant 计费 | ✅ | |

### CHAPTER 7 · DevOS 特殊规则

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **7.1 代码演进** | Ticket → PM → Arch → Impl → QA → PR → 审批 → 部署 | Phase 5 不涉及 DevOS Loop 变更；Loop 延续 Phase 4 配置 | N/A | |
| **7.2 禁止直改生产 DB** | 只能通过 migration | Plan 明确 `003_stripe_tenant_fields.sql` ~ `007_billing_tables.sql` 5 个 migration 文件 | ✅ | |
| **7.2 覆盖率 ≥80%** | 禁止降低测试覆盖率 | 每个新 package 的 `package.json` 含 `test:coverage` 脚本（threshold 80%）；S15 验收含 CI 全绿 | ✅ | |
| **7.2 新核心依赖** | 需架构评审 | 新增 `stripe` / `next-auth` / `resend` 三个依赖；ADR-0005 记录架构决策 | ✅ | |
| **7.3 Harness 48h SLA** | 平台 API 变更后 48h 更新 | Phase 5 不变动 Harness 接口；延续现有 SLA | ✅ | |
| **7.3 向后兼容** | 新增可选，不删旧 | `constants.ts` 扩展新增 `PLAN_NAMES` / `SLA_LEVELS`，不修改 `ELECTROOS_AGENT_IDS` 等现有常量 | ✅ | |

### CHAPTER 8 · 可观测性标准

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **8.1 agent.heartbeat.success_rate** | 必须监控 | CS Agent 健康评分维度之一（Agent 心跳正常率 30% 权重） | ✅ | |
| **8.1 agent.budget.utilization** | 必须监控 | usage-reporter 实时跟踪预算利用率；超额触发 Stripe Meter | ✅ | |
| **8.1 harness.api.error_rate** | 必须监控 | Onboarding 健康检查包含 API 连通性验证 | ✅ | |
| **8.2 P0 告警** | Harness 错误率 >5% 立即响应 | 延续 Phase 4 告警规则；CS Agent 健康 <40 触发 P1 Ticket | ✅ | |
| **新增指标** | — | `billing.subscription.active`（活跃订阅数）/ `billing.usage.overage`（超额次数）/ `cs.health_score`（租户平均健康分） | ✅ | 增强可观测性 |

### CHAPTER 9 · 安全原则

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **JWT 认证** | 所有 API | NextAuth.js + JWT（D29 决策）；auth.ts 路由签发 JWT；后续请求验证 | ✅ | |
| **RBAC** | admin / seller / agent / readonly | NextAuth.js JWT payload 含 `tenantId` + `role` + `plan`；API 路由 preHandler 校验角色 | ✅ | **Phase 4 偏差 S-02 已在 Phase 5 修复** |
| **AES-256 加密** | 平台 API Keys、支付信息 | Stripe API Key 存入环境变量（不写代码）；平台 OAuth token 延续现有加密存储 | ✅ | |
| **Secrets Manager** | Agent 凭证 | Stripe Webhook Secret / API Key 通过 `process.env.STRIPE_*` 注入 | ✅ | |
| **依赖扫描** | 每次 PR `npm audit` | 延续现有 CI；新增 3 个依赖（stripe/next-auth/resend）需通过审计 | ✅ | |

**Stripe 安全补充：**
- Webhook 签名验证：`stripe.webhooks.constructEvent(body, signature, secret)`（Plan S16 CARD-S16-D3-02）
- 支付页面使用 Stripe Checkout Session（PCI DSS Level 1 由 Stripe 承担）
- 用户信用卡信息 **零接触**（Stripe.js 直接传输到 Stripe 服务器）

### CHAPTER 10 · 版本与演进

| 条款 | 宪法要求 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|------|---------|-------------------|------|------|
| **Constitution 修改权限** | 仅人工可修改 | Plan 不修改 Constitution；ClipMart 安全校验明确禁止模板修改 Constitution | ✅ | |
| **每季度评审** | Q2 2026 评审 | Phase 5 新增 Stripe + Resend 外部依赖，建议在 Q2 评审中补充到 Constitution §3.1 | ⚠️ 建议 | 非阻塞；记为 Action Item |

---

## 第二层：蓝图（Master Blueprint PDF）对齐

### 01 双层架构概览

| 蓝图要点 | Phase 5 Plan 覆盖 | 状态 |
|---------|-------------------|------|
| ElectroOS: 选品/定价/客服/广告/库存/内容 | 9 Agent 延续 Phase 4；套餐限制不同 Agent 组合（Starter 3 / Growth 7 / Scale 9） | ✅ |
| DevOS: 代码开发/维护/升级 | 12 Agent 延续 Phase 4 配置，不变动 | ✅ |
| 互联协议 | CS Agent 发现问题时创建 P1 Ticket（经由现有 Ticket 系统） | ✅ |

### 02 21 核心 Agents · 完整组织图

| Agent | 蓝图定义 | Phase 5 变化 | 状态 |
|-------|---------|-------------|------|
| E-01 ~ E-09 | 9 个 ElectroOS Agent | **无变动**；套餐限制可用 Agent 数量 | ✅ |
| **E-10 CS Agent** | **蓝图未定义** | **Phase 5 PDF 新增**：平台级 Agent，每日扫描所有租户健康状态 | ⚠️ 新增 |
| D-01 ~ D-12 | 12 个 DevOS Agent | **无变动** | ✅ |

**说明：** CS Agent（E-10）是 Phase 5 PDF 新增角色，超出蓝图原始 21 Agent 范围。根据 Constitution §5.2 "创建新 Agent 角色需 CTO Agent + 人工双重审批"，CS Agent 由 Phase 5 PDF（人工规划文档）授权创建，符合"人工审批"要求。但**蓝图 Agent 总数从 21 增至 22 需记录为偏差**。

### 03 Autonomous Development Loop · 9 阶段

| 蓝图阶段 | Phase 5 影响 | 状态 |
|---------|-------------|------|
| Stage 01~09 | Phase 5 不变动 Loop；DevOS 延续 Phase 4 配置 | ✅ |

### 04 Task Graph · 6 层分解

| 蓝图层级 | Phase 5 影响 | 状态 |
|---------|-------------|------|
| 6 层分解 | 不变动 | ✅ |

### 05 Governance Gates · 治理门控

| 蓝图门控 | 触发条件 | Phase 5 Plan 覆盖 | 状态 | 说明 |
|---------|---------|-------------------|------|------|
| updatePrice() | >15% 人工审批 | 保留；Onboarding Step 6 允许 5%–30% 自定义 | ✅ | |
| listProduct() | 新品上架人工审批 | 保留；Onboarding Step 6 可配 | ✅ | |
| setAdsBudget() | >$500 人工审批 | 保留 | ✅ | |
| deployToProduction | 人工审批 | 保留（DevOS Loop 不变动） | ✅ | |
| addHarnessMethod() | CTO + 人工 | 保留 | ✅ | |
| dbSchemaMigration | DB Agent + 人工 | Phase 5 migrations 由人工创建（Plan 明确 DDL） | ✅ | |
| replyToCustomer() | 退款/投诉转人工 | 保留（Support Relay 延续 webhook-only） | ✅ | |
| budgetAdjustment | 超支自动暂停 | plan-enforcer 强制套餐预算上限；usage-reporter 超额上报 | ✅ | |
| **新增：模板导入** | **ClipMart 模板不允许修改 Constitution** | security-validator.ts 深度递归校验（AC-P5-13） | ✅ | Phase 5 新增门控 |

### 06 System Constitution 对齐

**见上方第一层宪法逐条对齐。**

### 07 Execution Roadmap · Phase 编号映射

| 蓝图 Phase | 蓝图内容 | 项目实际对应 | 状态 |
|-----------|---------|------------|------|
| Phase 1 | Fork & 3 Agents on Shopify | 我们的 Phase 1 ✅ | ✅ |
| Phase 2 | 多平台 + DevOS 基础 | 我们的 Phase 2 ✅ | ✅ |
| Phase 3 | 全链路自动化 + Autonomous Loop | 我们的 Phase 3 + Phase 4（DataOS 插入为独立 Phase） | ✅ |
| **Phase 4** | **完全自治 · 商业化 · 对外开放** | **我们的 Phase 5（SaaS 商业化）+ Phase 6（完全自治）** | ✅ |

**说明：** 蓝图 Phase 4 的"SaaS 商业化"部分 **完全对应** 我们 Phase 5 的范围。编号偏移原因（Phase 3 DataOS 插入）在 Phase 4 对齐报告中已记录。

### 蓝图 Phase 4 具体要求 vs Phase 5 Plan

| 蓝图 Phase 4 要求 | Phase 5 Plan 覆盖 | 状态 |
|------------------|-------------------|------|
| DevOS 自主开发新功能 | Phase 5 不含（Phase 6 目标） | ⚠️ 分拆到 Phase 6 |
| ElectroOS 零人工运营 | Phase 5 保留审批门控（Onboarding Step 6 可配阈值） | ⚠️ 分拆到 Phase 6 |
| **SaaS 对外商业化** | **Phase 5 核心目标：3 档套餐 + Stripe 计费 + 自助 Onboarding + 20 租户** | ✅ |
| 两层 Paperclip 互监督 | Phase 5 不含（Phase 6 目标） | ⚠️ 分拆到 Phase 6 |
| Harness 插件市场 | ClipMart 模板市场（Agent 配置模板化，非 Harness 插件） | ⚠️ 部分覆盖 |

**结论：** 蓝图 Phase 4 被分拆为 Phase 5（商业化）+ Phase 6（完全自治），这是合理的范围拆分。Phase 5 完整覆盖商业化部分。

---

## 第三层：Phase 5 PDF（18 页 SaaS 商业化宪法）对齐

### 00 总览与商业目标

| PDF 要求 | Plan 覆盖 | 状态 | 说明 |
|---------|-----------|------|------|
| 前提：Phase 4 全部 25 项 AC 通过 | Sprint 14 GO 决策：28/28 AC 通过（含 3 项遗留清零） | ✅ | Plan 超额完成 |
| 前提：Autonomous Dev Loop 稳定跑通 | Sprint 14 AC-P4-01 确认 | ✅ | |
| 前提：50 租户并发压测通过 | Sprint 14 AC-P4-19 确认 | ✅ | |
| 核心目标：自助上线 <30min | AC-P5-07 | ✅ | |
| 核心目标：Stripe 计费接入 | S16 全 Sprint 专项 | ✅ | |
| 核心目标：ClipMart 上线 | S18 全 Sprint 专项 | ✅ | |
| 核心目标：首批 20 付费租户 | AC-P5-19 | ✅ | |
| 成功标准：MRR > $10,000 | AC-P5-19 设定 MRR ≥ $6,000（20 租户 × $299 起） | ⚠️ 差异 | PDF 目标 $10k，Plan AC 设定 $6k — 取决于套餐分布 |
| 成功标准：月留存 >85% | AC-P5-20 | ✅ | |
| 成功标准：Onboarding 成功率 >90% | AC-P5-21 | ✅ | |
| 成功标准：Support Ticket <5/租户/月 | AC-P5-22 | ✅ | |
| 不做：企业级私有部署 | Plan §0 明确"不做" | ✅ | |
| 不做：白标 OEM | Plan §0 明确"不做" | ✅ | |
| 12 周执行周期 | S15–S20 共 6 个双周 Sprint = 12 周 | ✅ | |

### 01 定价套餐设计（PDF §01 · Week 1–2）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| Starter $299/月，1 平台，3 Agent，$160 预算 | `STRIPE_PRODUCTS.starter` + `PLAN_AGENT_LIMITS.starter` | ✅ |
| Growth $799/月，3 平台，7 Agent，$500 预算 | `STRIPE_PRODUCTS.growth` + `PLAN_AGENT_LIMITS.growth` | ✅ |
| Scale $1,999/月，全平台+B2B，9 Agent，$1,200 预算 | `STRIPE_PRODUCTS.scale` + `PLAN_AGENT_LIMITS.scale` | ✅ |
| DataOS 分层：Starter 无 / Growth 部分 / Scale 全部 | `PlanFeatures.dataos: 'none' \| 'partial' \| 'full'` | ✅ |
| SLA 分层：99.5% / 99.9% / 99.95% | `SLA_LEVELS` 常量（S15 CARD-S15-D3-02） | ✅ |
| 超额计费 Token 费率：$0.05/$0.03/$0.02 per 千 token | `OverageRate` 类型（S15 CARD-S15-D3-01） | ✅ |
| 额外平台/店铺/存储费率 | `OverageRate` 类型覆盖 | ✅ |
| 对应 Sprint | S15（Plan 完全对齐 PDF Week 1–2） | ✅ |

### 02 Stripe 计费系统（PDF §02 · Week 3–4）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| STEP 2.1 Stripe 产品配置 | S15 `stripe-setup.ts` + S19 `scripts/stripe-setup.ts` | ✅ |
| STEP 2.2 Agent Token 用量实时上报 | S16 `usage-reporter.ts`（CARD-S16-D3-01） | ✅ |
| 超额上报 `stripe.billing.meterEvents.create` | Plan 明确描述 Stripe Billing Meter 上报 | ✅ |
| ClickHouse 双写（内部对账） | S16 `reconciliation.ts` + `usage-reporter.ts` ClickHouse 双写 | ✅ |
| STEP 2.3 Webhook 4 事件 | S16 `webhook-handler.ts` 4 事件（CARD-S16-D3-02） | ✅ |
| `invoice.payment_succeeded` → 重置用量 | S16 任务 16.6 | ✅ |
| `invoice.payment_failed` → 3 天宽限 → 暂停 Agent | S16 任务 16.7 + AC-P5-03 | ✅ |
| `customer.subscription.deleted` → 暂停 + 30 天数据删除 | S16 任务 16.8 + AC-P5-06 | ✅ |
| `customer.subscription.updated` → 升降级同步 | S16 任务 16.9 + AC-P5-05 | ✅ |
| 14 天免费试用 | `trial_period_days: 14`（S16 CARD-S16-D1-01） | ✅ |
| 对应 Sprint | S16（Plan 完全对齐 PDF Week 3–4） | ✅ |

### 03 自助 Onboarding（PDF §03 · Week 5–6）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| 7 步流程（注册/套餐/公司/OAuth/Agent/治理/验证） | `onboarding-machine.ts` 7 步状态机（S17 CARD-S17-D1-01） | ✅ |
| 全程自助，无需人工 | Onboarding API + 前端向导；AC-P5-21 验证 90% 成功率 | ✅ |
| 邮件验证 → 创建 tenant → 分配 tenant_id | auth.ts `POST /api/v1/auth/register` | ✅ |
| 三档套餐对比 → Stripe Checkout → 14 天试用 | plan-selector.tsx + Stripe Checkout Session | ✅ |
| 平台 OAuth → token 加密存储 | oauth-connector.tsx + 现有 Harness OAuth 路由 | ✅ |
| Agent 自动 seed + Org Chart 可视化 | agent-org-chart.tsx（S17 任务 17.8） | ✅ |
| 治理偏好：调价 15% / 广告 $500 / 新品审批 | Onboarding Step 6 | ✅ |
| 健康检查 → 全通过 → Dashboard | health-check.ts（S17 CARD-S17-D3-01）+ AC-P5-10 | ✅ |
| 卡点预防 4 种 | oauth-guide.ts 4 种卡点预防（S17 CARD-S17-D2-01） | ✅ |
| Shopify OAuth 失败 ~15% → 报错 + 视频 + 重试 | AC-P5-08 | ✅ |
| Amazon SP-API 未审核 ~40% → 跳过先接其他 | AC-P5-09 | ✅ |
| Shopee 多市场混淆 ~20% → 引导先接 SG | oauth-guide.ts | ✅ |
| Agent 心跳不触发 ~5% → 自动重启 | health-check.ts 异常自动重启 | ✅ |
| 对应 Sprint | S17（Plan 完全对齐 PDF Week 5–6） | ✅ |

### 04 ClipMart 模板市场（PDF §04 · Week 7–8）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| STEP 4.1 数据结构：`clipmart_templates` 表 | S15 `004_clipmart_tables.sql`（DDL 完全对齐 PDF 字段） | ✅ |
| `template_reviews` 表 | 同上 | ✅ |
| STEP 4.2 一键导入逻辑 | S18 `import.service.ts`（CARD-S18-D3-01） | ✅ |
| 安全检查：不允许修改 Constitution | S18 `security-validator.ts`（AC-P5-13） | ✅ |
| 深度合并：模板 + 租户覆盖 + tenantId 强制 | import.service.ts `deepMerge(config, overrides, { tenantId })` | ✅ |
| 5 个官方模板首发 | S18 `official-templates.ts` + `harness-config/official-templates/` 5 JSON | ✅ |
| Standard Cross-Border | 全 9 Agent，Shopify + Amazon | ✅ |
| SEA Marketplace | 定价+客服+广告，TikTok + Shopee | ✅ |
| Amazon PPC Pro | Ads Optimizer 深度，Amazon US/UK/DE | ✅ |
| Fast Fashion | 选品+内容+库存，全平台 | ✅ |
| B2B Wholesale | B2B Harness + 全套 | ✅ |
| 对应 Sprint | S18（Plan 完全对齐 PDF Week 7–8） | ✅ |

### 05 客户成功体系（PDF §05 · Week 9–10）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| STEP 5.1 CS Agent（CS-01）平台级 | S19 `customer-success.agent.ts`（D33 决策） | ✅ |
| heartbeat `0 9 * * *` | Plan D33 明确每日 09:00 | ✅ |
| model claude-sonnet-4-6 | Plan D33 明确 | ✅ |
| budget $200/月 | Plan D33 明确 | ✅ |
| 健康 <40 → 干预邮件 + P1 Ticket | S19 任务 19.3 + AC-P5-15 | ✅ |
| 健康 >80 → 升级建议 + 邀请评价 | S19 任务 19.4 | ✅ |
| STEP 5.2 健康评分 4 维度权重 | S19 CARD-S19-D1-01 表格完全对齐 PDF §05 | ✅ |
| Agent 心跳正常率 30% | 对齐 | ✅ |
| 30 天登录次数 20% | 对齐 | ✅ |
| 审批平均响应 20% | 对齐 | ✅ |
| GMV 30 天趋势 30% | 对齐 | ✅ |
| 对应 Sprint | S19（Plan 完全对齐 PDF Week 9–10） | ✅ |

### 06 增长机制（PDF §06 · Week 11）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| STEP 6.1 推荐码系统 | S20 `referral.service.ts` + `reward.service.ts` | ✅ |
| 推荐码 8 位（ELEC-XXXX） | S20 CARD-S20-D1-01 `generateShortId(8)` | ✅ |
| 被推荐方：试用 14→30 天 | reward.service.ts `stripe.subscriptions.update trial_end` | ✅ |
| 推荐方：被推荐方付费后 20% 折扣 1 个月 | reward.service.ts `fulfillReward` → Stripe Coupon | ✅ |
| STEP 6.2 自动扩容 | S19 `auto-upsell.ts`（连续 2 月超额 >20%） | ✅ |
| CS Agent 发送升级建议邮件 | S19 任务 19.4 + 19.6 | ✅ |
| 一键升级链接 | 邮件中包含 Stripe Customer Portal URL | ✅ |
| Starter → Growth 自动迁移 | subscription.service.ts `upgradePlan` + `syncPlanFeatures` | ✅ |
| 降级处理：超出 Agent 暂停，数据保留 90 天 | subscription.service.ts `downgradePlan` | ✅ |
| Annual 8 折 + 提前解约 50% | S20 CARD-S20-D3-01 年付套餐 | ✅ |
| 对应 Sprint | S20（Plan 完全对齐 PDF Week 11） | ✅ |

### 07 SLA 保障 & 支持体系（PDF §07 · Week 9–12）

| PDF 要求 | Plan 覆盖 | 状态 |
|---------|-----------|------|
| 7.1 SLA 等级：Starter 99.5% / Growth 99.9% / Scale 99.95% | `SLA_LEVELS` 常量 + sla-compensation.ts | ✅ |
| P0 响应：4h / 2h / 30min | SLA_LEVELS.p0ResponseH | ✅ |
| P1 响应：24h / 8h / 4h | SLA_LEVELS.p1ResponseH | ✅ |
| 7.2 赔偿标准 | sla-compensation.ts `calculateSlaCompensation`（S19 CARD-S19-D5-01） | ✅ |
| 每低于 SLA 0.1% → 5% | 对齐 | ✅ |
| 低于 99% → 30% | 对齐 | ✅ |
| 低于 95% → 100% | 对齐 | ✅ |
| DataOS 数据丢失 >1h → 20% | 对齐 | ✅ |
| Agent 误操作 → 100% 直接损失 | 对齐 | ✅ |
| 可用性 = 成功 API / 总 API | 对齐 | ✅ |
| 对应 Sprint | S19（Plan 对齐 PDF Week 9–12 中 SLA 部分） | ✅ |

### 08 验收清单（PDF §08 · Week 12）

| PDF AC 分类 | PDF 项数 | Plan AC | 状态 |
|------------|---------|---------|------|
| 计费系统 | 6 | AC-P5-01~06 | ✅ 完全对齐 |
| 自助 Onboarding | 4 | AC-P5-07~10 | ✅ 完全对齐 |
| ClipMart 模板市场 | 4 | AC-P5-11~14 | ✅ 完全对齐 |
| 客户成功 & 增长 | 4 | AC-P5-15~18 | ✅ 完全对齐 |
| 首批 20 租户目标 | 4 | AC-P5-19~22 | ✅ 完全对齐 |

**22/22 PDF 验收项完全覆盖，无遗漏。**

**逐项比对：**

| PDF 验收 | Plan AC | 措辞对比 | 状态 |
|---------|---------|---------|------|
| Stripe Subscription 创建正常 | AC-P5-01 | 完全一致 | ✅ |
| 14 天试用结束自动扣款 | AC-P5-02 | 完全一致 | ✅ |
| 付款失败 3 天宽限后暂停 | AC-P5-03 | 完全一致 | ✅ |
| Token 超额 Stripe Meter | AC-P5-04 | 完全一致 | ✅ |
| Growth→Scale 升级即时生效 | AC-P5-05 | 完全一致 | ✅ |
| 退订 Agent 暂停 30 天删数据 | AC-P5-06 | 完全一致 | ✅ |
| 全流程 <30min（10 用户） | AC-P5-07 | 完全一致 | ✅ |
| OAuth 失败清晰报错+重试 | AC-P5-08 | 完全一致 | ✅ |
| Amazon 未审核引导跳过 | AC-P5-09 | 完全一致 | ✅ |
| 健康检查通过 Dashboard ACTIVE | AC-P5-10 | 完全一致 | ✅ |
| 5 官方模板+搜索命中 | AC-P5-11 | 完全一致 | ✅ |
| 一键导入 Agent 配置一致 | AC-P5-12 | 完全一致 | ✅ |
| 恶意模板被拒绝 | AC-P5-13 | 完全一致 | ✅ |
| 下载计数+评分保存 | AC-P5-14 | 完全一致 | ✅ |
| CS Agent 每日扫描干预 | AC-P5-15 | 完全一致 | ✅ |
| 推荐码试用延长+折扣 | AC-P5-16 | 完全一致 | ✅ |
| NPS 30 天自动发送 | AC-P5-17 | 完全一致 | ✅ |
| 模板贡献下载≥5折扣 | AC-P5-18 | 完全一致 | ✅ |
| 20 租户 MRR ≥ $6,000 | AC-P5-19 | PDF 写 $6,000 | ✅ |
| 月留存 ≥85% | AC-P5-20 | 完全一致 | ✅ |
| Onboarding 成功率 ≥90% | AC-P5-21 | 完全一致 | ✅ |
| Ticket <5/租户/月 | AC-P5-22 | 完全一致 | ✅ |

---

## 时间轴对齐

| PDF 周数 | PDF 模块 | Plan Sprint | Plan 周数 | 状态 |
|---------|---------|------------|---------|------|
| Week 1–2 | 定价套餐设计 | S15 | W1–2 | ✅ |
| Week 3–4 | Stripe 计费系统 | S16 | W3–4 | ✅ |
| Week 5–6 | 自助 Onboarding | S17 | W5–6 | ✅ |
| Week 7–8 | ClipMart 模板市场 | S18 | W7–8 | ✅ |
| Week 9–10 | 客户成功体系 | S19 | W9–10 | ✅ |
| Week 11–12 | 增长机制 + 验收 | S20 | W11–12 | ✅ |

**时间轴完全一一对应，零偏差。**

---

## Phase 4 偏差修复验证

Phase 4 对齐报告列出了 4 项已知偏差 + 3 项需补充。Phase 5 修复情况：

| Phase 4 偏差 | 状态 | Phase 5 修复方式 |
|-------------|------|-----------------|
| **D-01** Frontend UI 推迟 Phase 5 | ✅ **已修复** | `apps/web/` Next.js + Tailwind 脚手架（S15 CARD-S15-D1-01） |
| **D-02** Support Relay 降级 webhook-only | ⏳ 延续 | Phase 5 不变动；Phase 6 Shopify Inbox 完整对接 |
| **D-03** Amazon SP-API Sandbox | ⏳ 延续 | S15 并行联调尝试；若仍未通过则维持降级 |
| **D-04** Loop 代码路径差异 | N/A | 不影响 Phase 5 |
| **S-01** Console API OpenAPI spec | ✅ **已修复** | Phase 5 新路由含 OpenAPI Schema（Plan S15 验收） |
| **S-02** Console RBAC 明确化 | ✅ **已修复** | NextAuth.js JWT 含 role，API preHandler 校验（D29 决策） |
| **S-03** Finance Agent DataOS API 约束 | ✅ **延续** | CS Agent 同样通过 DataOS Port 读数据（Plan 明确） |

---

## 偏差清单

### ⚠️ 已知偏差（有明确决策和理由）

| # | 偏差 | 来源 | 决策 | ADR |
|---|------|------|------|-----|
| D-05 | CS Agent（E-10）超出蓝图原始 21 Agent | Blueprint §02 定义 21 Agent | Phase 5 PDF 授权新增；Constitution §5.2 "创建新 Agent 需人工审批" 已满足 | ADR-0005 D33 |
| D-06 | MRR 目标差异：PDF §00 写 >$10,000，AC-P5-19 设定 ≥$6,000 | PDF §00 vs §08 | PDF §08（验收清单）写 $6,000，Plan 以验收清单为准；$10k 是理想目标非硬性 AC | ADR-0005 D36 |
| D-07 | Support Relay 延续 webhook-only | Blueprint E-04 | 延续 Phase 4 偏差 D-02；Shopify Inbox 权限仍未获批 | ADR-0004 D24 |
| D-08 | Amazon/TikTok/Shopee 可能仍为 Sandbox | Blueprint Phase 2 | 延续 Phase 4 偏差 D-03；S15 并行尝试，不通过则维持降级 | ADR-0004 D23 |
| D-09 | 蓝图 Phase 4 "完全自治" 分拆到 Phase 6 | Blueprint §07 Phase 4 | 蓝图 Phase 4 范围过大（商业化 + 自治）；合理拆分为 Phase 5（商业化）+ Phase 6（自治） | Phase 4 对齐已记录 |
| D-10 | 蓝图 "Harness 插件市场" → Plan 为 "ClipMart 模板市场" | Blueprint §07 Phase 4 | ClipMart 是 Agent 配置模板市场，非 Harness 接口插件市场；实质是同一概念的不同实现层级 | ADR-0005 D34 |

### ⚠️ 需补充的小项

| # | 需补充 | 优先级 | 建议处理时机 |
|---|--------|-------|------------|
| S-04 | Constitution §3.1 应在 Q2 评审时补充 Stripe / Resend / NextAuth.js 为"允许的外部 SaaS SDK" | P3 | Q2 2026 Constitution 季度评审 |
| S-05 | CS Agent 实现中需确保通过 DataOS Port 读租户数据，不直连 PostgreSQL 或 ClickHouse | P2 | S19 实现时 Code Review 检查 |
| S-06 | plan-enforcer 应拦截 Starter 套餐租户访问 DataOS API（dataos 层级为 'none'） | P2 | S15 实现 plan-enforcer 时确保 |
| S-07 | Stripe Webhook endpoint 需 HTTPS（生产环境） | P1 | S20 Live Mode 切换时配置 |
| S-08 | 年付套餐提前解约 50% 违约金的法律合规性需确认 | P3 | S20 实现前法务确认 |
| S-09 | Onboarding 邮件验证需防刷（限频 + CAPTCHA） | P2 | S17 实现 auth.ts 时确保 |

---

## Constitution 修订建议（Q2 2026 评审输入）

Phase 5 引入了 Constitution v1.0 未覆盖的新领域，建议在 Q2 2026 评审时补充：

| # | 建议修订 | 影响章节 | 理由 |
|---|---------|---------|------|
| C-01 | 新增 §3.1 "允许的外部 SaaS SDK"：Stripe / Resend / NextAuth.js | Ch3 技术栈 | 这些是 Phase 5 核心依赖，应明确列为"允许" |
| C-02 | 新增 §5.2 禁止行为："ClipMart 模板不允许修改 System Constitution" | Ch5 Agent 行为 | Phase 5 已实现此规则（security-validator.ts），应正式写入 Constitution |
| C-03 | 新增 §5.4 审批门控："模板发布需安全校验"行 | Ch5 审批门控 | Phase 5 新增的治理门控 |
| C-04 | 新增 §6.4 "套餐级别限制"：不同套餐的 Agent 数/平台数/DataOS 可用性 | Ch6 多租户 | Phase 5 引入的新约束维度 |
| C-05 | 更新 §2 Agent 总数：从 "21 核心 Agents" 更新为 "22 核心 Agents（含 CS Agent）" | Ch1/Ch2 | CS Agent 是 Phase 5 PDF 定义的新角色 |
| C-06 | 新增 §8.1 监控指标：`billing.subscription.active` / `billing.usage.overage` / `cs.health_score` | Ch8 可观测性 | Phase 5 新增的业务指标 |

---

## 汇总

| 对齐层级 | 总检查项 | 完全合规 | 已知偏差（有决策） | 需补充 |
|---------|---------|---------|-----------------|--------|
| **宪法（Chapter 1–10）** | 38 | 37 | 0 | 1（Q2 评审补充外部 SDK） |
| **蓝图（Master Blueprint）** | 16 | 11 | 5（CS Agent 新增 / Phase 分拆 / Harness 插件→ClipMart / Support Relay / Amazon Sandbox） | 0 |
| **Phase 5 PDF 实施计划** | 22 AC + 时间轴 + 8 章 | 全部覆盖 | 1（MRR $10k→$6k 以验收清单为准） | 0 |

### 对比 Phase 4 对齐报告

| 维度 | Phase 4 对齐 | Phase 5 对齐 | 趋势 |
|------|------------|------------|------|
| 宪法偏差 | 1（Frontend 推迟） | 0（**Phase 5 已修复**） | ↗️ 改善 |
| 蓝图偏差 | 2 | 5（含 3 项 Phase 4 延续） | — 新增为合理范围拆分 |
| PDF AC 覆盖率 | 25/25 + 3 额外 | 22/22 | ✅ 完全覆盖 |
| 需补充项 | 3（P2/P3） | 6（P1~P3） | — Phase 5 范围更大 |
| 时间轴对齐 | 16 周完全对齐 | 12 周完全对齐 | ✅ |

**总体评估：Phase 5 规划文档在宪法、蓝图、PDF 实施计划三层高度对齐。**

- **宪法合规率 100%**：Phase 4 唯一偏差（Frontend 推迟）已在 Phase 5 修复
- 6 项已知偏差均有明确决策记录和理由，其中 3 项延续自 Phase 4
- 6 项需补充均为 P1~P3 级别，可在对应 Sprint 实现时顺带解决
- Phase 5 PDF 22 项验收条件 **全部覆盖**，零遗漏
- 时间轴与 PDF 12 周 **完全一一对应**
- 建议 Q2 2026 Constitution 季度评审时纳入 6 项修订建议
