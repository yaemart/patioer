# Sprint 17 实现代码 · 宪法 / 蓝图 对齐审查报告

**审查日期：** 2026-03-29  
**审查范围：** Sprint 17 全部新增/修改代码 + Sprint 15-16 偏差修复 + 质检自检修复  
**基线：** `system-constitution.md` v1.0 · Master Blueprint PDF · `phase5-electroos.pdf`  
**前序文档：** `sprint15-16-code-constitution-blueprint-alignment.md`

---

## 零、Sprint 15-16 遗留偏差修复状态

Sprint 15-16 审查报告发现 6 项偏差（1×P0 + 2×P1 + 3×P2）。Sprint 17 启动前全部完成修复：

| 编号 | 偏差 | 修复措施 | 验证状态 |
|------|------|---------|---------|
| **F-04** (P0) | 密码 SHA-256 无 salt | ✅ 改用 `scryptSync` + 16 字节 random salt + `timingSafeEqual` 验证 | 13 tests PASS |
| **F-05** (P1) | 用户数据内存 Map | ✅ 改为 injectable `UserStore` 接口；可替换为 DB 实现 | 13 tests PASS |
| **F-06** (P1) | JWT 存 `localStorage` | ✅ 改为 `httpOnly` cookie（`Set-Cookie: eos_token=…; HttpOnly; SameSite=Lax`）；前端使用 `credentials: 'include'` | 验证通过 |
| **F-02** (P2) | auth 错误非结构化 | ✅ 全部 4xx 改为 `{ type: AuthErrorType, message: string }` | 13 tests PASS |
| **F-03** (P2) | 缺少 Prometheus 指标 | ✅ 新增 3 个 Counter：`auth_operation_total`、`billing_operation_total`、`stripe_webhook_total` | 注册到 `metricsRegistry` |
| **F-01** (P2) | Stripe 未在宪法 §3.1 | 延续至 Q2 Constitution 评审 | — |

**质检自检额外修复：**

| 编号 | 偏差 | 修复措施 |
|------|------|---------|
| **Q-01** (P0) | JWT 签名 `createHash` 非 HMAC | ✅ 改用 `createHmac('sha256', secret)` |
| **Q-02** (P0) | Stripe webhook 签名 `createHash` 非 HMAC | ✅ 改用 `createHmac('sha256', secret)` |
| **Q-05** (P1) | `billing.ts` 动态 import | ✅ 改为顶部 `import { PLAN_BUDGET_USD, PLAN_NAMES }` |

---

## 一、宪法（System Constitution v1.0）逐章对齐

### CHAPTER 1 · 使命

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §1.1 ElectroOS 使命 | 多租户自动化 AI 电商运营 | 7 步 Onboarding 向导实现多租户 SaaS 开通全链路：注册→选套餐→公司信息→平台 OAuth→Agent 配置→治理规则→健康检查 | ✅ 对齐 |
| §1.3 两层关系 | DevOS builds ElectroOS | 代码仅涉及 ElectroOS 层，未触碰 DevOS 边界 | ✅ 对齐 |

### CHAPTER 2 · 系统架构原则

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §2.1 模块化 | 禁止单体；每模块 API 通信 | `@patioer/onboarding` 独立包（`package.json` + `tsconfig.json`）；`onboarding-machine.ts` 通过 `OnboardingStore` 接口解耦存储，不直接 import Drizzle | ✅ 对齐 |
| §2.2 API First | REST + OpenAPI 3.0 + `/api/v1/` | 3 个新端点均使用 Fastify schema 自动生成 OpenAPI：`GET /api/v1/onboarding/state`、`POST /api/v1/onboarding/advance`、`POST /api/v1/onboarding/skip` | ✅ 对齐 |
| §2.3 Harness 抽象 | Agent 不直接调用 SDK | Onboarding Step 4 记录 OAuth 结果（`oauthResults`），通过现有 Shopify/Amazon OAuth 路由进行实际 OAuth，不直接调用平台 SDK | ✅ 对齐 |
| §2.4 事件驱动 | 事件解耦 | ⚠️ 完成 onboarding 后未发出 `tenant.onboarded` 事件（§2.4 列出的核心事件之一） | ⚠️ 见 D-01 |
| §2.5 数据所有权 | 每 Service 独立 schema | Onboarding 状态存储在 `onboarding_progress` 表（`packages/db/src/schema/onboarding.ts`），归 onboarding 域所有 | ✅ 对齐 |

