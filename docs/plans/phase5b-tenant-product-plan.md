# Phase 5B · 租户产品化实施计划

**日期：** 2026-03-30
**状态：** Draft
**前序：** Phase 5 SaaS 商业化（注册/计费/Onboarding）
**替代：** `tenant-ui-redesign-plan.md`、`agent-native-upgrade-plan.md`（合并为本文件）

---

## 0. 问题诊断

Phase 5 完成了 SaaS 基础设施（注册、登录、Onboarding、计费），但 **产品层存在十二个根本性缺陷**：

| # | 缺陷 | Constitution 违反 | 影响 |
|---|------|------------------|------|
| D1 | Dashboard 是 Agent 基础设施视角，不是卖家业务视角 | Ch1.1 "完全自动化的 AI 电商运营服务" — 卖家看不到运营 | 产品不可交付 |
| D2 | Human-in-the-loop 简化为一个数字 "Pending: 0"，无法审批 | Ch5.4 审批门控是系统核心功能 | 治理失效 |
| D3 | Price Sentinel/Ads Optimizer/Inventory Guard 是 if-else 脚本，不是 AI Agent | Ch5.1 "读取 goal_context" + Ch3.2 模型已分配但未使用 | 违反 Agent Native |
| D4 | Ads Harness 只有 `getAdsCampaigns` + `updateAdsBudget`，各平台差异未建模 | Ch2.3 Harness 抽象原则 — 抽象不足 | 广告功能空转 |
| D5 | 租户无法表达经营策略，goalContext 是技术参数 | Ch6.2 "租户级配置" 远未兑现 | 卖家无法控制 Agent 行为 |
| D6 | 经营指标缺少利润、贡献毛利、TACoS、退款损耗、平台费 | Ch1.1 卖家经营目标未被系统表达；Ch8.1 可观测性不足 | 容易“增长但不赚钱” |
| D7 | Inventory 只看库存阈值，不看交期、MOQ、在途、现金流 | Ch1.1 运营闭环不完整；Ch5.4 高影响采购缺少明确治理语义 | 无法形成真实补货决策 |
| D8 | Ads 只到 campaign/keyword 层，未与 SKU 生命周期和库存联动 | Ch1.1 经营目标未闭环；Ch2.3 Harness 语义抽象不足 | 广告优化停留在账户操作层 |
| D9 | SOP 是静态单文档，不支持平台/实体/时段差异 | Ch6.2 租户级配置过粗；Ch2.2 API First 未落到策略层 | 旺季/新品/清仓策略无法表达 |
| D10 | 审批中心缺少影响预估、回滚方案、失效时间、历史参考 | Ch5.4 审批门控产品化不足；Ch5.3 审计上下文不完整 | 卖家难以安心批准 |
| D11 | 售后、退款、账号健康、Listing 抑制、Buy Box 等经营面板缺失 | Ch1.1 “AI 电商运营服务”范围未覆盖；Ch8.1 监控缺口 | 不符合专业卖家日常工作流 |
| D12 | 验收标准偏功能完成，缺少利润改善、断货率下降、采纳率等结果指标 | Ch8.1 结果可观测性不足；Agent Native 学习闭环未落地到业务层 | 难证明产品价值 |

---

## 1. 指导原则

### 从 Constitution 提取的核心约束

| # | 条款 | 原则 | 本计划如何对齐 |
|---|------|------|--------------|
| C1 | Ch1.1 | **"人类只做战略决策，AI 负责一切执行"** | SOP 让卖家表达战略；Agent 用 LLM 执行；规则引擎兜底安全 |
| C2 | Ch2.3 | **Harness 抽象原则：Agent 不直接调用平台 SDK** | 广告扩展新增平台专属 Harness 子接口，Agent 仍通过 Harness 操作 |
| C3 | Ch3.2 | **模型已分配：Haiku 给定价、Sonnet 给分析** | 规则引擎 Agent 改造后真正使用分配的模型 |
| C4 | Ch5.1 | **Agent Pre-flight：读 goal_context → 检查 budget → 检查 pending → 读 Constitution** | 每个 Agent 改造后严格执行四步 pre-flight |
| C5 | Ch5.4 | **审批门控表** | 门控保留为安全网，LLM 决策在前，规则校验在后 |
| C6 | Ch6.2 | **租户级配置：价格阈值可调 5%-30%、Agent 月预算、客服语言** | 扩展为完整 SOP 体系 + 每 Agent 可配置 |
| C7 | Ch7.3 | **Harness 维护 SLA：48h 更新、向后兼容、集成测试** | 新 Harness 方法遵循同样 SLA |
| C8 | Ch2.4 | **事件驱动** | Agent 决策事件、SOP 变更事件纳入事件体系 |

### 从 AI Agent Native / Harness Engineering 提取的补充约束

#### AI Agent Native

> AI Agent Native 核心思想：**结构化约束 > 自由意志**；**数据驱动决策**；**全程可观测**；**自主降级**；**不可变审计**；**预算自我管理**。

| # | 原则 | 对 Phase 5B 的补充约束 |
|---|------|----------------------|
| AN-01 | **结构化约束 > 自由意志** | 卖家目标不能只留在自然语言里，必须落到 `goalContext` / 治理阈值 / 生命周期目标等结构化字段 |
| AN-02 | **数据驱动决策** | Price / Ads / Inventory 必须引入利润、费用、交期、在途、退款、账户健康等经营数据，而不是只看单个阈值 |
| AN-03 | **全程可观测** | 决策前提、执行结果、回滚原因、采纳/驳回结果都必须可追踪 |
| AN-04 | **自主降级** | 当利润、广告、库存或账户健康数据缺失时，Agent 必须降级为“只建议不执行”或“收缩权限”模式 |
| AN-05 | **不可变审计** | 高风险经营动作必须保留“为什么这么做、预计影响、谁批准了、如何回滚”的完整审计链 |
| AN-06 | **预算自我管理** | 不只是 LLM token 预算，还包括广告预算、补货现金占用、降价利润损耗三类经营预算 |

#### Harness Engineering

> Harness Engineering 核心思想：**平台操作完全封装**；**弹性（超时/重试）**；**类型化错误**；**多平台一致接口**；**凭证安全管理**；**向后兼容**。

| # | 原则 | 对 Phase 5B 的补充约束 |
|---|------|----------------------|
| HE-01 | **平台操作完全封装** | 账号健康、退款、Listing 抑制、广告、库存、采购相关平台能力都必须通过 Harness / Port 暴露 |
| HE-02 | **弹性（超时/重试）** | 广告报表、账户健康、库存同步等低稳定性接口必须可重试、可跳过、可降级，不阻断整轮 Agent |
| HE-03 | **类型化错误** | `harness_error` 不能只覆盖广告写操作，也要覆盖账户健康、退款、库存在途等读写路径 |
| HE-04 | **多平台一致接口** | 一致不等于一刀切；统一入口 + 平台特化子接口，优先表达真实业务语义 |
| HE-05 | **凭证安全管理** | 广告、账号健康、消息/售后等不同能力的凭证和权限边界必须分开管理 |
| HE-06 | **向后兼容** | 新增利润/库存/健康相关能力时，旧 Agent 仍可继续运行；新字段优先 optional |

### 设计原则

| # | 原则 | 说明 |
|---|------|------|
| P1 | **LLM 决策，规则安全网** | Agent 用 LLM 理解上下文做决策；Constitution §5.2/§5.4 的门控作为不可绕过的安全网 |
| P2 | **Harness 按平台特化** | 广告能力不统一抽象；按平台广告模型（搜索词/受众/素材）建立专属接口 |
| P3 | **SOP 是卖家的 Constitution** | 卖家用自然语言定义经营策略，系统解析为 Agent 可消费的上下文 |
| P4 | **感知→推理→治理→执行→记忆** | 每个 Agent 遵循统一的五阶段决策管线 |
| P5 | **卖家视角的 UI** | 前端展示业务成果和决策，不是基础设施指标 |
| P6 | **利润优先于虚荣指标** | GMV、ROAS、订单量都必须让位于利润、贡献毛利、TACoS、现金效率 |
| P7 | **库存 = 供应链 + 现金流，不只是现货数量** | 补货建议必须理解交期、在途、MOQ、箱规、采购金额和断货风险 |
| P8 | **广告策略服务于 SKU 生命周期** | Launch / Scale / Defend / Clearance 目标必须进入 Agent 决策和 SOP 结构化字段 |
| P9 | **审批必须可理解、可约束、可回滚** | 每个高风险建议都要回答“为什么、影响什么、不批会怎样、出错如何撤回” |
| P10 | **SOP 必须动态生效** | 平台、店铺、类目、实体、时间窗口都应能覆盖，不把一份 SOP 强行用于全部场景 |
| P11 | **验收以经营结果为准** | 计划验收不仅看接口/页面/Agent 能否运行，还要看断货率、利润率、采纳率、回滚率是否改善 |

### 专业卖家补漏项的原则映射

| 补漏项 | Constitution 对齐 | Agent Native 对齐 | Harness Engineering 对齐 | 计划调整方向 |
|--------|-------------------|------------------|-------------------------|--------------|
| 利润与单位经济模型 | Ch1.1 / Ch8.1 | AN-02 / AN-03 / AN-06 | HE-04 / HE-06 | Dashboard、Price、Ads 都要消费利润字段 |
| 补货 = 库存 + 交期 + 在途 + 现金流 | Ch1.1 / Ch5.4 / Ch6.2 | AN-02 / AN-04 / AN-05 | HE-01 / HE-02 / HE-03 | Inventory Guard 升级为采购决策助手 |
| 广告与 SKU 生命周期联动 | Ch1.1 / Ch2.3 / Ch5.4 | AN-01 / AN-02 / AN-04 | HE-01 / HE-04 | Ads Optimizer 读取生命周期目标和库存约束 |
| SOP 动态作用域/生效时间 | Ch2.2 / Ch6.2 | AN-01 / AN-05 | HE-06 | `tenant_sops` 支持 platform/entity/effective window |
| 审批上下文与回滚 | Ch5.3 / Ch5.4 | AN-03 / AN-05 | HE-03 | 审批 payload 增加 impact / rollback / expiry |
| 售后与账户健康工作台 | Ch1.1 / Ch8.1 | AN-02 / AN-03 | HE-01 / HE-04 / HE-05 | 新增 `/service`、`/account-health` 能力 |
| 结果型验收指标 | Ch8.1 | AN-03 / AN-04 / AN-06 | HE-02 | 验收增加利润、断货率、采纳率、回滚率 |

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                    租户前端 (apps/web)                        │
│                                                              │
│  /dashboard    /approvals   /agents/[id]   /products  ...    │
│  经营总览       审批中心      SOP + 配置     商品/订单/广告/库存 │
└────────────────────────┬─────────────────────────────────────┘
                         │ API
┌────────────────────────┴─────────────────────────────────────┐
│                    API 层 (apps/api)                          │
│                                                              │
│  SOP API   Approvals   Agents   Products/Orders   Ads   ...  │
└────────────┬──────────────────────────┬──────────────────────┘
             │                          │
┌────────────┴──────────┐  ┌────────────┴──────────────────────┐
│  SOP Parser Service   │  │  Agent Runtime (packages/agent-   │
│  (packages/sop)       │  │  runtime)                         │
│                       │  │                                   │
│  LLM 提取:            │  │  五阶段决策管线:                    │
│  SOP → goalContext    │  │  感知 → 推理(LLM) → 治理(规则)     │
│  SOP → systemPrompt  │  │  → 执行(Harness) → 记忆(DataOS)   │
│  SOP → governance    │  │                                   │
└───────────────────────┘  └──────────────┬────────────────────┘
                                          │
                           ┌──────────────┴────────────────────┐
                           │  Harness 层 (packages/harness)     │
                           │                                   │
                           │  TenantHarness (基础：商品/订单/库存)│
                           │  AdsCapableHarness (基础广告共性)    │
                           │  ├── AmazonAdsHarness (关键词/搜索词)│
                           │  ├── TikTokAdsHarness (受众/素材)   │
                           │  ├── ShopeeAdsHarness (搜索/推荐)   │
                           │  └── WalmartAdsHarness (关键词/出价) │
                           └───────────────────────────────────┘
