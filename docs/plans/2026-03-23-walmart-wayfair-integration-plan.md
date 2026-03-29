---
date: 2026-03-23
topic: walmart-wayfair-integration
source_brainstorm: docs/brainstorms/2026-03-23-walmart-wayfair-platform-evaluation-brainstorm.md
version: "1.1"
---

# Walmart Marketplace + Wayfair B2B 实施计划

**周期：** 3 个 Sprint，约 10 个开发日  
**目标：** 在不违反 `docs/system-constitution.md` 的前提下，新增 `Walmart` Marketplace 接入，并将 `Wayfair` 作为 `B2B` 通道能力接入现有系统  
**验收：** 19 项（见 §7）  
**前提：** Phase 1–5 已交付；现有四平台主路径稳定；`docs/brainstorms/2026-03-23-walmart-wayfair-platform-evaluation-brainstorm.md` 已确认作为约束输入  
**不做：**
- Walmart Ads API 一期实现
- Wayfair GraphQL Marketplace Harness
- Wayfair poller / 轮询机制
- 默认新增数据库表
- 未经审批的 Harness 核心接口扩展

---

## 0. 架构决策（Plan 前提）

### 0.1 继承的硬约束

| # | 约束 | 结论 | 来源 |
|---|------|------|------|
| D1 | Harness 抽象 | Agent 不得绕过 Harness 直接调用平台 SDK / API | Constitution Ch2.3 |
| D2 | API First | 内部新增能力优先以 REST + OpenAPI 边界呈现 | Constitution Ch2.2 |
| D3 | 审批门控 | 价格 / 广告 / 库存写操作继续走既有审批链路 | Constitution Ch5 + governance-gates |
| D4 | 多租户隔离 | 新增核心表必须 `tenant_id + RLS`；若无必要，不新增表 | Constitution Ch6 |
| D5 | Harness 维护责任 | Harness 变更保持向后兼容；覆盖率不低于 80% | Constitution Ch7 |
| D6 | 安全 | 平台凭证继续使用 AES-256 加密 | Constitution Ch9 |
| D7 | 可观测性 | 新平台必须纳入现有错误率 / 控制台 / 指标体系 | Constitution Ch8 |
| D8 | DataOS 降级 | DataOS 写入失败不得阻塞主链路 | ADR-0003 |

### 0.2 本计划新增决策

| # | 决策 | 结论 |
|---|------|------|
| D9 | Walmart 接入路径 | 作为新的 Marketplace 平台进入主路径：`SUPPORTED_PLATFORMS`、`createHarness`、凭证解析、Webhook、控制台、DataOS |
| D10 | Wayfair 接入路径 | 不新建 Marketplace Harness；通过 `b2b.harness.ts` 复用 EDI 850 / Backend Adapter / 阶梯价能力 |
| D11 | 计费策略 | Marketplace 与 B2B 分开计数；保留现有 `canAddPlatform()`，新增 B2B 计数函数 |
| D12 | Schema 策略 | 一期默认不新增表；若实施中发现确需新增表，单独触发 Schema 审批 |
| D13 | 接口策略 | 一期不默认新增核心 Harness 接口；若现有 `TenantHarness` / B2B 抽象不足，再单独触发 Harness 接口审批 |
| D14 | Walmart Ads | 一期只保留扩展位，不实现 AdsCapable 具体逻辑 |

---

## 1. 范围与非目标

### 1.1 In Scope

- Walmart Marketplace 主路径接入
- Walmart 凭证注册、Harness、Webhook、库存能力、控制台可见性
- Wayfair 通过 B2B 路径接入
- Wayfair EDI 850 适配、B2B 凭证注册、阶梯价映射
- DataOS 事件与特征最小接入
- Billing / Onboarding / Console / Metrics 的必要扩展
- 覆盖率、冒烟、端到端集成验证

### 1.2 Out Of Scope

- Walmart 广告预算管理与广告报表
- Wayfair GraphQL API 路径
- 新的 Wayfair 专属 Agent
- 动态合规规则配置化
- 新的前端页面类型或新的平台管理模型

---

## 2. 现状与目标态

### 2.1 当前现状

- Marketplace 主路径支持 `shopify`、`amazon`、`tiktok`、`shopee`
- `Platform` 类型已包含 `b2b`
- `b2b.harness.ts` 已支持 EDI 850、阶梯价、Backend Adapter
- Billing 已按套餐限制 Marketplace 平台数量：`starter=1`、`growth=3`、`scale=5`
- DataOS 使用 ClickHouse `platform String`，支持直接写入新平台值