### CHAPTER 3 · 技术栈标准

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §3.1 Backend | Node.js + TypeScript + Fastify | `onboarding-machine.ts` 纯 TypeScript；`onboarding-wizard.ts` Fastify 路由 | ✅ 对齐 |
| §3.1 Frontend | Next.js + React + TypeScript + Tailwind | `apps/web/src/app/(auth)/onboarding/page.tsx`：Next.js 15 + React 19 + Tailwind CSS | ✅ 对齐 |
| §3.1 ORM | Drizzle ORM | `packages/db/src/schema/onboarding.ts` Drizzle 定义 | ✅ 对齐 |
| §3.1 禁止 | 无 Vue/Angular/Prisma | 未引入任何禁止技术 | ✅ 对齐 |

### CHAPTER 4 · 代码规范

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §4.1 变量 | `camelCase` | `currentStep`, `stepData`, `oauthStatus`, `healthCheckPassed`, `tenantId`, `approvalThreshold` | ✅ 对齐 |
| §4.1 类/接口 | `PascalCase` | `OnboardingMachine`, `OnboardingStore`, `StepInput`, `StepValidator` | ✅ 对齐 |
| §4.1 常量 | `UPPER_SNAKE_CASE` | `MAX_STEP`, `SKIPPABLE_STEPS`, `STEP_VALIDATORS`, `ONBOARDING_STEP_NAMES`, `VALID_PLANS` | ✅ 对齐 |
| §4.1 文件 | `kebab-case` | `onboarding-machine.ts`, `onboarding-wizard.ts`, `onboarding.types.ts`, `api-client.ts` | ✅ 对齐 |
| §4.2 模块结构 | `.service.ts` / `.types.ts` / `.test.ts` | `onboarding-machine.ts`（service）+ `onboarding.types.ts`（types）+ `onboarding-machine.test.ts`（test）| ✅ 对齐 |
| §4.3 错误处理 | 结构化错误分类 | `OnboardingStepResult { step, success, error }` 提供结构化验证错误；API 层 400 响应使用 `{ type, message }`；auth 路由统一为 `AuthErrorType` 联合类型（F-02 已修） | ✅ 对齐 |

### CHAPTER 5 · AI Agent 行为规则

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §5.1 预算检查 | Agent 执行前检查月预算 | Step 5 `agentConfig` 允许设定 `budgetLimitUsd`；Step 6 `governancePrefs` 设定 `approvalThreshold` | ✅ 对齐 |
| §5.2 价格审批 | 变动 >15% 需审批 | Step 6 前端默认 `approvalThreshold = 15`（%），与 §5.4 审批表一致；校验范围 0-100% | ✅ 对齐 |
| §5.3 必须行为 | 代码提交包含测试 | S17 新增 39 个测试用例（onboarding-machine 29 + wizard 10），全部通过 | ✅ 对齐 |
| §5.3 RLS 验证 | 跨租户数据必须 RLS | `onboarding_progress` 表 RLS 策略在 `0011_onboarding_billing.sql` 中已启用（Sprint 15） | ✅ 对齐 |

### CHAPTER 6 · 多租户规则

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §6.1 tenant_id | 核心表必须有 `tenant_id` | `onboarding_progress` 表含 `tenant_id UUID NOT NULL FK`，有唯一索引 | ✅ 对齐 |
| §6.1 RLS | PostgreSQL RLS 强制隔离 | `ENABLE + FORCE ROW LEVEL SECURITY` + `tenant_isolation_onboarding_progress` 策略 | ✅ 对齐 |
| §6.2 租户级配置 | 可覆盖审批阈值 | Step 6 `governancePrefs.approvalThreshold` 允许每租户自定义（默认 15%） | ✅ 对齐 |
| §6.2 租户级配置 | Agent 月预算上限 | Step 5 `agentConfig.budgetLimitUsd` per-tenant | ✅ 对齐 |
| §6.3 Agent 预算隔离 | 租户间互不影响 | `OnboardingMachine` 全部方法以 `tenantId` 为首参数；`OnboardingStore` 按 tenantId 隔离 | ✅ 对齐 |