```

---

## 3. 工作流分解

### Stream A · 租户前端（UI）

**目标：** 卖家打开系统就能经营，不需要理解 Agent 基础设施

#### A1 · 侧栏导航 + 布局骨架

```
apps/web/src/
├── app/
│   ├── layout.tsx            ← 改造：加侧栏导航
│   ├── dashboard/page.tsx    ← 重写
│   ├── approvals/page.tsx    ← 新建
│   ├── agents/
│   │   ├── page.tsx          ← 新建
│   │   └── [id]/page.tsx     ← 新建
│   ├── products/page.tsx     ← 新建
│   ├── orders/page.tsx       ← 新建
│   ├── ads/page.tsx          ← 新建
│   ├── inventory/page.tsx    ← 新建
│   ├── platforms/page.tsx    ← 新建
│   └── settings/
│       ├── page.tsx          ← 保留（账户）
│       ├── governance/page.tsx ← 新建
│       └── billing/page.tsx  ← 新建
├── components/
│   ├── Sidebar.tsx           ← 新建
│   ├── ApprovalCard.tsx      ← 新建
│   ├── AgentCard.tsx         ← 新建
│   ├── SopEditor.tsx         ← 新建
│   └── ...existing...
```

**估时：** 1d

#### A2 · Dashboard 经营总览

消费已有 API，展示：
- 待审批汇总（`GET /api/v1/approvals?status=pending`，按 action 分组）
- Agent 动态摘要（`GET /api/v1/agent-events?limit=20`）
- 商品/订单/用量指标（products, orders, billing/usage）
- 平台连接状态（platform-credentials）
- 库存预警（inventory/alerts）

**估时：** 2d

#### A2.5 · 利润驾驶舱

为对齐 `P6 利润优先于虚荣指标`，Dashboard 追加经营结果层：
- 销售额拆分：`grossRevenue` / `netRevenue`
- 利润层：`contributionMargin` / `profitAfterAds`
- 广告层：`acos` / `tacos`
- 损耗层：`refundRate` / `feeRate`
- 现金效率层：`inventoryDays` / `cashTiedInInventory`

**后端补充：**
- `GET /api/v1/dashboard/overview` 增加利润与费用字段
- `GET /api/v1/finance/unit-economics` 新建聚合接口

**估时：** 2d

#### A3 · 审批中心

**Constitution §5.4 的产品化界面：**
- 审批列表：action 类型 + Agent 名 + 具体内容 + 创建时间
- 一键批准/拒绝（`PATCH /api/v1/approvals/:id/resolve`）
- 筛选：状态 / Agent / action 类型
- 批量操作

**后端补充：**
- `GET /api/v1/approvals` 增加 `action` query 参数
- 审批 `payload` 增加 `displayTitle` / `displayDescription`（B1/B2）
- 审批 `payload` 增加 `impactPreview` / `expireAt` / `rollbackPlan` / `similarPastDecisions`
- 支持“批准并限额执行”“批准并观察 7 天”“超时自动失效”

**估时：** 3d（含后端）

#### A4 · Agent 团队 + 详情/SOP

- `/agents`：9 个 Agent 卡片（名称、角色、状态、最近执行、待审批数）
- `/agents/[id]`：三个 Tab
  - **SOP**：SOP 编辑器 + 解析预览 + 参数微调（依赖 Stream C）
  - **工作记录**：Agent 事件时间线
  - **高级参数**：原始 goalContext/systemPrompt 编辑（开发者模式）

**估时：** 2d

#### A5 · 业务页面（商品/订单/广告/库存/平台）

全部消费已有 API：

| 页面 | 数据源 | 估时 |
|------|--------|------|
| `/products` | `GET /api/v1/products` + `POST /api/v1/products/sync` | 1d |
| `/orders` | `GET /api/v1/orders` + `/orders/platform` | 1d |
| `/ads` | `GET /api/v1/ads/campaigns` + `/ads/performance` + `GET /api/v1/ads/sku-view` | 1.5d |
| `/inventory` | `GET /api/v1/inventory` + `/inventory/alerts` + `/inventory/inbound` + `/inventory/replenishment` | 1d |
| `/platforms` | `GET /api/v1/platform-credentials` + OAuth 路由 | 1d |
| `/service` | `GET /api/v1/support/threads` + `/refunds` + `/returns` | 1d |
| `/account-health` | `GET /api/v1/account-health` + `/listing-issues` + `/buybox` | 1d |

**说明：**
- `/ads` 默认优先展示 `SKU / ASIN` 经营视图，再下钻到 campaign / keyword
- `/inventory` 同时展示可售、在途、采购中、预计断货日、建议补货金额
- `/service` 将 Support Relay 的决策与人工接管统一到经营工作台
- `/account-health` 聚合平台健康、违规、Listing suppressed、Buy Box 丢失等信号

**估时：** 6.5d

#### A6 · 设置增强

- `/settings/governance`：治理偏好面板（`GET/PUT /api/v1/settings/governance`）
- `/settings/billing`：用量 + Stripe 门户（`GET /api/v1/billing/usage` + portal-session）

**估时：** 1d

#### A7 · 经营目标中心

新增“经营目标”配置页，供卖家按平台/店铺/品牌/类目配置：
- 增长目标：`growth` / `profit` / `clearance` / `launch`
- 利润护栏：`minMarginPercent` / `minContributionProfitUsd`
- 库存策略：`avoidStockout` / `reduceAgedInventory` / `cashPreservation`
- 广告生命周期策略：`launch` / `scale` / `defend` / `clearance`

**估时：** 1.5d

#### A8 · 前端路由分组与角色分流（Phase 6 缺口 3）

对齐 Phase 6 Compatibility 缺口 3：
- 将 `apps/web/src/app/` 下现有页面迁入 `(tenant)/` route group
- 创建 `(ops)/` route group 占位（内容为 Phase 6 实现）
- `middleware.ts` 按用户角色分流：`seller → (tenant)`，`admin → (ops)`
- `(ops)/` 内放置 Phase 6 占位页，seller 角色不可访问

**估时：** 1d

**Stream A 总计：20d**
（A1:1 + A2:2 + A2.5:2 + A3:3 + A4:2 + A5:6.5 + A6:1 + A7:1.5 + A8:1 = 20d）

---

### Stream B · Agent Native 改造

**目标：** 把 if-else 脚本变成真正的 AI Agent，对齐 Constitution Ch5.1 和 Ch3.2

#### B0 · 统一决策管线抽象

```typescript
// packages/agent-runtime/src/decision-pipeline.ts

interface DecisionPipeline<TInput, TDecision> {
  /** Phase 1 - 感知：聚合平台数据 + DataOS 特征 + 历史记忆 + SOP */
  gather(ctx: AgentContext): Promise<DecisionContext>

  /** Phase 2 - 推理：LLM 分析，生成决策建议（含理由） */
  reason(ctx: AgentContext, context: DecisionContext): Promise<TDecision[]>

  /** Phase 3 - 治理：Constitution §5.2/§5.4 规则校验（安全网） */
  govern(ctx: AgentContext, decisions: TDecision[]): Promise<GovernedDecision<TDecision>[]>

  /** Phase 4 - 执行：通过 Harness 写入平台（或 requestApproval） */
  execute(ctx: AgentContext, governed: GovernedDecision<TDecision>[]): Promise<void>

  /** Phase 5 - 记忆：写入 DataOS Decision Memory + 安排 outcome 追踪 */
  remember(ctx: AgentContext, decisions: TDecision[], results: unknown): Promise<void>
}