### 2.2 目标态

- Walmart 成为第 5 个 Marketplace 平台
- Wayfair 作为 B2B 配置实例接入，不进入 `SUPPORTED_PLATFORMS`
- Marketplace 与 B2B 分开计数
- 新平台事件进入现有 DataOS / Console / Metrics 语义
- 不新增未经审批的核心接口或 schema

---

## 3. 影响面

### 3.1 Walmart（Marketplace 主路径）

需要触达的主要区域：

- `packages/harness/src/`
- `apps/api/src/lib/`
- `apps/api/src/routes/`
- `packages/market/`
- `packages/billing/`
- `apps/api/src/routes/onboarding-wizard.ts`
- `apps/api/src/routes/console.ts`
- `apps/dataos-api/` 与 `packages/dataos/`

### 3.2 Wayfair（B2B 路径）

需要触达的主要区域：

- `packages/harness/src/b2b.harness.ts` 或其 adapter 配置
- B2B 凭证注册/配置入口
- `packages/billing/src/plan-enforcer.ts`
- `apps/api/src/routes/console.ts`
- `apps/dataos-api/` 与 `packages/dataos/`

---

## 4. Monorepo 变更清单

### 4.1 新建文件

| # | 文件 | 用途 |
|---|------|------|
| 1 | `packages/harness/src/walmart.types.ts` | Walmart 凭证与响应类型；`credential_type` 约定为 `client_credentials`；`region` 存储于 `platform_credentials.metadata.region`（值域：`us`/`ca`/`mx`） |
| 2 | `packages/harness/src/walmart.harness.ts` | Walmart Marketplace Harness |
| 3 | `packages/harness/src/walmart.harness.test.ts` | Walmart Harness 测试 |
| 4 | `apps/api/src/routes/walmart/oauth.ts` | Walmart 凭证注册 / OAuth 风格接入入口 |
| 5 | `apps/api/src/routes/walmart/webhook.ts` | Walmart Webhook 接收路由 |
| 6 | `apps/api/src/lib/walmart-region.ts` | Walmart 区域到 endpoint 解析 |
| 7 | `apps/api/src/lib/walmart-webhook-subscription.ts` | Walmart webhook 订阅管理 |
| 8 | `apps/api/src/routes/b2b-wayfair.ts` 或同等配置入口 | Wayfair B2B 凭证/配置注册 |

### 4.2 修改文件

| # | 文件 | 变更 |
|---|------|------|
| 1 | `packages/harness/src/types.ts` | `Platform` 增加 `walmart` |
| 2 | `packages/harness/src/index.ts` | 导出 Walmart Harness |
| 3 | `apps/api/src/lib/supported-platforms.ts` | 增加 `walmart` |
| 4 | `apps/api/src/lib/harness-factory.ts` | 新增 Walmart case |
| 5 | `apps/api/src/lib/resolve-credential.ts` | 新增 Walmart 凭证解析顺序 |
| 6 | `apps/api/src/lib/webhook-topic-handler.ts` | 同步更新 `WebhookPlatform` 类型为 `walmart`；新增 `WalmartTopic` 及 stub handler |
| 7 | `apps/api/src/lib/agent-bootstrap.ts` | 可选新增 Walmart env 工厂 |
| 8 | `apps/api/src/app.ts` | 注册 Walmart 路由与 Wayfair B2B 配置入口 |
| 9 | `apps/api/src/server.ts` | 启动期注册 Walmart 相关初始化 |
| 10 | `packages/billing/src/plan-enforcer.ts` | 新增 B2B 连接计数函数 |
| 11 | `packages/shared/src/constants.ts` | 若需要，增加 B2B 限制常量 |
| 12 | `apps/api/src/routes/console.ts` | 展示 Walmart / Wayfair(B2B) 状态 |
| 13 | `apps/api/src/routes/onboarding-wizard.ts` | 增加 Walmart 步骤；Wayfair 走 B2B 对应步骤 |
| 14 | `apps/api/src/plugins/metrics.ts` | 新平台 metrics 标签扩展 |
| 15 | `packages/market/src/*` | Walmart 货币/税务/合规规则增量 |
| 16 | `packages/agent-runtime/src/compliance/*` | 新平台规则增量 |
| 17 | `apps/dataos-api/src/internal-routes.ts` / `packages/dataos/src/*` | Walmart / Wayfair 事件与特征接入 |
| 18 | `.env.example` | Walmart / Wayfair B2B 相关变量 |
| 19 | `apps/api/src/routes/app.smoke.test.ts` | 路由冒烟覆盖 |