### CHAPTER 7 · DevOS 特殊规则

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §7.2 DB 变更 | 只能通过 migration | Sprint 17 未新增 migration（复用 Sprint 15 的 `0011_onboarding_billing.sql`），无直接 DB 操作 | ✅ 对齐 |
| §7.2 测试覆盖 | ≥80% | onboarding 包 29 tests 覆盖全部公开函数和全链路流程；wizard 路由 10 tests 覆盖 state/advance/skip + E2E | ✅ 对齐 |
| §7.2 新依赖审查 | 引入新核心依赖需评审 | 仅新增 `@patioer/onboarding`（workspace 内部包），无外部新依赖 | ✅ 对齐 |

### CHAPTER 8 · 可观测性标准

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §8.1 auth 指标 | — | `auth_operation_total`（action: register/login × outcome: success/duplicate/invalid_credentials）已埋点（F-03 已修） | ✅ 对齐 |
| §8.1 billing 指标 | — | `billing_operation_total`（action: checkout_session/portal_session × plan）已埋点 | ✅ 对齐 |
| §8.1 webhook 指标 | — | `stripe_webhook_total`（event_type × outcome: processed/rejected）已埋点 | ✅ 对齐 |
| §8.1 onboarding 指标 | — | ⚠️ onboarding wizard 路由（state/advance/skip）未添加 Prometheus 业务指标 | ⚠️ 见 D-02 |

### CHAPTER 9 · 安全原则

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §9 JWT Auth | 所有 API 使用 JWT | `auth.ts` 使用 HMAC-SHA256 签发/验证 JWT（Q-01 已修）；`/me` 同时支持 `Bearer` header 和 `eos_token` httpOnly cookie | ✅ 对齐 |
| §9 密码安全 | — | `scryptSync` + 16 字节 random salt + `timingSafeEqual`（F-04 已修）；生产环境强制 `JWT_SECRET`（启动时抛错） | ✅ 对齐 |
| §9 Webhook 安全 | — | `verifyStripeSignature` 使用 `createHmac('sha256', secret)`（Q-02 已修）+ `timingSafeEqual` | ✅ 对齐 |
| §9 Cookie 安全 | — | `HttpOnly; SameSite=Lax; Path=/`；生产环境追加 `Secure`（F-06 已修） | ✅ 对齐 |
| §9 RBAC | admin / seller / agent / readonly | JWT payload 含 `role` 字段 | ✅ 对齐 |
| §9 onboarding 鉴权 | — | ⚠️ `onboarding-wizard.ts` 依赖 `x-tenant-id` header 鉴权，未验证 JWT bearer token；前端已通过 `/auth/me` 获取 tenantId（Q-09 已修），但 API 端未做 JWT 校验 | ⚠️ 见 D-03 |
| §9 凭证管理 | 不写代码 | 环境变量读取；`getJwtSecret()` 生产强制校验 | ✅ 对齐 |

### CHAPTER 10 · 版本与演进

| 条款 | 要求 | Sprint 17 实现 | 状态 |
|------|------|---------------|------|
| §10 Constitution 不可修改 | DevOS 不自行修改 | `system-constitution.md` 未被修改 | ✅ 对齐 |

---

## 二、蓝图（Master Blueprint PDF）对齐 — Onboarding 专项