interface DecisionContext {
  platformData: unknown
  features: Map<string, DataOsFeatureSnapshot>
  memories: unknown[]          // recallMemory 结果
  recentEvents: RecentAgentEvent[]
  sop: { text: string; systemPrompt: string | null } | null
  pendingApprovals: PendingApprovalItem[]  // Ch5.1 第 3 步
  economics?: UnitEconomicsSnapshot | null
  lifecycle?: ProductLifecycleSnapshot | null
  accountHealth?: AccountHealthSnapshot | null
}
```

**Constitution §5.1 Pre-flight 对齐：**
1. ✅ 读取 goal_context → `gather()` 中读取 SOP + goalContext
2. ✅ 检查 budget → 已有 `ctx.budget.isExceeded()`
3. ✅ 检查 pending approval → `gather()` 中调用 `ctx.listPendingApprovals()`
4. ✅ 读取 Constitution → `govern()` 中硬编码 Constitution §5.2/§5.4 规则

**估时：** 1d

#### B0.5 · 自主降级与经营预算护栏

对齐 `AN-04` 与 `AN-06`：
- 利润数据缺失：禁止自动调价 / 自动加预算，只允许发建议
- 账户健康异常：收缩高风险动作（如 aggressive bidding / 上新）
- 现金流紧张：Inventory Guard 只输出优先级排序，不自动生成大额采购建议
- 预算维度拆分：`llmBudget` / `adsBudget` / `inventoryCashBudget` / `marginLossBudget`

**估时：** 1d

#### B1 · Price Sentinel → 智能定价顾问

| 阶段 | 当前 | 改造后 |
|------|------|--------|
| 感知 | 接收外部 proposals | 自主拉商品价格 + DataOS 特征(转化率/竞品价/销量) + 单位经济模型 + 回忆历史决策 |
| 推理 | `\|delta%\| > threshold` | LLM (claude-haiku-4-5) 综合分析生成调价建议 + 理由 + 预估利润影响 |
| 治理 | 同上 | `\|delta%\| > 阈值` 仍作为安全网（Constitution §5.2: >15% 必须审批）+ `minMarginPercent` / `minContributionProfitUsd` 硬护栏 |
| 执行 | `updatePrice` / `requestApproval` | 同上，但审批 payload 含 LLM 生成的业务理由 |
| 记忆 | 仅 recordMemory | + 7 天后 writeOutcome 追踪调价效果 |

**模型对齐 Ch3.2：** `claude-haiku-4-5`（定价 Agent 高频，成本约 1/15）
**批量策略：** 一次 LLM 调用分析全部商品（~2K token input / ~1K output ≈ $0.001/次）

**新增产出：**
- 每条建议包含 `expectedMarginDelta` / `expectedProfitDelta`
- 当缺失成本或费用数据时，自动降级为“建议待批”而非自动执行

**估时：** 3d

#### B2 · Ads Optimizer → 智能广告策略师

| 阶段 | 当前 | 改造后 |
|------|------|--------|
| 感知 | `getAdsCampaigns` 仅 7 个字段 | 广告数据 + 关联商品特征 + 单位经济模型 + 生命周期目标 + 历史调整记录（依赖 Stream D 扩展 Harness 后数据更丰富） |
| 推理 | `if roas < target: budget *= 1.1` | LLM (claude-haiku-4-5) 分析，支持加/减/暂停/维持，并解释 `launch / scale / defend / clearance` 目标 |
| 治理 | `proposed > $500` | Constitution §5.2: 日预算变动 >30% 需审批 + 绝对值 >$500 需审批 |
| 执行 | 仅 `updateAdsBudget` | 根据 Stream D 进展扩展（关键词出价/否定词/暂停等），并受库存与账户健康约束 |
| 记忆 | 无 | recordMemory + 3 天后 writeOutcome |

**注意：** Ads Optimizer 的能力上限取决于 Stream D（Harness 广告扩展）的进度。
- Stream D 未完成时：LLM 分析但操作仍限于预算调整
- Stream D Phase A 完成后：可操作 Amazon SP 关键词

**新增产出：**
- 每条建议包含 `lifecycleObjective`、`inventoryConstraint`、`expectedTacosDelta`
- 低库存 / 低利润 / 账号风险异常时自动收缩到“只建议”

**估时：** 3d

#### B3 · Inventory Guard → 智能库存管家

| 阶段 | 当前 | 改造后 |
|------|------|--------|
| 感知 | `getInventoryLevels` | + 销售速度(订单事件) + 在途库存 + 供应商交期 + MOQ + 落地成本 + 回忆上次补货效果 |
| 推理 | `if qty < safety: alert` | LLM (claude-haiku-4-5) 计算断货预测 + 智能补货量 + 采购优先级 |
| 治理 | `restock ≥ 50 → approval` | 保持，加上总补货金额、现金流压力、加急运输切换校验 |
| 执行 | Ticket + requestApproval | 同上，审批含 LLM 理由（"日销12件，0.7天断货"）+ 采购金额/交期/在途信息 |
| 记忆 | 无 | recordMemory + 到货后 writeOutcome |

**新增产出：**
- 生成 `expectedStockoutDate`、`suggestedPoQty`、`cashRequired`
- 将 Agent 从“库存预警器”升级为“补货决策助手”

**估时：** 3d

#### ~~B4 · Product Scout~~ → **Phase 6 延期**

> **审查决议：** Product Scout 改造使用 Sonnet 模型（成本高于 Haiku Agent）、依赖 Market Intel 数据管线（当前未排期），且其核心动作"上架商品"必须人工确认（§5.4），自动化收益在 Phase 5B 阶段有限。移入 Phase 6 延期表，Phase 5B 聚焦 Price/Ads/Inventory 三个高频经营 Agent。
>
> Product Scout 在 Phase 5B 期间仍以 **现有规则引擎** 运行，仅接入 Global SOP 的 `systemPrompt`。

#### B5 · 审批 payload 升级

所有 Agent 的 `requestApproval` 输出格式统一升级：

```typescript
{
  action: 'price.update',
  payload: {
    // 结构化数据（现有）
    productId, currentPrice, proposedPrice, deltaPercent,
    // 新增：人类可读
    displayTitle: '高端保湿精华 30ml — 建议降价 8%',
    displayDescription: '3 个竞品近 7 天降价 10-15%，转化率从 5.2% 降至 3.1%...',
    confidence: 0.75,
    riskLevel: 'medium',
  },
  reason: 'LLM 生成的完整业务分析...',
}
```

**新增字段：**
- `impactPreview`
- `rollbackPlan`
- `expireAt`
- `expectedOutcomeWindow`
- `similarPastDecisions`

**估时：** 1.5d

#### B6 · 结果回写与经营成效评估

对齐 `AN-03` / `AN-05` / `P11`：
- Price：7 天/14 天后回写毛利变化、转化率变化
- Ads：7 天后回写 TACoS、贡献利润、无效花费变化
- Inventory：回写断货是否避免、资金占用是否超预算
- 审批：回写采纳率、驳回率、回滚率、后悔率

**估时：** 1.5d

#### B7 · 审批模式渐进与自治成熟度（Phase 6 缺口 2）

对齐 Phase 6 Compatibility 缺口 2：
- 审批系统支持 `approval_required` / `approval_informed` 模式切换
- 审批 payload 增加 `autoApprovable` + `autoApproveReason` 字段
- Agent 在安全网范围内 + confidence > 阈值时标记 `autoApprovable: true`
- Dashboard 暴露自治成熟度指标：`approvalRequiredRate` / `approvalAdoptionRate` / `rollbackRate`

**估时：** 1.5d

#### B8 · 事件 payload Phase 6 兼容字段（Phase 6 缺口 4）

对齐 Phase 6 Compatibility 缺口 4 + SOP 场景化对齐修正（G2/G3）：
- `agent.decision.made` payload 增加 `confidence` + `metrics.gmvImpact` + `metrics.marginImpact` + `scenarioId?`（G3 修正）
- `harness.api.error` payload 增加 `harnessErrorRate`
- Prometheus 标准指标暴露：`harness_api_error_rate` / `agent_decision_quality_score` / `tenant_gmv_daily` / `agent_budget_utilization` + `sop_scenario_active_count` / `sop_scenario_expired_total` / `sop_scenario_template_usage`（G2 修正）
- 文档化所有事件字段与 Phase 6 `MonitorReport` / `BreakerMetric` 的映射关系

**估时：** 1.5d

**Stream B 总计：17.5d**
（B0:1 + B0.5:1 + B1:3 + B2:3 + B3:3 + B5:1.5 + B6:1.5 + B7:1.5 + B8:1.5 = 17.5d；B4 移入 Phase 6）

---

### Stream C · SOP 解析引擎

**目标：** 卖家用自然语言定义经营策略，系统转换为 Agent 可消费的上下文（对齐 Constitution Ch6.2 + Ch1.1）

#### C1 · 数据模型

```sql
-- packages/db/src/schema/sops.ts
CREATE TABLE tenant_sops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  scope           TEXT NOT NULL,   -- 'global' | 'price-sentinel' | 'ads-optimizer' | ...
  platform        TEXT,            -- amazon / shopify / tiktok / ...
  entity_type     TEXT,            -- store / brand / category / sku / asin
  entity_id       TEXT,
  sop_text        TEXT NOT NULL,
  extracted_goal_context   JSONB,
  extracted_system_prompt  TEXT,
  extracted_governance     JSONB,
  extraction_warnings      JSONB,  -- LLM 无法映射的内容
  status          TEXT NOT NULL DEFAULT 'active', -- draft / active / archived
  effective_from  TIMESTAMPTZ,
  effective_to    TIMESTAMPTZ,
  previous_version_id UUID,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, scope, platform, entity_type, entity_id, version)
);
```

**估时：** 1d

#### C1.5 · SOP 作用域与版本规则

为对齐 `P10 SOP 必须动态生效`：
- 解析优先级：`entity > platform > scope > global`
- 支持按旺季/大促/清仓设置 `effective_from / effective_to`
- 高风险 SOP 变更（价格底线、广告预算上限、自动上新）进入“策略变更确认”
- 支持回滚到上一生效版本

**估时：** 1d

#### C2 · SOP Parser Service

`packages/sop/src/` — LLM 驱动的 SOP 解析：

- 按 Agent 类型定义 extraction schema（可提取的参数 + 类型 + 范围）
- LLM Prompt 模板：提取结构化参数 + 行为指导 + 治理设置 + 无法映射的 warnings
- 输出三层：`goalContext` (JSON) + `systemPrompt` (text) + `governance` (partial)

**每 Agent 的 SOP 可映射能力矩阵（决定 schema）：**

| Agent | goalContext 可提取 | systemPrompt 有用 | governance 可提取 |
|-------|-------------------|-------------------|-------------------|
| Price Sentinel | approvalThresholdPercent, pricingStrategy, minMarginPercent, minContributionProfitUsd | 改造后有 LLM → 有用 | priceChangeThreshold |
| Ads Optimizer | targetRoas, budgetApprovalThresholdUsd, lifecycleObjective, tacosTarget | 改造后有 LLM → 有用 | adsBudgetApproval |
| Inventory Guard | safetyThreshold, replenishApprovalMinUnits, leadTimeDays, cashPreservationMode | 改造后有 LLM → 有用 | — |
| Support Relay | autoReplyPolicy | 已有 toneSystemPrompt → 有用 | — |
| Content Writer | tone, maxLength | LLM 生成内容 → 非常有用 | newListingApproval |
| Market Intel | platforms, maxProducts | LLM 分析 → 有用 | — |
| Product Scout | maxProducts | 改造后有 LLM → 有用 | newListingApproval |
| CEO Agent | — | LLM 协调 → 有用 | — |
| Finance Agent | — | LLM 分析 → 有用 | — |

**估时：** 2.5d

#### C3 · SOP API

```
POST /api/v1/sop/parse              — 解析预览（不写入）
PUT  /api/v1/sop/{scope}            — 保存 + 应用（scope 含 'global'，见 §4.5.4 资源模型统一）
GET  /api/v1/sop                    — 获取租户所有 SOP
POST /api/v1/sop/{scope}/activate   — 启用指定版本
POST /api/v1/sop/{scope}/rollback   — 回滚到上一版本
```

**估时：** 1.5d

#### C4 · Agent Runtime 消费 SOP + Prompt 优先级栈（Phase 6 缺口 1）

- Agent `gather()` 阶段读取 `tenant_sops` 中对应 scope 的 `extracted_system_prompt`
- 注入到 `ctx.llm({ systemPrompt })` 调用中
- Global SOP 的 systemPrompt 作为所有 LLM Agent 的前缀
- 读取顺序遵循 `entity > platform > scope > global`
- **Phase 6 兼容**：实现 `buildSystemPrompt()` L0-L4 分层，L0 为 System Constitution（不可覆盖），L1 预留给 Autonomy Constitution，L2 为平台策略，L3 为租户 SOP
- SOP Parser 拒绝提取与 Constitution §5.2/§5.4 直接冲突的内容

**估时：** 2d（从 1.5d 上调）

#### C5 · 治理设置接线

当前 `tenant_governance_settings` 中三个字段未接线到 Agent Runtime：

| 字段 | 当前 | 修复 |
|------|------|------|
| `adsBudgetApproval` | 存了但 Ads Optimizer 用 `APPROVAL_BUDGET_THRESHOLD_USD` 常量 | 从 goalContext 读取 |
| `newListingApproval` | 存了但 Product Scout 不检查 | Agent 执行时检查 |
| `humanInLoopAgents` | 存了但无 Agent 消费 | Agent pre-flight 检查 |

**估时：** 1d

#### C6 · 经营目标结构化解析

新增统一 schema，确保卖家“经营意图”不只停留在自由文本：
- `profit-first`
- `launch`
- `scale`
- `defend`
- `clearance`
- `cash-preservation`

该 schema 同时回写到 Price / Ads / Inventory 三个 Agent 的 `goalContext`。

**估时：** 1d

#### C7 · SOP 结构化场景系统 — 数据模型

**设计思想：** 卖家不应面对"给哪个 Agent 写指令"这种系统内部概念。卖家的心智模型是 **"我要给这个东西，在这个平台上，定一个什么样的经营打法"**。SOP 的"类型"不是单一字段，而是 4 层结构化选择 + 1 层自由命名：

```
卖家看到的                           系统消费的
┌──────────────────────────┐        ┌─────────────────────────────────┐
│ ① 经营场景（枚举选择）    │        │ tenant_sops × N 条记录           │
│   launch / scale / defend │        │ (scope=price-sentinel, ...)     │
│   clearance / promotion   │───────▶│ (scope=ads-optimizer, ...)      │
│   daily                   │ 展开   │ (scope=inventory-guard, ...)    │
│ ② 适用平台 ③ 适用对象    │        │                                 │
│ ④ 生效时间 ⑤ 场景名称    │        │ 每条记录独立被对应 Agent 消费     │
└──────────────────────────┘        └─────────────────────────────────┘
```

**经营场景枚举（`scenario`）：**

| 枚举值 | 卖家看到的名称 | 含义 | 典型使用时机 |
|--------|-------------|------|------------|
| `launch` | 新品上架 | 牺牲短期利润换取曝光和排名 | 新品前 30-60 天 |
| `scale` | 放量增长 | 加大投入抢市场份额 | 产品验证后进入增长期 |
| `defend` | 利润防守 | 守住利润底线，精细化运营 | 稳定期 / 竞争激烈时 |
| `clearance` | 清仓处理 | 快速消化库存，接受亏损 | 滞销品 / 季节尾货 / 退出品 |
| `promotion` | 大促活动 | 短期激进，活动后恢复 | Prime Day / Black Friday / 双十一 |
| `daily` | 日常运营 | 平衡增长与利润 | 默认状态 |

> **不允许卖家自定义枚举值。** Parser 和模板系统依赖预定义枚举，自由文本"Q4大促"无法被系统理解。卖家通过 `scenario_name`（自由文本，纯展示）表达个性化命名。

**新增 `tenant_sop_scenarios` 表：**

```sql
CREATE TABLE tenant_sop_scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  scenario_name   TEXT,                    -- 卖家自定义名称（纯展示）
  scenario        TEXT NOT NULL,           -- 枚举：launch / scale / defend / clearance / promotion / daily
  platform        TEXT,                    -- amazon / walmart / ... / null=全平台
  entity_type     TEXT,                    -- store / brand / category / sku / asin / null=不限
  entity_id       TEXT,
  effective_from  TIMESTAMPTZ,
  effective_to    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'active',  -- draft / active / archived
  version         INTEGER NOT NULL DEFAULT 1,
  previous_version_id UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, scenario, platform, entity_type, entity_id, version)
);

ALTER TABLE tenant_sop_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sop_scenarios
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**`tenant_sops` 增加场景外键：**

```sql
ALTER TABLE tenant_sops
  ADD COLUMN scenario_id UUID REFERENCES tenant_sop_scenarios(id),
  ADD COLUMN scenario    TEXT;  -- 冗余字段，方便查询
```

**新增 `sop_scenario_templates` 表（系统预置，G6 修正：含 `platform` 列）：**

```sql
CREATE TABLE sop_scenario_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario               TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  platform               TEXT,          -- null=通用, amazon/walmart/tiktok/shopify
  default_sop_text       TEXT NOT NULL,
  default_goal_context   JSONB NOT NULL,
  editable_fields        JSONB NOT NULL,  -- ["minMarginPercent", "approvalThresholdPercent"]
  locked_fields          JSONB NOT NULL,  -- ["lifecycleObjective"]
  UNIQUE(scenario, scope, platform)
);
```