### 4.3 实施前 Gate 检查表

在进入代码实施前，先逐项确认以下问题；任一项回答为“是”，先暂停并补审批或修正文档：

| Gate | 问题 | 当前预判 | 行动 |
|------|------|----------|------|
| G-01 | 是否需要新增 `TenantHarness` 核心方法？ | 否 | 继续；若 Walmart 或 Wayfair 实施中发现现有方法不足，先触发 Harness 接口审批 |
| G-02 | 是否需要新增数据库表？ | 否 | 继续；若中途发现确需持久化新状态，先触发 Schema 审批 |
| G-03 | 是否会破坏 `SUPPORTED_PLATFORMS` 与 `Platform` 的既有语义边界？ | 否 | Walmart 进入 Marketplace；Wayfair 保持在 B2B 语义 |
| G-04 | 是否会绕开现有审批 worker？ | 否 | 所有高风险写操作继续复用 `approval.execute` |
| G-05 | 是否会把外部协议差异泄露到 Agent 层？ | 否 | GraphQL / EDI / HMAC 仅允许存在于 Harness 或 adapter 层 |
| G-06 | 是否需要修改套餐平台上限常量？ | 否 | 本期只新增 B2B 独立计数函数，不重写 Marketplace 限额 |
| G-07 | 是否需要变更 DataOS DDL？ | 否 | `platform` 为 `String`，直接写入新值 |
| G-08 | 是否需要新增前端页面类型？ | 否 | 仅在现有 Onboarding / Console / Settings 语义下增量扩展 |

---

## 5. 三 Sprint 拆解

### 5.1 Sprint A 文件级执行顺序（Walmart）

建议按以下顺序实施，减少返工：

> **⚠ 编译中间态说明：** 步骤 1 将 `walmart` 加入 `Platform` 联合类型后，`harness-factory.ts` 中的 exhaustive switch 将产生编译错误，这是**预期行为**。该错误将在步骤 3 中添加 Walmart case 后消除。在步骤 1–3 之间应避免将中间态合入主分支。

1. **类型与平台入口先行**
   - `packages/harness/src/types.ts` — `Platform` 增加 `walmart`
   - `apps/api/src/lib/supported-platforms.ts`

2. **Harness 本体与测试骨架**
   - `packages/harness/src/walmart.types.ts`
   - `packages/harness/src/walmart.harness.ts`（含 HTTP 韧性参数：`timeout: 15_000`、指数退避重试 3 次、TokenBucket 速率限制，与 Amazon Harness 保持一致）
   - `packages/harness/src/walmart.harness.test.ts`

3. **凭证与构造接线**（消除步骤 1 产生的编译错误）
   - `apps/api/src/lib/harness-factory.ts` — 新增 Walmart case
   - `apps/api/src/lib/resolve-credential.ts` — Walmart 凭证 `credential_type` 约定为 `client_credentials`
   - 视需要修改 `apps/api/src/lib/agent-bootstrap.ts`

4. **区域与 webhook 支撑**
   - `apps/api/src/lib/walmart-region.ts`
   - `apps/api/src/lib/walmart-webhook-subscription.ts`
   - `apps/api/src/lib/webhook-topic-handler.ts` — 同步更新 `WebhookPlatform` 类型，新增 `WalmartTopic` 及对应 stub handler

5. **Market 层增量**
   - `packages/market/src/*` — Walmart 货币/税务/合规规则增量

6. **HTTP 路由**
   - `apps/api/src/routes/walmart/oauth.ts`
   - `apps/api/src/routes/walmart/webhook.ts`
   - `apps/api/src/app.ts`
   - `apps/api/src/server.ts`

7. **Barrel Export（在 Harness 与路由稳定后）**
   - `packages/harness/src/index.ts` — 导出 Walmart Harness（放在路由注册之后确保不暴露未就绪的模块）

8. **验证与收口**
   - `apps/api/src/routes/app.smoke.test.ts`
   - `apps/api/src/plugins/metrics.ts`
   - `.env.example`
   - 运行验证：`pnpm typecheck && pnpm lint && pnpm test`

### 5.2 Sprint A 每步完成定义