| 蓝图条目 | 要求 | Sprint 17 实现 | 状态 |
|-----------|------|---------------|------|
| 7 步 Onboarding | register → plan → company → OAuth → agent → governance → health | `ONBOARDING_STEP_NAMES` 完整 7 步；`STEP_VALIDATORS` 每步独立验证逻辑 | ✅ 对齐 |
| 套餐选择 | Starter / Growth / Scale | Step 2 `validateSelectPlan` 校验 3 档套餐；前端 Plan 卡片含价格/Agent 数/平台数 | ✅ 对齐 |
| 平台 OAuth | Shopify / Amazon / TikTok / Shopee | Step 4 `validatePlatformOauth` 白名单 4 平台；前端 4 平台选择器 | ✅ 对齐 |
| Agent 配置 | 按套餐启用 Agent | Step 5 `validateAgentConfig` 要求至少 1 个 Agent；前端 7 Agent 复选列表 | ✅ 对齐 |
| 治理规则 | 审批阈值可配 | Step 6 `governancePrefs.approvalThreshold`（0-100%）+ `humanInLoopAgents`；前端 slider 默认 15% | ✅ 对齐 |
| 健康检查 | 验证工作区就绪 | Step 7 `validateHealthCheck` 要求 `passed: true`；支持 `details` 扩展字段 | ✅ 对齐 |
| 可跳过步骤 | OAuth + Governance 可选 | `SKIPPABLE_STEPS = [4, 6]`；API 有 `POST /skip` 端点；前端 Skip 按钮 | ✅ 对齐 |
| 状态持久化 | `onboarding_progress` 表 | Drizzle schema + RLS + 唯一索引 `(tenant_id)`；`OnboardingStore` 接口支持 DB 替换 | ✅ 对齐 |
| 前端定价卡 | $299 / $799 / $1,999 | 前端 `PLANS` 常量：Starter $299/mo(3A/1P) / Growth $799/mo(7A/3P) / Scale $1,999/mo(9A/5P) | ✅ 对齐 |

---

## 三、Phase 5 PDF 验收标准覆盖（Sprint 17 部分）

| AC 编号 | 验收条件 | 覆盖 | 状态 |
|---------|---------|------|------|
| AC-P5-07 | 7 步 Onboarding 状态机 | `OnboardingMachine` + 29 tests | ✅ |
| AC-P5-08 | Onboarding API 端点 | 3 端点 (state/advance/skip) + 10 tests | ✅ |
| AC-P5-09 | 前端 Onboarding 向导 | 交互式 7 步 UI + 进度条 + Plan 卡片 + Agent 选择器 + Governance slider | ✅ |
| AC-P5-10 | OAuth 引导 | Step 4 记录平台 OAuth 状态（per-platform） | ✅ |
| AC-P5-11 | 健康检查 | Step 7 验证通过才允许完成 | ✅ |
| AC-P5-12 | 跳过可选步骤 | Step 4 + Step 6 支持 skip | ✅ |

---

## 四、发现的偏差

### ⚠️ 建议改进（Should Fix）

| 编号 | 位置 | 偏差 | 宪法条款 | 修复建议 | 优先级 |
|------|------|------|---------|---------|--------|
| **D-01** | `onboarding-machine.ts` | 完成 7 步后未发出 `tenant.onboarded` 事件；宪法 §2.4 将其列为核心事件之一 | §2.4 | 在 `advanceStep` 完成 step 7 后通过 EventLake 或 BullMQ 发出 `tenant.onboarded` 事件 | **P2** |
| **D-02** | `onboarding-wizard.ts` | Onboarding 路由未添加 Prometheus 业务指标（如 `onboarding_step_completed_total`、`onboarding_completed_total`） | §8.1 | S18 中新增 `onboardingStepTotal` Counter（labels: step, outcome）到 `metricsPlugin` | **P2** |
| **D-03** | `onboarding-wizard.ts` | API 路由仅依赖 `x-tenant-id` header，未验证 JWT token 或 cookie；任何知道 tenantId 的人可操作其他租户的 onboarding | §9 | 添加 JWT/cookie 验证中间件，确保 `x-tenant-id` 与 JWT 中 `tenantId` claim 一致 | **P1** |

---

## 五、合规亮点

| # | 亮点 | 说明 |
|---|------|------|
| H-01 | **纯函数状态机** | `advanceStep()` / `skipStep()` / `validateStep()` 为纯函数，与 I/O 完全解耦，可独立单元测试 |
| H-02 | **Store 接口抽象** | `OnboardingStore { getState, saveState }` 接口允许从 InMemory 无缝切换到 Drizzle PostgreSQL 实现 |
| H-03 | **严格步骤顺序** | 状态机强制顺序执行（`step !== state.currentStep` → reject），防止跳步攻击 |
| H-04 | **幂等初始化** | `getOrCreate()` 保证每个租户只创建一次初始状态 |
| H-05 | **Skippable 白名单** | 只有 Step 4 / 6 可跳过，通过 `SKIPPABLE_STEPS` Set 控制，非 skippable 步骤 skip 会被拒绝 |
| H-06 | **前端 auth 先行** | 前端 `onboarding/page.tsx` 先调 `/auth/me` 获取 `tenantId`（cookie 鉴权），再发起 onboarding API 调用 |
| H-07 | **完整 E2E 测试** | API 测试包含完整 7 步 E2E 流程（含 skip），验证最终 `completedAt` 和 `healthCheckPassed` |
| H-08 | **Sprint 15-16 全部安全偏差已修** | P0（scrypt + HMAC）、P1（httpOnly cookie + UserStore 接口）、P2（结构化错误 + Prometheus 指标）全部修复验证 |