> **G6 修正（HE-04 多平台一致接口）：** 模板按 `platform` 分化。查找逻辑：先精确匹配 `scenario + scope + platform`，fallback 到 `scenario + scope + platform=null`（通用模板）。

**关系：** 一个 `tenant_sop_scenarios` 展开为多条 `tenant_sops`（每个 in-scope Agent 一条）。

**估时：** 1.5d（C1 原 1d + 0.5d 场景表/模板表）

#### C8 · 场景模板引擎与展开逻辑

**模板矩阵（Phase 5B 覆盖 4 场景 × 3 Agent = 12 套优先模板）：**

| scenario \ scope | price-sentinel | ads-optimizer | inventory-guard |
|-----------------|----------------|---------------|-----------------|
| `launch` | 激进跟价：minMargin=5%, 单次 ≤10% | 高预算宽匹配：multiplier=2.5x | 小批量快补：safetyDays=30 |
| `defend` | 守利润底线：minMargin=15%, 不主动降 | 精准投放控浪费 | 正常补货节奏 |
| `clearance` | 低于成本可卖 | 停广告 / 仅品牌词 | 不补货消库存 |
| `daily` | 平衡增长与利润 | 稳定 ROAS | 常规安全库存 |

> `scale` / `promotion` 模板 Phase 5B 按 `daily` fallback，Phase 6 补齐。

**模板示例（`launch × price-sentinel`）：**

```typescript
{
  scenario: 'launch',
  scope: 'price-sentinel',
  platform: null,  // 通用
  default_sop_text:
    '新品上架期间，允许定价低于竞品 5-10%，最低利润率可放宽到 5%。\n'
  + '当转化率连续 3 天 > 8% 时，可逐步回调到正常利润水平。\n'
  + '调价幅度单次不超过 10%。',
  default_goal_context: {
    pricingStrategy: 'aggressive-match',
    minMarginPercent: 5,
    approvalThresholdPercent: 10,
    competitorMatchPolicy: 'undercut-5pct',
  },
  editable_fields: ['minMarginPercent', 'approvalThresholdPercent', 'competitorMatchPolicy'],
  locked_fields: ['pricingStrategy'],
}
```

**展开流程：**

```
卖家操作：
  选择 scenario=launch, platform=amazon, entity_type=sku, entity_id=SKU-12345
  修改各 Agent 策略文本 + 参数 → 点击"保存"

系统处理：
  1. 创建 tenant_sop_scenarios 记录
  2. 读取 sop_scenario_templates WHERE scenario='launch' AND (platform='amazon' OR platform IS NULL)
  3. 对每个 scope (price-sentinel, ads-optimizer, inventory-guard)：
     a. 用模板默认值 + 卖家修改值合并
     b. locked_fields 被卖家修改 → 忽略卖家值，保留模板值
     c. 调用 SOP Parser 提取 goalContext + systemPrompt + governance
     d. 写入 tenant_sops 记录（scenario_id 指向父记录）
  4. 返回解析预览（含 warnings）
  5. 发射 sop.scenario.created 事件
```

**完整优先级覆盖规则：**

```
规则 1 · 窄作用域 > 宽作用域
   entity > platform > global（SKU 级 SOP > Amazon 级 SOP > 全平台 SOP）

规则 2 · 有时间窗 > 无时间窗
   生效中的限时 SOP > 无限期 SOP（大促 SOP > 日常 SOP）

规则 3 · 同层同时间窗 → 最新版本

规则 4 · 窄层 goal 完全覆盖宽层 goal（不合并）
   SKU 的 launch goalContext 生效时，global 的 defend goalContext 不参与合并
   systemPrompt 仍叠加（global 通用语气注入），goalContext 不叠加

规则 5 · SOP 过期回落
   effective_to 到期 → status 自动改为 archived → 回落到下一优先级
```

**Agent Runtime 消费（SOP 解析不受场景层影响）：**

```typescript
function resolveSop(agentScope: string, ctx: AgentContext): Promise<ResolvedSop | null> {
  const candidates = await db.query(`
    SELECT * FROM tenant_sops
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      AND (effective_from IS NULL OR effective_from <= now())
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY
      CASE WHEN entity_id IS NOT NULL THEN 1
           WHEN platform IS NOT NULL THEN 2
           ELSE 3 END,
      CASE WHEN effective_from IS NOT NULL THEN 1 ELSE 2 END,
      version DESC
    LIMIT 1
  `, [ctx.tenantId, agentScope])
  return candidates[0] ?? null
}
```

**SOP 过期与生命周期管理：**

| 事件 | 系统行为 | 卖家感知 |
|------|---------|---------|
| SOP `effective_to` 到期 | 自动 `archived`；Agent 回落到上层 SOP；发射 `sop.scenario.archived(reason=expired)` | Dashboard 提示 |
| SKU 应切换生命周期 | **不自动切换**（Ch1.1 人做战略决策）；Dashboard 提示建议 | 卖家确认后切换 |
| 场景内所有 SOP 同时过期 | `tenant_sop_scenarios` 也自动 `archived` | 场景卡片变灰 |
| 卖家手动归档场景 | 该场景下所有 `tenant_sops` 同步归档 | — |

**估时：** 包含在 C2 SOP Parser（Parser 本身不变，只是被调用 N 次）+ 1d 模板内容编写

#### C9 · 场景级 API 与前端入口

**场景级 API（卖家主入口）：**

```
POST /api/v1/sop/scenarios                  — 创建场景（自动展开为多条 SOP）
GET  /api/v1/sop/scenarios                  — 获取租户所有场景
GET  /api/v1/sop/scenarios/:id              — 获取场景详情（含展开的各 Agent SOP）
PUT  /api/v1/sop/scenarios/:id              — 更新场景（自动更新展开的 SOP）
POST /api/v1/sop/scenarios/:id/activate     — 启用
POST /api/v1/sop/scenarios/:id/archive      — 归档
POST /api/v1/sop/scenarios/:id/duplicate    — 复制为新场景
```

**模板 API：**

```
GET  /api/v1/sop/templates                  — 获取所有场景模板
GET  /api/v1/sop/templates/:scenario        — 获取特定场景的模板集（含平台分化）
```

> **G7 修正（Ch2.2 API First）：** 场景级 API 必须有 OpenAPI Schema，在 Sprint 19 D1 输出。

**前端入口：**

```
/settings/sop                    ← 场景管理视图（推荐入口）
/agents/[id] → SOP Tab           ← 单 Agent 视角（高级用户）
```

**前端创建流程（4 步向导）：**
1. **选择场景** — 6 张卡片选择经营打法
2. **选择范围** — 平台 + 对象类型 + 生效时间 + 场景名称
3. **配置策略** — 基于模板预填，展示各 Agent 的策略文本和可编辑参数；`locked_fields` 灰显不可改
4. **解析预览** — 展示每个 Agent 的 goalContext / governance 提取结果和 warnings → 确认保存

**场景管理视图** 展示所有活跃/即将过期/已归档场景的卡片列表，支持编辑、归档、复制为新场景。

**估时：** 2.5d（C3 原 1.5d + 1d 场景 API + 前端向导）

#### C10 · 场景化错误类型与预算决策

**G5 修正（HE-03 类型化错误）：** 在 `AgentError` 联合类型中增加场景错误子类型：

```typescript
type AgentError =
  | { type: 'budget_exceeded'; agentId: string }
  | { type: 'approval_required'; reason: string; payload: unknown }
  | { type: 'harness_error'; platform: string; code: string }
  | { type: 'rate_limited'; retryAfter: number }
  | { type: 'sop_scenario_error';
      code: 'template_not_found' | 'locked_field_violation'
            | 'parser_extraction_failed' | 'version_conflict';
      scenarioId: string;
      detail: string }
```

**G4 决策（AN-06 预算自管理）：** 不在场景层增加预算上限。理由：
- Constitution §5.2 硬限制已在 `govern()` 阶段强制执行
- B0.5 的 `adsBudget` / `marginLossBudget` 护栏在 Agent 维度兜底
- 场景层加预算会引入"场景预算 vs Agent 预算 vs 租户预算"三层冲突，复杂度收益不对等

**估时：** 含在 C8 实现中

#### 场景化不做的事情（明确边界）

| 不做 | 原因 |
|------|------|
| 不允许自定义 `scenario` 枚举值 | Parser 和模板系统依赖预定义枚举 |
| 不自动切换 SKU 生命周期阶段 | Ch1.1 "人类做战略决策"；只提供建议 |
| 不做跨场景 goalContext 合并 | 窄层完全覆盖宽层，避免冲突 |
| 不在 Phase 5B 做 `support-relay` / `content-writer` 场景模板 | 这两个 Agent 不在 Phase 5B 完整改造范围内 |
| 不做 SOP 效果 A/B 测试 | 复杂度高，Phase 6+ |

**Stream C 总计：13.5d**
（C1→C7:1.5 + C1.5:1 + C2:2.5 + C3→C9:2.5 + C4:2 + C5:1 + C6:1 + C8 模板:1 + C10:含在 C8 内 = 13.5d，较原 10d 增加 3.5d）

---

### Stream D · Harness 广告扩展

**目标：** 按平台广告模型建立专属 Harness 接口（对齐 Constitution Ch2.3 Harness 抽象原则）

#### D0 · 卖家经营 Port / Harness 补齐

为对齐 `HE-01 平台操作完全封装`，Phase 5B 不只扩广告，还要补齐以下经营能力入口：
- `UnitEconomicsPort`：利润、费用、退款、平台费、仓储费
- `InventoryPlanningHarness`：在途库存、PO、交期、MOQ、落地成本
- `AccountHealthHarness`：违规、Listing 抑制、Buy Box、账户绩效
- `ServiceOpsHarness`：退款、退货、消息线程、人工接管状态

这些能力可按 `Port` 或 `Harness` 实现，但 Agent 不允许直连平台 SDK 或散落查询数据库。

**估时：** 2d

#### 设计原则（对齐 Ch2.3 + Ch7.3）

1. **Agent 仍通过 Harness 操作** — 绝不直接调用 Amazon/TikTok SDK
2. **按平台特化** — 不强制统一关键词/受众/素材的抽象
3. **向后兼容** — 新方法可选，现有 `AdsCapableHarness` 不变
4. **每个方法有集成测试** — Ch7.3 SLA

#### D1 · 广告 Harness 接口分层

```typescript
// packages/harness/src/ads.types.ts

/** 基础共性（所有有广告的平台） */
interface AdsCapableHarness {
  readonly supportsAds: true
  getAdsCampaigns(): Promise<AdsCampaign[]>
  getCampaignMetrics(campaignId: string, range: DateRange): Promise<CampaignMetrics>
  updateAdsBudget(campaignId: string, dailyBudget: number): Promise<void>
  pauseCampaign(campaignId: string): Promise<void>
  resumeCampaign(campaignId: string): Promise<void>
}

interface CampaignMetrics {
  impressions: number
  clicks: number
  ctr: number
  spend: number
  sales: number
  orders: number
  roas: number
  cpc: number
  cpa: number
  conversionRate: number
  tacos?: number
  contributionProfit?: number
}

/** Amazon / Walmart：搜索意图 + 关键词竞价 */
interface KeywordAdsHarness extends AdsCapableHarness {
  readonly supportsKeywordAds: true
  getKeywords(campaignId: string): Promise<AdKeyword[]>
  addKeywords(campaignId: string, keywords: NewKeyword[]): Promise<void>
  updateKeywordBid(keywordId: string, bid: number): Promise<void>
  pauseKeyword(keywordId: string): Promise<void>
  addNegativeKeywords(campaignId: string, keywords: string[]): Promise<void>
  getSearchTermReport(campaignId: string, range: DateRange): Promise<SearchTermRow[]>
}

/** TikTok：兴趣发现 + 受众定向 + 视频素材 */
interface AudienceAdsHarness extends AdsCapableHarness {
  readonly supportsAudienceAds: true
  getAudiencePerformance(campaignId: string): Promise<AudienceMetrics[]>
  getCreativePerformance(campaignId: string): Promise<CreativeMetrics[]>
}
```

**估时：** 1.5d

#### D2 · Amazon SP Harness 实现（P0 — 最高优先级）

**Amazon SP 是卖家广告支出的 80%+，关键词管理是日常核心操作。**

实现 `KeywordAdsHarness`，对接 Amazon Advertising API v3：