| 步骤 | 完成定义 |
|------|----------|
| 类型入口 | `walmart` 在编译期可通过类型检查，且未影响 `b2b` 语义 |
| Harness 本体 | 可实例化、可处理 token、可返回 `TenantHarness` 约定数据结构；`Analytics.truncated` 标志正确设置 |
| 凭证接线 | DB 凭证可成功解析并构造 Walmart Harness |
| Webhook 支撑 | topic 可注册，未知 handler 不会破坏既有语义 |
| Market 层 | Walmart 货币/税务/合规规则已纳入 `packages/market` |
| HTTP 路由 | 路由完成注册，能被 smoke test 发现 |
| Barrel Export | `packages/harness/src/index.ts` 导出 Walmart，确认编译通过 |
| 验证收口 | `pnpm typecheck && pnpm lint && pnpm test` 全部通过，配置项齐全，metrics 标签无遗漏 |

### Sprint A · Walmart Marketplace 核心接入（约 4.5 天）

**交付物：** Walmart 进入 Marketplace 主路径；可完成凭证注册、Harness 构造、Webhook 接收、库存读取/更新、控制台可见

| # | 任务 | 文件/区域 | 依赖 | 估时 |
|---|------|-----------|------|------|
| A1 | 在 `Platform` / `SUPPORTED_PLATFORMS` 中引入 `walmart` | `packages/harness`, `apps/api/src/lib` | — | 0.5d |
| A2 | 实现 `walmart.types.ts` 与 `walmart.harness.ts` | `packages/harness/src` | A1 | 1d |
| A3 | 实现 Walmart token 刷新与并发保护 | `walmart.harness.ts` | A2 | 0.5d |
| A4 | 为 Walmart 增加 `InventoryCapable` 支持 | `walmart.harness.ts` | A2 | 0.5d |
| A5 | 在 `harness-factory.ts` / `resolve-credential.ts` 接线 | `apps/api/src/lib` | A2 | 0.5d |
| A6 | 新增 `routes/walmart/oauth.ts` | `apps/api/src/routes/walmart` | A5 | 0.5d |
| A7 | 新增 `routes/walmart/webhook.ts` 与订阅管理 | `apps/api/src/routes/walmart`, `apps/api/src/lib` | A6 | 0.5d |
| A8 | `webhook-topic-handler.ts` / `app.ts` / `server.ts` 注册 | `apps/api/src` | A7 | 0.5d |
| A9 | Walmart Harness 与路由测试 | `packages/harness`, `apps/api` | A2–A8 | 0.5d |

**Sprint A 验收：**

- [ ] `walmart` 已进入 Marketplace 主路径
- [ ] 可基于加密凭证构造 Walmart Harness
- [ ] Walmart webhook 可通过签名校验并入现有分发语义
- [ ] 不新增未审批的 Harness 核心接口
- [ ] Walmart `Analytics.truncated` 标志在 Harness 层正确设置
- [ ] Walmart 相关测试通过，覆盖率不低于 80%

### Sprint B · Wayfair B2B 适配（约 2 天）

**交付物：** Wayfair 作为 B2B 配置实例接入，不进入 Marketplace 主路径

| # | 任务 | 文件/区域 | 依赖 | 估时 |
|---|------|-----------|------|------|
| B1 | 确认 Wayfair EDI 850 映射与 `parseEDI850` 兼容性 | `packages/harness/src/b2b.harness.ts` | — | 0.5d |
| B2 | Wayfair Backend Adapter 配置 | B2B adapter 配置层 | B1 | 0.5d |
| B3 | 新增 Wayfair B2B 凭证/配置入口 | `apps/api/src/routes` | B2 | 0.5d |
| B4 | 阶梯价与 partner 配置映射 | `b2b.harness.ts` 或配置层 | B2 | 0.25d |
| B5 | 新增 B2B 计数 enforcement | `packages/billing/src/plan-enforcer.ts` | — | 0.25d |
| B6 | Wayfair B2B 测试与控制台接线 | `packages/harness`, `apps/api/src/routes/console.ts` | B1–B5 | 0.5d |

**Sprint B 验收：**

- [ ] Wayfair 不进入 `SUPPORTED_PLATFORMS`
- [ ] Wayfair 通过 B2B 路径完成最小可用接入
- [ ] Marketplace 与 B2B 计数已分离
- [ ] 不引入 Wayfair GraphQL Harness 或 poller
- [ ] Wayfair B2B 相关测试通过

### Sprint C · 生态集成与观测（约 3 天）

**交付物：** Walmart / Wayfair 进入 DataOS、Console、Onboarding、Metrics 与合规语义