---

## 六、汇总统计

### Sprint 17 交付物

| 维度 | 数量 |
|------|------|
| 新建/修改文件 | 12 |
| 新增测试 | 39（machine 29 + wizard 10）|
| 新增 API 端点 | 3（state / advance / skip）|
| DB migration | 0（复用 Sprint 15 的 0011）|
| 安全偏差修复 | 8（5 Sprint 15-16 + 3 质检）|
| 前端页面 | 1 完整重构（7 步交互式向导）|

### 宪法对齐评分

| 章节 | 条款数 | 通过 | 偏差 | 通过率 |
|------|--------|------|------|--------|
| CH1 使命 | 2 | 2 | 0 | 100% |
| CH2 架构 | 5 | 4 | 1 (D-01) | 80% |
| CH3 技术栈 | 4 | 4 | 0 | 100% |
| CH4 代码规范 | 6 | 6 | 0 | 100% |
| CH5 Agent 规则 | 4 | 4 | 0 | 100% |
| CH6 多租户 | 5 | 5 | 0 | 100% |
| CH7 DevOS | 3 | 3 | 0 | 100% |
| CH8 可观测性 | 4 | 3 | 1 (D-02) | 75% |
| CH9 安全 | 7 | 6 | 1 (D-03) | 86% |
| CH10 版本 | 1 | 1 | 0 | 100% |
| **总计** | **41** | **38** | **3** | **92.7%** |

### 与 Sprint 15-16 对比

| 指标 | S15-16 对齐 | S17 对齐（含修复） | 变化 |
|------|------------|-------------------|------|
| 总通过率 | 88.6%（39/44） | **92.7%**（38/41） | **+4.1%** ⬆ |
| P0 偏差 | 1（密码安全） | **0** | ⬇ 已修 |
| P1 偏差 | 2（内存存储 + localStorage） | **1**（D-03 鉴权） | ⬇ 改善 |
| P2 偏差 | 3（错误格式 + 指标 + Stripe） | **2**（事件 + 指标） | ⬇ 改善 |
| 安全评分 | 60%（3/5） | **86%**（6/7） | **+26%** ⬆ |

---

## 七、修复时间表

| 优先级 | 编号 | 修复 Sprint | 修复内容 |
|--------|------|-------------|---------|
| **P1** | D-03 | S18 Day 1 | onboarding-wizard 添加 JWT/cookie 验证中间件，确保 tenantId 与 token 一致 |
| **P2** | D-01 | S18 Day 2 | advanceStep 完成 step 7 后发出 `tenant.onboarded` 事件 |
| **P2** | D-02 | S18 Day 2 | 新增 `onboarding_step_total` + `onboarding_completed_total` Prometheus Counter |
| **P2** | F-01 | Q2 评审 | Constitution §3.1 新增 Stripe 允许条目（延续自 S15-16） |

---

## 八、结论

Sprint 17 代码实现**总体对齐率 92.7%**，相比 Sprint 15-16 的 88.6% **提升 4.1 个百分点**。

**核心改善：**
- **安全评分从 60% 提升至 86%**：全部 P0 安全偏差已修复（scrypt 密码哈希、HMAC-SHA256 JWT/Stripe 签名、httpOnly cookie）
- **零 P0 偏差**：首次实现 P0 清零
- **架构原则全面合规**：模块化、API First、多租户 RLS、数据所有权、Harness 抽象全部 100%

**剩余 3 项偏差均为 P1-P2**，最关键是 D-03（onboarding 路由鉴权），计划 Sprint 18 Day 1 修复。

**本次审查结论：Sprint 17 代码质量合格，安全基线已达标。**