| 方法 | Amazon API 对接 | 优先级 |
|------|----------------|--------|
| `getCampaignMetrics` | Reporting API v3 (SP campaigns) | P0 |
| `getKeywords` | SP Campaigns → Ad Groups → Keywords | P0 |
| `getSearchTermReport` | Reporting API v3 (search terms) | P0 |
| `updateKeywordBid` | SP Keywords → Update bid | P0 |
| `addNegativeKeywords` | SP Negative Keywords → Create | P0 |
| `addKeywords` | SP Keywords → Create | P1 |
| `pauseKeyword` | SP Keywords → Update state | P1 |
| `pauseCampaign` / `resumeCampaign` | SP Campaigns → Update state | P1 |

**估时：** 4d

#### D3 · Amazon SP 数据表扩展

```sql
-- ads_campaigns 增加字段
ALTER TABLE ads_campaigns ADD COLUMN bid_strategy TEXT;
ALTER TABLE ads_campaigns ADD COLUMN targeting_type TEXT;  -- auto / manual
ALTER TABLE ads_campaigns ADD COLUMN start_date DATE;
ALTER TABLE ads_campaigns ADD COLUMN end_date DATE;

-- 新表
CREATE TABLE ads_keywords (...);          -- 关键词 + 匹配类型 + 出价 + 状态
CREATE TABLE ads_negative_keywords (...); -- 否定关键词
CREATE TABLE ads_search_terms (...);      -- 搜索词报告（定期同步）
CREATE TABLE ads_metrics_daily (...);     -- 每日活动级指标快照
```

**估时：** 2d

#### D3.5 · 经营数据聚合层

为支持 Stream A / B：
- `unit_economics_daily`
- `inventory_inbound_shipments`
- `account_health_events`
- `service_cases`

这些表通过同步任务或事件回写聚合，供 Dashboard、Agent、审批中心读取。

**估时：** 2d

#### D4 · Walmart Connect Harness（P1）

Walmart 广告模型和 Amazon SP 类似（关键词+出价），复用 `KeywordAdsHarness` 接口。
API 通过 Walmart Connect Partner Network 对接。

**估时：** 2d

#### D5 · TikTok Shop Ads Harness（P2）

TikTok 模型完全不同（GMV Max + 受众 + 视频素材），实现 `AudienceAdsHarness`。
2025 年后 TikTok 默认 GMV Max 全托管，Agent 角色更偏监控和分析。

**估时：** 2d

#### D6 · Shopee Ads Harness（P2）

Shopee 是混合模型（搜索词 + 商品推荐），API 能力相对有限。

**估时：** 1.5d

#### D7 · 账号健康与售后 Harness

优先实现只读能力：
- `getAccountHealth()`
- `getListingIssues()`
- `getBuyBoxStatus()`
- `getRefundCases()`
- `getSupportThreads()`

写能力（如 refund approve / message send）继续沿用已有治理门控与审批路径。

**估时：** 2.5d

**Stream D 总计：**
- **Phase 5B 范围内：14d**（D0 / D1 / D2 / D3 / D3.5 / D7）
- **含 Phase 6 扩展：约 20d**（额外包含 D4 / D5 / D6）

---

## 4. 统一时间线

### 阶段划分

```
Phase 5B-1 (Sprint 18) · 经营可视化 + 治理基座 + 路由分组        ~2 周
Phase 5B-2 (Sprint 19) · SOP 动态化 + 场景化 + Prompt 栈 + 经营数据底座  ~2 周
Phase 5B-3 (Sprint 20) · Agent Native + 审批渐进 + 事件兼容     ~2 周
Phase 5B-4 (Sprint 21) · 广告深度 + 账号健康/售后               ~2 周
```

> 重排原因：原计划默认“已有数据足够、页面拼接即可”。在加入利润、补货现金流、动态 SOP、账号健康、回滚审计后，7 周已经不现实。为避免违反 `P11 验收以经营结果为准`，改为 **8 周 / 4 Sprint**。Phase 6 兼容任务约增加 **5.5d**，分散到 4 个 Sprint 中。

### 资源假设

> **最小并行人力：2 FTE**
> - **FE（前端）**：1 人，负责 Stream A 全部 + Sprint 级联调
> - **BE（后端 + Agent）**：1 人，负责 Stream B / C / D + API + 数据表
>
> 以下排期按 **2 FTE / 每 Sprint 20 人日可用** 编排。当两条 lane 任务在同一天段内出现时，表示 FE 与 BE 并行。

### Sprint 18 · 经营可视化 + 治理基座 + 路由分组（Week 1-2）

**目标：** 卖家先能看懂经营、安心审批；同时完成业务基础页面骨架

| Week | FE lane | BE lane | 估时 |
|------|---------|---------|------|
| W1 D1-2 | A1 侧栏导航 + A8 路由分组 `(tenant)/(ops)` + middleware 角色分流 | D0 卖家经营 Port / Harness 接口设计 | FE 2d · BE 2d |
| W1 D3-4 | A2 Dashboard + A2.5 利润驾驶舱 | — | FE 4d |
| W1 D5-W2 D1 | A3 审批中心（含 richer payload UI） | — | FE 3d |
| W2 D2-3 | A4 Agent 团队 + 详情页骨架 | — | FE 2d |
| W2 D3-4 | A5 `/products` + `/orders` + `/platforms`（消费已有 API） | — | FE 3d |
| W2 D5 | A6 设置增强 + A7 经营目标中心 | — | FE 2.5d |

**Sprint 18 FE 消耗：16.5d · BE 消耗：2d · Sprint 总计：18.5d / 20d 可用**

**Sprint 18 交付：**
- [x] 卖家看到利润驾驶舱，而不只是用量和订单
- [x] 审批中心具备影响预估、失效时间、回滚说明
- [x] 经营目标（增长/利润/清仓/上新）可配置
- [x] 导航可到达 `/products`、`/orders`、`/platforms` 业务页面
- [x] 卖家经营相关 Port/Harness 边界定义完成
- [x] **前端 `(tenant)` / `(ops)` route group 预分组完成，middleware 按角色分流**

### Sprint 19 · SOP 动态化 + 场景化 + Prompt 栈 + 经营数据 + 剩余页面（Week 3-4）

**目标：** 卖家策略和经营数据做对；锁死 prompt 优先级栈；补齐 `/inventory` 页面；**SOP 场景化创建体验上线**

| Week | FE lane | BE lane | 估时 |
|------|---------|---------|------|
| W3 D1-2 | A5 `/inventory`（可售 + 在途 + 断货预测） | C7 场景数据模型（tenant_sop_scenarios + sop_scenario_templates + tenant_sops 外键） + C1.5 动态作用域规则 | FE 1d · BE 2.5d |
| W3 D3-5 | FE 联调 Sprint 18 遗留 | C2 SOP Parser Service（经营目标结构化 + 拒绝 §5.2 冲突） + C8 模板引擎与展开逻辑 | BE 3.5d |
| W3 D5 | — | C9 场景级 API（7 条）+ 模板 API（2 条）+ OpenAPI Schema | BE 2.5d |
| W4 D1-2 | **场景化创建向导前端**（4 步向导 + `/settings/sop` 场景管理视图） | **C4 Agent Runtime 消费 SOP + `buildSystemPrompt()` L0-L4 分层**（缺口 1） | FE 2d · BE 2d |
| W4 D3 | — | C5 治理设置接线 | BE 1d |
| W4 D3-4 | — | C6 经营目标结构化解析 | BE 1d |
| W4 D4-5 | — | D3.5 经营数据聚合层（unit economics / inbound / health / service） | BE 2d |

**Sprint 19 FE 消耗：3d + 联调 · BE 消耗：15.5d · Sprint 总计：18.5d / 20d 可用**
（FE 有 ~7d 空余用于 A3/A4 联调打磨和 Sprint 18 遗留 bug 修复；BE 较紧但可利用 FE 联调空余做 buffer）

**Sprint 19 交付：**
- [x] SOP 支持平台/实体/时间窗/版本/回滚
- [x] **卖家可通过场景化向导创建 SOP（选场景 + 平台 + 对象 + 时间窗），系统自动展开为多条 Agent SOP**
- [x] **12 套预置模板（4 场景 × 3 Agent）上线，`locked_fields` 不可被卖家覆盖**
- [x] **场景级 API + 模板 API 具备 OpenAPI Schema**
- [x] 卖家经营目标被结构化注入 Agent
- [x] Dashboard / Agent / 审批中心可读取利润、在途、账号健康、售后聚合数据
- [x] `/inventory` 页面可用（可售 + 在途 + 断货预测 + 补货金额）
- [x] **`buildSystemPrompt()` L0-L4 分层完成，L1 为 Phase 6 Autonomy Constitution 预留**
- [x] **SOP Parser 拒绝提取与 Constitution §5.2/§5.4 直接冲突的内容**
- [x] **`sop.scenario.created` / `activated` / `archived` 事件正确发射**

### Sprint 20 · Agent Native + 审批渐进 + 事件兼容（Week 5-6）

**目标：** 3 个高频经营 Agent 升级为真正的 AI Agent；埋好审批渐进机制和 Phase 6 事件格式

| Week | FE lane | BE lane | 估时 |
|------|---------|---------|------|
| W5 D1 | — | B0 统一决策管线抽象 | BE 1d |
| W5 D2 | — | B0.5 自主降级与经营预算护栏 | BE 1d |
| W5 D3-5 | Agent 审批 payload 展示组件升级 | B1 Price Sentinel 改造（利润护栏） | FE 2d · BE 3d |
| W6 D1-3 | B7 审批模式渐进 UI（`approval_informed` 切换 + 自治成熟度指标面板） | B2 Ads Optimizer 改造（生命周期目标 + 库存约束） | FE 1.5d · BE 3d |
| W6 D4-5 | Agent 详情页联调（决策记录 + 审批 payload 展示） | B3 Inventory Guard 改造（交期/MOQ/现金流） | FE 2d · BE 2d |
| — | — | B5 审批 payload 升级 | BE 1.5d |
| — | — | B7 审批模式后端（模式切换 + `autoApprovable` 字段） | BE 1.5d |
| — | — | B8 事件 payload Phase 6 兼容字段 + Prometheus 指标 | BE 1.5d |

**Sprint 20 FE 消耗：5.5d · BE 消耗：14.5d · Sprint 总计：20d / 20d 可用**

**Sprint 20 交付：**
- [x] Price Sentinel 自动调价受利润护栏约束
- [x] Ads Optimizer 输出带生命周期目标和 TACoS 解释的建议
- [x] Inventory Guard 输出带交期/在途/MOQ/采购金额的补货建议
- [x] 审批 payload 满足"可理解、可约束、可回滚"
- [x] **审批系统支持 `approval_required` / `approval_informed` 模式切换**
- [x] **审批 payload 含 `autoApprovable` + `autoApproveReason`**
- [x] **`agent.decision.made` 事件含 `confidence` + `metrics.*` Phase 6 兼容字段**
- [x] **Harness 错误率、决策质量、GMV 变化通过 Prometheus 标准化暴露**

### Sprint 21 · 广告深度 + 账号健康/售后 + 结果回写（Week 7-8）

**目标：** 把经营智能落到 Amazon SP 和卖家高频风险面板

| Week | FE lane | BE lane | 估时 |
|------|---------|---------|------|
| W7 D1-2 | A5 `/ads` 页面增强：SKU 视图 + keyword/search term 下钻 | D1 广告 Harness 接口分层设计 + 经营字段扩展 | FE 1.5d · BE 1.5d |
| W7 D3-W8 D1 | A5 `/service` + `/account-health` 页面落地 | D2 Amazon SP Harness 实现（**降级：API 未批复 → fixture/mock 验收**） | FE 2d · BE 4d |
| W8 D2 | — | D3 Amazon SP 数据表扩展 | BE 2d |
| W8 D3 | — | D7 账号健康与售后 Harness | BE 2.5d |
| W8 D4-5 | 全流程联调 + 验收走查 | B6 结果回写与经营成效评估 | FE 2d · BE 1.5d |

**Sprint 21 FE 消耗：5.5d · BE 消耗：11.5d · Sprint 总计：17d / 20d 可用**
（3d 缓冲用于 Amazon API 延期应急或跨 Sprint bug 修复）

**Sprint 21 交付：**
- [x] Amazon SP 关键词/出价/否定词管理通过 Harness（**降级验收：fixture 返回真实格式数据，API 批复后 48h 内切真实数据**）
- [x] 前端 `/ads` 支持 SKU 经营视图和搜索词报告
- [x] `/service` 与 `/account-health` 工作台上线
- [x] 经营结果指标可回写到 Agent 评估链路

### Phase 6 延期项