| # | 任务 | 文件/区域 | 依赖 | 估时 |
|---|------|-----------|------|------|
| C1 | 定义 Walmart / Wayfair 的最小事件契约 | `apps/dataos-api`, `packages/dataos` | A9, B6 | 0.5d |
| C2 | 接入 Event Lake，保证失败可降级 | `packages/dataos/src`, `apps/dataos-api` | C1 | 0.5d |
| C3 | 注册最小 Feature Store 特征 | DataOS 特征层 | C1 | 0.5d |
| C4 | 增量合规规则：Walmart Marketplace + Wayfair B2B | `packages/agent-runtime/src/compliance` | A9, B6 | 0.5d |
| C5a | Billing 扩展：Marketplace/B2B 双轨计数可视化与边界测试 | `packages/billing` | A9, B6 | 0.25d |
| C5b | Onboarding Wizard：新增 Walmart 步骤 + Wayfair B2B 步骤 | `apps/api/src/routes/onboarding-wizard.ts` | A9, B6 | 0.25d |
| C5c | Console API：新平台状态面板数据接口 | `apps/api/src/routes/console.ts` | A9, B6 | 0.25d |
| C6 | Metrics / smoke / e2e 验证 | `apps/api/src/plugins/metrics.ts`, tests | C2–C5c | 0.5d |

**Sprint C 验收：**

- [ ] 新平台关键事件可以进入现有事件语义
- [ ] DataOS 写入失败不阻塞主链路
- [ ] Console 可见 Walmart / Wayfair(B2B) 状态
- [ ] Billing / Onboarding 不再假设只有原四平台
- [ ] Metrics 和 smoke tests 覆盖新路径

---

## 6. 关键风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Walmart token 高频刷新产生竞态 | 认证失败或请求抖动 | 在 Harness 内做 promise 级别去重 / 互斥保护 |
| Wayfair EDI 变体与现有解析不一致 | B2B 适配失败 | 先做样本映射验证；仅支持一期确认过的变体 |
| Billing 把 B2B 与 Marketplace 混算 | 套餐错误拦截 | 明确新增独立计数函数，不改写现有 Marketplace 逻辑 |
| 新平台事件进入 DataOS 后造成耦合 | 主链路被分析链路拖慢 | 严格遵守 ADR-0003，异步写入，失败降级 |
| 合规规则不完整 | 平台写操作存在风险 | 一期只落最小必要规则，保守放行策略交由审批门控兜底 |
| `scale` 套餐 Marketplace 平台上限恰好用完 | Walmart 上线后 `scale` 套餐正好达到 5/5 上限，无法再接入新 Marketplace | 一期不改限额；在 Sprint C 结束后评估是否将 `scale` 上限从 5 调整为 6，或引入按需计费（需单独 ADR） |

---

## 7. 验收清单（19 项）

### Walmart

- [ ] `Platform` 类型包含 `walmart`
- [ ] `SUPPORTED_PLATFORMS` 包含 `walmart`
- [ ] `createHarness` 可构造 Walmart Harness
- [ ] Walmart 凭证可加密存储与读取（`credential_type: client_credentials`）
- [ ] Walmart webhook 接入成功
- [ ] Walmart 库存能力可通过能力检测
- [ ] Walmart `Analytics.truncated` 标志正确设置

### Wayfair

- [ ] Wayfair 复用 B2B 路径，不新增 `wayfair.harness.ts`
- [ ] Wayfair EDI 850 订单可进入 B2B 语义
- [ ] Wayfair B2B 凭证可配置
- [ ] B2B 计数与 Marketplace 计数已分离

### 平台共性

- [ ] 不新增未经审批的 Harness 核心接口
- [ ] 不新增未经审批的 schema
- [ ] DataOS 失败不阻塞主链路
- [ ] Console 能展示新平台状态
- [ ] Billing / Onboarding 与实际平台路径一致
- [ ] Metrics 纳入新平台标签
- [ ] 新增或修改测试通过
- [ ] 相关覆盖率保持 ≥80%

---

## 8. 实施前显式假设

1. Walmart 一期不实现 AdsCapable 具体能力，只保留后续扩展位。
2. Wayfair 一期只支持已经确认的单一 B2B / EDI 接入变体，不承诺兼容所有 Partner 差异。
3. 一期默认不新增数据库表；如中途发现确需新表，暂停实施并先走 Schema 审批。

## 9. Next Steps

1. 先在计划执行前复核是否触发 `Harness 接口审批` 或 `Schema 审批`。
2. 若无需新增核心接口与新表，按 Sprint A → B → C 顺序实施。
3. 每个 Sprint 结束后执行显式验证：
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
   并确认 route smoke、package tests、coverage ≥80% 与控制台可见性。
4. Sprint C 结束后评估 `PLAN_PLATFORM_LIMITS.scale`（当前 5）是否需调整为 6 以容纳未来新 Marketplace（需单独 ADR）。