| 项 | 理由 |
|---|------|
| B4 Product Scout 智能改造 | 使用 Sonnet（成本高）、核心动作需人工确认（§5.4），Phase 5B ROI 不足 |
| D4 Walmart Connect Harness | 需申请 WCPN 合作伙伴资格 |
| D5 TikTok Ads Harness | GMV Max 全托管，Agent 更偏监控 |
| D6 Shopee Ads Harness | API 能力有限 |
| Shopify 外部广告（Meta/Google） | 完全不同的 API 体系 |
| DSP / Streaming TV | Enterprise 级别，中小卖家不用 |
| 自动化采购下单（PO create/write-back） | 现金与供应链风险高，需单独治理设计 |
| 售后写操作自动化（自动退款/自动消息发送） | 高风险动作，先做只读与人工接管 |

---

## 4.5 实施前审查补齐

> 本节回应架构审查发现的 P1/P2 级问题，补齐实施前必须明确的边界和契约。

### 4.5.1 Phase 5B In-scope Agent 清单

| Agent | Phase 5B 改造范围 | SOP 消费方式 | 决策管线 |
|-------|------------------|-------------|---------|
| **Price Sentinel** | 完整五阶段改造（B1） | 专属 SOP + Global SOP | ✅ 完整 |
| **Ads Optimizer** | 完整五阶段改造（B2） | 专属 SOP + Global SOP | ✅ 完整 |
| **Inventory Guard** | 完整五阶段改造（B3） | 专属 SOP + Global SOP | ✅ 完整 |
| Product Scout | 保持规则引擎 | 仅读 Global SOP `systemPrompt` | ❌ 延期 Phase 6 |
| Support Relay | 保持现有 LLM | 仅读 Global SOP `systemPrompt` + 专属 `toneSystemPrompt` | ❌ 不改造管线 |
| Content Writer | 保持现有 LLM | 仅读 Global SOP `systemPrompt` + 专属 `tone`/`maxLength` | ❌ 不改造管线 |
| Market Intel | 保持现有 LLM | 仅读 Global SOP `systemPrompt` | ❌ 不改造管线 |
| CEO Agent | 保持现有 LLM | 仅读 Global SOP `systemPrompt` | ❌ 不改造管线 |
| Finance Agent | 保持现有 LLM | 仅读 Global SOP `systemPrompt` | ❌ 不改造管线 |

**规则：** 所有 Agent 都必须执行 `buildSystemPrompt()` L0-L4 分层（通过 Agent Runtime 统一注入），但只有 Price/Ads/Inventory 三个 Agent 在 Phase 5B 完成完整的五阶段决策管线改造。其余 Agent 的 `gather()` 中会读到 SOP，但 `reason()` / `govern()` 不改造。

### 4.5.2 RBAC / API 鉴权矩阵

| 角色 | JWT claim | 可访问路由 | API 前缀 | 租户隔离 |
|------|-----------|-----------|---------|---------|
| `seller` | `role: 'seller', tenantId: '<uuid>'` | `(tenant)/*` | `/api/v1/*` | RLS by `tenantId` |
| `admin` | `role: 'admin'` | `(tenant)/*` + `(ops)/*` | `/api/v1/*` + `/api/ops/*` | 无 RLS，跨租户 |

**API 层鉴权中间件：**

```typescript
// apps/api/src/plugins/auth.ts

// 所有 /api/v1/* 路由：
// 1. 验证 JWT
// 2. 从 token 提取 tenantId
// 3. 注入到 request context（Drizzle RLS 自动过滤）
// 4. seller 角色禁止调用 /api/ops/* 前缀

// 所有 /api/ops/* 路由（Phase 6 预留）：
// 1. 验证 JWT
// 2. 要求 role === 'admin'
// 3. 无 tenantId 过滤（跨租户视图）
// 4. 审计日志必须记录操作者 + 被操作租户
```

**关键约束：**
- `seller` 发往 `/api/ops/*` 的请求直接返回 `403 Forbidden`
- 横向越权防护：所有 `/api/v1/*` 路由的 `tenantId` 只从 JWT 提取，**不接受** query/body 中的 `tenantId` 参数
- Phase 5B 不实现 `/api/ops/*` 路由内容，但 middleware 框架必须就位

### 4.5.3 RLS 全表覆盖

| 表名 | `tenant_id` 列 | RLS 策略 | 引入 Sprint |
|------|---------------|---------|------------|
| `tenant_sops` | ✅ | `tenant_id = current_setting('app.tenant_id')` | Sprint 19 (C1→C7) |
| `tenant_sop_scenarios` (新) | ✅ | `tenant_id = current_setting('app.tenant_id')` | Sprint 19 (C7) |
| `ads_campaigns` (已有) | ✅ | 已有 RLS | — |
| `ads_keywords` (新) | ✅ | 同 `ads_campaigns` | Sprint 21 (D3) |
| `ads_negative_keywords` (新) | ✅ | 同上 | Sprint 21 (D3) |
| `ads_search_terms` (新) | ✅ | 同上 | Sprint 21 (D3) |
| `ads_metrics_daily` (新) | ✅ | 同上 | Sprint 21 (D3) |
| `unit_economics_daily` (新) | ✅ | `tenant_id = current_setting('app.tenant_id')` | Sprint 19 (D3.5) |
| `inventory_inbound_shipments` (新) | ✅ | 同上 | Sprint 19 (D3.5) |
| `account_health_events` (新) | ✅ | 同上 | Sprint 19 (D3.5) |
| `service_cases` (新) | ✅ | 同上 | Sprint 19 (D3.5) |

**规则：** 每张含 `tenant_id` 的表在创建时必须同步创建 RLS policy。迁移脚本模板：

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 4.5.4 SOP API 资源模型统一

**审查问题：** `PUT /api/v1/sop/{scope}` 与 `PUT /api/v1/sop/global` 并存，`global` 与 `{scope}` 是否同一资源模型不清晰。

**修正：** `global` 是 `scope` 枚举值之一，不需要独立路由。

```
POST /api/v1/sop/parse              — 解析预览（不写入）
PUT  /api/v1/sop/{scope}            — 保存 + 应用（scope 包含 'global'）
GET  /api/v1/sop                    — 获取租户所有 SOP
POST /api/v1/sop/{scope}/activate   — 启用指定版本
POST /api/v1/sop/{scope}/rollback   — 回滚到上一版本
```

~~`PUT /api/v1/sop/global`~~ 已删除。`global` 通过 `PUT /api/v1/sop/global` 自然匹配 `{scope}` 参数。

**版本递增与 activate 事务边界：**
1. `PUT /api/v1/sop/{scope}` 写入新版本行（`version = max(version) + 1`），状态为 `draft`
2. `POST /api/v1/sop/{scope}/activate` 在事务内：将目标版本设为 `active`，将同 scope 其他版本设为 `archived`
3. `POST /api/v1/sop/{scope}/rollback` 等价于 `activate(previous_version_id)`
4. 并发写入由 `UNIQUE(tenant_id, scope, platform, entity_type, entity_id, version)` + `SELECT FOR UPDATE` 保护

### 4.5.5 事件目录表

| 事件名 | Schema 版本 | Producer | 必填字段 | PII | Phase 6 MonitorReport 映射 |
|--------|------------|----------|---------|-----|--------------------------|
| `agent.decision.made` | v1 | Agent Runtime | `agentId`, `tenantId`, `action`, `decision`, `confidence`, `reason` | tenantId | `category: 'quality'` |
| `agent.decision.outcome` | v1 | Agent Runtime (延迟回写) | `agentId`, `tenantId`, `decisionId`, `outcomeMetrics` | tenantId | `evidence: { convRateChange, profitDelta }` |
| `sop.updated` | v1 | SOP API | `tenantId`, `scope`, `version`, `changeType` | tenantId | `category: 'config'` |
| `harness.api.error` | v1 | Harness 层 | `platform`, `method`, `errorType`, `tenantId` | tenantId | `category: 'sla'` |
| `agent.budget.exceeded` | v1 | Agent Runtime | `agentId`, `tenantId`, `budgetType`, `currentUsage`, `limit` | tenantId | `category: 'performance'` |
| `sop.scenario.created` | v1 | SOP API | `tenantId`, `scenarioId`, `scenario`, `platform`, `entityType`, `scopeCount` | tenantId | `category: 'config'` |
| `sop.scenario.activated` | v1 | SOP API | `tenantId`, `scenarioId`, `version` | tenantId | `category: 'config'` |
| `sop.scenario.archived` | v1 | SOP API | `tenantId`, `scenarioId`, `reason` (`manual` / `expired`) | tenantId | `category: 'config'` |
| `approval.resolved` | v1 | Approval API | `approvalId`, `tenantId`, `resolution`, `resolvedBy` | tenantId | — |
| `approval.expired` | v1 | Approval API | `approvalId`, `tenantId`, `expireAt` | tenantId | — |

**Phase 6 兼容字段（所有事件可选附加）：**

```typescript
interface Phase6CompatFields {
  metrics?: {
    gmvImpact?: number
    marginImpact?: number
    harnessErrorRate?: number
  }
}
```

**事件投递契约：**
- **幂等键：** `eventId`（UUID v7，含时间戳排序）
- **投递保证：** at-least-once（消费者必须按 `eventId` 去重）
- **写入顺序：** 同一 `tenantId + agentId` 的事件按 `eventId` 单调递增
- **Schema 演进：** 仅允许新增 optional 字段；破坏性变更需递增 schema 版本号

### 4.5.6 审批模式状态机

```
                          ┌──────────────────────────┐
                          │                          │
     ┌────────────────────▼──────────────┐           │
     │       approval_required           │           │
     │  (Phase 5B 默认)                  │           │
     │                                   │           │
     │  超阈值动作 → 人工审批            │           │
     │  安全网范围内 → 自动执行           │           │
     └──────────┬────────────────────────┘           │
                │                                     │
                │ 卖家主动开启                        │
                │ 或 连续 30 天采纳率 >90%             │
                │                                     │
     ┌──────────▼────────────────────────┐           │
     │       approval_informed           │           │
     │  (Phase 5B 后期)                  │           │
     │                                   │           │ 卖家手动
     │  超阈值动作 → 自动执行 + 通知     │           │ 回退
     │  48h 内可回滚（卖家触发）         │           │
     │  回滚由 Approval API 执行         │           │
     └──────────┬────────────────────────┘           │
                │                                     │
                │ ❌ Phase 5B 禁止进入               │
                │ （仅 Phase 6 可启用）                │
                │                                     │
     ┌──────────▼────────────────────────┐           │
     │       autonomous                  │◄──────────┘
     │  (Phase 6 专属)                   │
     │                                   │
     │  Agent 自动执行 + 仅记录          │
     │  Circuit Breaker 兜底（非 5B）    │
     └──────────────────────────────────┘
```

**关键约束：**
- **谁写入模式：** 卖家在 `/settings/governance` 中手动切换（`approval_required` ↔ `approval_informed`）
- **谁熔断/回滚：** Phase 5B 中回滚由卖家通过审批中心触发；Phase 6 中回滚由 Circuit Breaker 自动触发
- **`autonomous` 在 Phase 5B 中硬编码禁止：** API 层在 `PUT /api/v1/settings/governance` 中对 `mode: 'autonomous'` 直接返回 `400 Bad Request`
- **`approval_informed` 的 48h 回滚** 和 Phase 6 **Circuit Breaker** 是两个独立机制；5B 的 48h 回滚写在 `approvals` 表，Phase 6 的 CB 回滚写在 `circuit_breaker_events` 表（Phase 6 新建）

### 4.5.7 Prompt 安全工程化

**审查问题：** `buildSystemPrompt()` 仅字符串拼接，不能技术上保证 SOP 中的 "忽略以上约束" 不影响 Constitution 层。

**多层防护方案：**

| 层 | 防护点 | 实现 |
|----|-------|------|
| **静态防护（Parser 阶段）** | SOP Parser 拒绝危险内容 | C2 中 LLM 提取后做规则校验：检测 "忽略"/"覆盖"/"取消审批" 等模式，命中则返回 `extraction_warnings` 且不写入 `extracted_system_prompt` |
| **结构化隔离（Runtime 阶段）** | system 与 user 分离 | `buildSystemPrompt()` 输出拆分为多条 message：`[{role:'system', content: L0+L1+L2}, {role:'user', content: L3+L4+task}]`，Constitution 永远在 system message 中 |
| **运行时二次校验（Govern 阶段）** | 决策结果校验 | `govern()` 阶段对 LLM 输出做硬编码规则检查（§5.2 价格幅度、§5.4 审批门控），即使 LLM 被 prompt injection 也不能绕过 |

**AC-5B-P6-01 修正后的可测条件：**
1. Constitution prompt 始终通过 `role: 'system'` 注入，SOP 通过 `role: 'user'` 注入，二者不在同一 message 中
2. Parser 对包含 "忽略以上规则"/"取消所有审批"/"override constitution" 的 SOP 输入，提取结果为空 + warning
3. `govern()` 的安全网检查独立于 LLM 输出，hardcode 在代码中，不受 prompt 影响

### 4.5.8 AC-5B-23 可测化拆分

**原条目：** "计划最终验收包含结果指标：断货率下降、广告建议采纳后 TACoS/贡献利润改善、误报率/回滚率可观测"

**拆分为两层：**

| 层 | 验收条件 | Phase |
|----|---------|-------|
| **数据管道层（Phase 5B 必须交付）** | `unit_economics_daily` 表可按 tenant+SKU 查询贡献毛利 | 5B Sprint 19 |
| | `agent_decision_outcomes` 表可查询采纳率、驳回率、回滚率 | 5B Sprint 20 |
| | Dashboard 有可视化面板展示上述指标 | 5B Sprint 21 |
| | Prometheus 可查询 `agent_decision_quality_score`、`tenant_gmv_daily` | 5B Sprint 20 |
| **业务结果层（Phase 6 运营期 OKR）** | 试点租户断货率环比下降 >10%（基线：Phase 5B 上线首月） | 6 OKR |
| | 广告建议采纳后 7 日 TACoS 改善 >5%（shadow 对照组 vs 采纳组） | 6 OKR |
| | Agent 误报率（建议后被回滚）< 10% | 6 OKR |

---

## 5. Constitution 合规自查

| Constitution 条款 | Phase 5B 对齐方式 | 状态 |
|------------------|------------------|------|
| **Ch1.1** "人类做战略决策，AI 做执行" | SOP = 战略输入；LLM Agent = 执行；审批中心 = 人类决策点 | ✅ |
| **Ch2.1** 模块化 | 新增 `packages/sop/`；Harness 广告按平台分子接口 | ✅ |
| **Ch2.2** API First | SOP API 4 条；审批 API 增强 2 项 | ✅ |
| **Ch2.3** Harness 抽象 | Agent 通过 KeywordAdsHarness/AudienceAdsHarness 操作，不直接调 SDK | ✅ |
| **Ch2.4** 事件驱动 | 新增 `sop.updated` / `agent.decision.made` / `agent.decision.outcome` 事件 | ✅ |
| **Ch3.1** 技术栈 | Next.js + Tailwind + Fastify + Drizzle + PostgreSQL | ✅ |
| **Ch3.2** 模型分配 | Price Sentinel/Ads/Inventory → Haiku；Scout/Content/Intel → Sonnet | ✅ 改造后真正使用 |
| **Ch5.1** Agent Pre-flight | 五阶段管线的 `gather()` 实现四步 Pre-flight | ✅ |
| **Ch5.2** 禁止行为：价格>15%、广告>30% | 治理安全网保留全部门控 | ✅ |
| **Ch5.4** 审批门控表 | 审批中心完整产品化 + Agent 输出含业务理由 | ✅ |
| **Ch6.1** RLS | **所有新增租户表** tenant_id + RLS（见 §4.5.3 全表覆盖） | ✅ 全覆盖 |
| **Ch6.2** 租户级配置 | SOP 全覆盖 + governance 接线 + **场景化结构类型**（C7-C10） | ✅ 大幅扩展 |
| **Ch7.3** Harness SLA | 新 Harness 方法含集成测试 + 向后兼容 | ✅ |
| **Ch8.1** 监控 | 新增 `agent.llm.cost` / `sop.parse.latency` / `ads.keyword.sync` + `sop_scenario_*` 场景指标 | ✅ |
| **Phase 6 兼容** prompt 优先级 | `buildSystemPrompt()` L0-L4 分层，L1 为 Phase 6 Autonomy Constitution 预留 | ✅ 架构预留 |
| **Phase 6 兼容** 审批→自治迁移 | 审批模式支持 `approval_required` → `approval_informed`；payload 含 `autoApprovable` | ✅ 机制预留 |
| **Phase 6 兼容** 控制平面分离 | 前端 `(tenant)` / `(ops)` route group 预分组；独立 RBAC 位 | ✅ 结构预留 |
| **Phase 6 兼容** 事件格式 | 事件 payload 包含 `confidence` / `metrics.*` 字段，兼容 `MonitorReport` | ✅ 格式预留 |

---

## 6. 验收标准

### Sprint 18

| # | 验收条件 |
|---|---------|
| AC-5B-01 | 卖家登录后首屏展示：待审批数 + Agent 动态 + 业务指标 + 库存预警 |
| AC-5B-02 | Dashboard 提供利润驾驶舱，至少展示 `netRevenue`、`contributionMargin`、`tacos`、`refundRate`、`feeRate` |
| AC-5B-03 | 审批中心可查看每条审批的 action 类型、Agent、具体内容，可批准/拒绝，并展示 `impactPreview` / `expireAt` / `rollbackPlan` |
| AC-5B-04 | 经营目标中心支持配置 `growth` / `profit` / `launch` / `clearance` 等目标 |
| AC-5B-05 | 卖家经营相关 Port/Harness 边界定义完成，且 Agent 无平台 SDK 直调回退 |
| **AC-5B-P6-06** | **前端路由按 `(tenant)` / `(ops)` 分组，middleware 按角色分流（Phase 6 缺口 3）** |
| **AC-5B-P6-07** | **`(ops)/` 目录存在但内容为 Phase 6 占位页，不暴露给 seller 角色** |

### Sprint 19

| # | 验收条件 |
|---|---------|
| AC-5B-06 | 卖家可为每个 Agent 编写 SOP，系统正确提取 `goalContext` + `systemPrompt` + `governance` |
| AC-5B-07 | SOP 支持按 `scope + platform + optional entity + effective window` 生效，并可回滚到上一版本 |
| AC-5B-08 | 治理设置（`adsBudgetApproval`、`newListingApproval`、`humanInLoopAgents`）全部接线到 Agent Runtime |
| AC-5B-09 | Dashboard / Agent / 审批中心均可读取利润、在途、账号健康、售后聚合数据 |
| AC-5B-10 | 卖家经营目标被结构化注入 Price / Ads / Inventory 三个 Agent |
| AC-5B-11 | 高风险 SOP 变更支持“策略变更确认”与版本回滚 |
| AC-5B-12 | 策略层 API 与数据模型保持 API First 和向后兼容 |
| **AC-5B-P6-01** | **`buildSystemPrompt()` 实现 L0-L4 分层结构，低层无法覆盖高层（Phase 6 缺口 1）** |
| **AC-5B-P6-02** | **SOP Parser 拒绝提取与 Constitution §5.2/§5.4 直接冲突的内容，并返回 warning** |
| **AC-5B-SC-01** | **卖家可通过场景化向导（选场景 + 平台 + 对象 + 时间窗）创建 SOP，系统自动展开为多条 Agent SOP** |
| **AC-5B-SC-02** | **场景创建时加载预置模板，`locked_fields` 不可被卖家覆盖** |
| **AC-5B-SC-03** | **场景级 API（7 条）+ 模板 API（2 条）具备 OpenAPI Schema（G7 修正）** |
| **AC-5B-SC-04** | **`sop.scenario.created` / `activated` / `archived` 事件正确发射并入事件目录（G1 修正）** |
| **AC-5B-SC-05** | **`tenant_sop_scenarios` 表具备 RLS 策略** |

### Sprint 20

| # | 验收条件 |
|---|---------|
| AC-5B-13 | Price Sentinel 自主扫描商品并生成调价建议，且自动动作受 `minMarginPercent` / `minContributionProfitUsd` 护栏约束 |
| AC-5B-14 | Ads Optimizer 能做出加预算/减预算/暂停/维持四种决策，并输出生命周期目标解释 |
| AC-5B-15 | Inventory Guard 补货建议包含 `leadTimeDays`、`inboundQty`、`moq`、`landedCost`、`expectedStockoutDate` |
| AC-5B-16 | 每个审批的 `reason` 字段含 LLM 生成的业务分析，且支持“可理解、可约束、可回滚” |
| AC-5B-16F | 3 个改造 Agent（Price/Ads/Inventory）都使用 Decision Memory（回忆 + 记录 + 追踪） |
| AC-5B-16G | 单 Agent 月 LLM 成本 < $5（Haiku 批量处理） |
| AC-5B-16H | Constitution §5.2/§5.4 全部门控仍然生效（安全网不退化） |
| **AC-5B-P6-03** | **审批系统支持 `approval_required` / `approval_informed` 两种模式切换（Phase 6 缺口 2）** |
| **AC-5B-P6-04** | **审批 payload 包含 `autoApprovable` + `autoApproveReason` 字段** |
| **AC-5B-P6-05** | **Dashboard 可查看 `approvalRequiredRate` / `approvalAdoptionRate` / `rollbackRate` 自治成熟度指标** |
| **AC-5B-P6-08** | **`agent.decision.made` 事件 payload 包含 `confidence` + `metrics.gmvImpact` + `metrics.marginImpact` + `scenarioId?`（Phase 6 缺口 4 + G3 修正）** |
| **AC-5B-P6-09** | **Harness 错误率、Agent 决策质量评分、租户 GMV 日变化 + `sop_scenario_*` 场景指标通过 Prometheus 标准化暴露（G2 修正）** |
| **AC-5B-P6-10** | **所有新增事件格式文档化，标注 Phase 6 MonitorReport 可提取字段** |
| **AC-5B-SC-06** | **`AgentError` 联合类型包含 `sop_scenario_error` 子类型，覆盖 `template_not_found` / `locked_field_violation` / `parser_extraction_failed` / `version_conflict`（G5 修正）** |

### Sprint 21

| # | 验收条件 |
|---|---------|
| AC-5B-21A | Amazon SP `getKeywords` + `getSearchTermReport` 返回真实数据 |
| AC-5B-21B | Ads Optimizer 分析搜索词报告后建议添加否定关键词 |
| AC-5B-21C | `/ads` 页面默认提供 SKU/ASIN 经营视图，并可下钻到 campaign / keyword / search term |
| AC-5B-21D | `/service` 页面可查看消息线程、退款/退货案例与人工接管状态 |
| AC-5B-21E | `/account-health` 页面可查看违规、Listing issues、Buy Box 丢失与账户健康信号 |
| AC-5B-21F | `getAccountHealth()` / `getListingIssues()` / `getRefundCases()` 等 Harness 能力具备集成测试 |
| AC-5B-21G | Agent 成效回写链路可展示采纳率、驳回率、回滚率、后悔率 |

### 专业卖家补充验收（原则对齐版）

> 以下 AC 是对 D6-D12 的原则性补齐，先作为 **必须纳入后续排期重算** 的验收项；不允许在后续实施中被降级为“可选优化”。

| # | 验收条件 |
|---|---------|
| AC-5B-17 | Dashboard 提供利润驾驶舱：至少展示 `netRevenue`、`contributionMargin`、`tacos`、`refundRate`、`feeRate` |
| AC-5B-18 | Price Sentinel 的任何自动调价都受 `minMarginPercent` / `minContributionProfitUsd` 护栏约束；数据缺失时自动降级为审批建议 |
| AC-5B-19 | Inventory Guard 的补货建议包含 `leadTimeDays`、`inboundQty`、`moq`、`landedCost`、`expectedStockoutDate` 五类信息 |
| AC-5B-20 | Ads Optimizer 的每条建议都带有生命周期目标（`launch` / `scale` / `defend` / `clearance`）和库存约束解释 |
| AC-5B-21 | 审批中心可展示 `impactPreview`、`expireAt`、`rollbackPlan`、`similarPastDecisions`，且支持超时失效 |
| AC-5B-22 | SOP 支持按 `scenario + scope + platform + optional entity + effective window` 生效，场景化向导为主入口，并可回滚到上一版本 |
| AC-5B-23a | Phase 5B 交付结果指标**数据管道**：`unit_economics_daily` 可查贡献毛利、`agent_decision_outcomes` 可查采纳率/回滚率、Dashboard 有可视化面板、Prometheus 可查 `agent_decision_quality_score` |
| AC-5B-23b | 业务结果改善（断货率、TACoS、误报率）作为 **Phase 6 运营期 OKR**，基线取 Phase 5B 上线首月数据（见 §4.5.8） |

---

## 7. Phase 6 Compatibility — 解决 4 个结构性衔接缺口

> Phase 5B 定位：既是卖家产品增强，也是 Phase 6 的前置基础。但 Phase 5B **不直接实现** Phase 6 基础设施（Circuit Breaker / 互监协议 / Autonomy Constitution / 全局监督面板），只 **留好接口和结构位**。

### 缺口 1 · SOP 与 Autonomy Constitution 的 prompt 优先级

**问题：** Phase 6 要求所有 Agent 的 system prompt 必须携带 `Autonomy Constitution`（AC-02/AC-03 不可修改），但当前 SOP 注入到 `systemPrompt` 时没有定义不可覆盖的优先级栈。

**Phase 5B 解决方案：** 在 `C4 · Agent Runtime 消费 SOP` 中锁死 prompt 优先级栈：

```typescript
// packages/agent-runtime/src/prompt-stack.ts

function buildSystemPrompt(ctx: AgentContext, sop: ExtractedSop | null): string {
  const layers = [
    SYSTEM_CONSTITUTION_PROMPT,         // L0 — 永远在最前，不可覆盖
    // L1 — Phase 6 在此插入 AUTONOMY_CONSTITUTION_PROMPT
    getPlatformPolicyPrompt(ctx),       // L2 — 平台级硬限制
    sop?.extracted_system_prompt,       // L3 — 租户 SOP（动态）
    // L4 — task-specific prompt 由 Agent 在 reason() 中自生成
  ]
  return layers.filter(Boolean).join('\n\n---\n\n')
}
```

**关键约束：**
- 低层 prompt 不可覆盖高层 hard constraints
- SOP Parser 在解析阶段就拒绝与 Constitution §5.2 冲突的提取（如"取消所有审批"）
- Phase 6 只需在 L1 位置插入 `AUTONOMY_CONSTITUTION_PROMPT`，不需要改架构

**验收项：**

| # | 验收条件 |
|---|---------|
| AC-5B-P6-01 | `buildSystemPrompt()` 实现 L0-L4 分层结构，低层无法覆盖高层 |
| AC-5B-P6-02 | SOP Parser 拒绝提取与 Constitution §5.2/§5.4 直接冲突的内容，并返回 warning |

### 缺口 2 · 审批需求下降路径（Approval → Autonomy 迁移）

**问题：** Phase 5B 把审批中心做得很好，但 Phase 6 的 30 天验收要求 `humanInterventions = 0`。如果没有定义"审批需求自然下降"的路径，Phase 5B 会把产品往更重的人在环依赖上推。

**Phase 5B 解决方案：** 增加"审批模式渐进"机制和指标追踪。

**1) 审批模式三阶段：**

| 阶段 | 模式 | 行为 | 何时生效 |
|------|------|------|---------|
| Phase 5B | `approval_required` | 超过阈值的动作必须人工审批 | 默认（当前已有） |
| Phase 5B 后期 | `approval_informed` | Agent 自动执行，但事后通知卖家（48h 内可回滚） | 卖家主动开启 / 连续 30 天采纳率 >90% |
| Phase 6 | `autonomous` | Agent 自动执行，仅记录，Circuit Breaker 兜底 | Phase 6 自治验收期 |

**2) 在审批 payload 中增加 `autoApprovable` 字段：**

```typescript
{
  action: 'price.update',
  payload: {
    ...existingFields,
    autoApprovable: true,   // Agent confidence > 0.9 且在安全网范围内
    autoApproveReason: '变动幅度 3%，低于阈值 15%，历史同类决策采纳率 97%',
  }
}
```

**3) 追踪自治成熟度指标：**

| 指标 | 含义 | Phase 6 入场门槛 |
|------|------|-----------------|
| `approvalRequiredRate` | 触发审批的动作占总动作百分比 | < 20% |
| `approvalAdoptionRate` | 审批被采纳的百分比 | > 85% |
| `autoExecutedSafeActionsRate` | 安全范围内自动执行的百分比 | > 70% |
| `rollbackRate` | 执行后被回滚的百分比 | < 5% |
| `manualInterventionRate` | 卖家直接手动操作平台的频率 | 趋近 0 |

**验收项：**

| # | 验收条件 |
|---|---------|
| AC-5B-P6-03 | 审批系统支持 `approval_required` / `approval_informed` 两种模式切换 |
| AC-5B-P6-04 | 审批 payload 包含 `autoApprovable` + `autoApproveReason` 字段 |
| AC-5B-P6-05 | Dashboard 或 Agent 详情页可查看 `approvalRequiredRate` / `approvalAdoptionRate` / `rollbackRate` |

### 缺口 3 · Tenant Console vs Autonomy Control Plane 边界

**问题：** Phase 6 需要跨三层的只读全局监督面板，但这不是租户应该看的东西。两者的受众、安全模型、信息密度完全不同。

**Phase 5B 解决方案：** 在前端路由层面预先分组，Phase 6 直接在 `(ops)/` 下开发。

```
apps/web/src/app/
├── (tenant)/              ← Phase 5B 做（per-tenant RLS）
│   ├── dashboard/
│   ├── approvals/
│   ├── agents/
│   ├── products/
│   ├── orders/
│   ├── ads/
│   ├── inventory/
│   ├── service/
│   ├── account-health/
│   └── settings/
├── (ops)/                 ← Phase 6 做（super-admin 全局视图）
│   ├── autonomy/          — 30 天验收日志 + overallHealthScore
│   ├── circuit-breaker/   — 状态机 + 触发历史
│   ├── inter-layer/       — 三层互监 MonitorReport 面板
│   ├── devos-loops/       — Autonomous Loop 队列
│   └── emergency/         — 全局紧急停止按钮
└── middleware.ts          ← 按 role 分流：seller → (tenant)，admin → (ops)
```

**关键约束：**
- 两个 route group 共享 component library 和部署流水线
- `(tenant)/` 走 per-tenant RLS，`(ops)/` 走 super-admin RBAC
- Phase 5B 只建好 `(tenant)/` 和分组结构，不实现 `(ops)/` 内容
- 租户看到的平台状态只限于"和自己有关的降级信息"（如"Amazon 广告同步延迟"）

**验收项：**

| # | 验收条件 |
|---|---------|
| AC-5B-P6-06 | 前端路由按 `(tenant)` / `(ops)` 分组，middleware 按角色分流 |
| AC-5B-P6-07 | `(ops)/` 目录存在但内容为 Phase 6 占位页，不暴露给 seller 角色 |

### 缺口 4 · 事件与指标格式兼容 Phase 6 互监协议和 Circuit Breaker

**问题：** Phase 6 需要标准化的 `MonitorReport` 协议和 `BreakerMetric` 输入。当前 Phase 5B 的事件（`agent.decision.made` / `agent.decision.outcome`）和 Harness 指标还没有对齐这些格式。

**Phase 5B 解决方案：** 不实现 Circuit Breaker 和互监协议本身，但确保事件和指标格式可被 Phase 6 直接消费。

**1) 事件格式兼容 `MonitorReport`：**

Phase 5B 新增的事件已经包含 Phase 6 互监所需的核心字段：

| Phase 5B 事件 | Phase 6 `MonitorReport` 可提取 |
|---------------|-------------------------------|
| `agent.decision.made` | `category: 'quality'`，Agent 决策质量 |
| `agent.decision.outcome` | `evidence: { convRateChange, profitDelta }` |
| `sop.updated` | `category: 'config'`，策略变更记录 |
| `harness.api.error` | `category: 'sla'`，Harness SLA 违规 |
| `agent.budget.exceeded` | `category: 'performance'`，预算异常 |

**2) 确保事件 payload 包含 Phase 6 所需的 evidence 字段：**

```typescript
// Phase 5B 事件 payload 规范
interface AgentDecisionEvent {
  agentId: string
  tenantId: string
  action: string
  decision: unknown
  confidence: number
  reason: string
  scenarioId?: string           // G3 修正：基于哪个经营场景做的决策
  // Phase 6 兼容字段
  metrics?: {
    gmvImpact?: number        // Circuit Breaker: GMV 变化
    marginImpact?: number     // Circuit Breaker: 利润变化
    harnessErrorRate?: number // Circuit Breaker: Harness 错误率
  }
}
```

**3) Harness 指标标准化：**

所有 Harness 方法的错误率、延迟、成功率统一通过 Prometheus 暴露，格式兼容 Phase 6 `BreakerMetric`：

| Prometheus 指标 | Phase 6 `BreakerMetric` 对应 |
|----------------|------------------------------|
| `harness_api_error_rate{platform}` | Harness 错误率飙升 >15% → 熔断 |
| `agent_decision_quality_score{agent}` | 决策质量下降 → 互监建议 |
| `tenant_gmv_daily{tenant}` | 单租户 GMV 暴跌 >30% → 熔断 |
| `agent_budget_utilization{agent}` | 月预算超额 >150% → 熔断 |
| `sop_scenario_active_count{scenario,tenant}` | 场景活跃数（G2 修正：Ch8.1 可观测性） |
| `sop_scenario_expired_total` | 场景过期累计（G2 修正） |
| `sop_scenario_template_usage{scenario}` | 模板使用频次（G2 修正） |

**验收项：**

| # | 验收条件 |
|---|---------|
| AC-5B-P6-08 | `agent.decision.made` 事件 payload 包含 `confidence` + `metrics.gmvImpact` + `metrics.marginImpact` |
| AC-5B-P6-09 | Harness 错误率、Agent 决策质量评分、租户 GMV 日变化通过 Prometheus 标准化暴露 |
| AC-5B-P6-10 | 所有新增事件格式文档化，标注"Phase 6 MonitorReport 可提取字段" |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 生成的决策不可靠 | Agent 做出错误调价/预算建议 | Constitution §5.2/§5.4 安全网兜底；高风险操作必须审批 |
| LLM 成本超预算 | 租户级成本失控 | 批量推理 + Haiku 为主 + 已有 budget 机制 + 缓存策略 |
| Amazon Advertising API 申请/审核 | Stream D 延期 | 提前申请；D2 可用沙箱环境先开发 |
| SOP 解析质量不稳定 | goalContext 提取错误 | 预览→确认→微调 三步流程；卖家可手动覆盖参数 |
| Agent 改造引入回归 | 现有审批流程中断 | 改造期间规则引擎作为 fallback（LLM 失败则降级回规则） |
| Phase 5B 审批体验太好导致卖家依赖人在环 | Phase 6 自治验收无法通过 | 审批模式三阶段渐进 + 自治成熟度指标追踪 + `autoApprovable` 字段 |
| SOP 与未来 Autonomy Constitution 冲突 | 自治期 Agent 行为不可控 | prompt 优先级栈 L0-L4 锁死，低层不可覆盖高层 |
| Phase 6 监督面板与租户面板混淆 | 信息泄漏 / 安全模型混乱 | 前端 route group 预分组，独立 RBAC |
| Phase 6 互监协议无法消费 Phase 5B 事件 | 自治监督缺数据源 | 事件 payload 包含 Phase 6 兼容字段 + Prometheus 标准化指标 |
| LLM 成本与租户规模未绑定 | AC-5B-16G（月 <$5）在大卖家场景失效 | 按租户 SKU 档位分级计费；批量推理窗口随商品数线性扩展；超限自动降级为低频轮询 |
| SOP 策略变更确认产生第二套待办体系 | 与审批中心 UX 割裂 | 高风险 SOP 变更复用 `approvals` 表的 `action: 'sop.activate'`，在审批中心统一展示 |
| 场景模板覆盖不足导致卖家困惑 | 卖家选了 `scale` 但无模板，回落到 `daily` | Phase 5B 先做 4 场景（launch/defend/clearance/daily）12 套模板，其余 fallback 到 daily 并提示"更多场景即将上线" |
| 场景预算与 Agent 预算三层冲突 | 复杂度不可控 | 决策不在场景层加预算上限（G4），由 Agent 执行层 + Constitution §5.2 兜底 |
| Amazon SP API 审批未通过 | Sprint 21 核心交付落空 | D2 降级验收：fixture/mock 返回真实格式数据；API 批复后 48h 内切真实数据（§4 Sprint 21 已写入） |

---

## Related

- [System Constitution v1.0](../system-constitution.md)
- [Phase 5 Plan](./phase5-plan.md)
- [Governance Gates](../governance-gates.md)
- [ADR-0001 · Paperclip 集成](../adr/0001-paperclip-integration.md)
