# Agent Native 改进方案：规则脚本 → 真正的 AI Agent

**日期：** 2026-03-30
**状态：** Draft
**背景：** Price Sentinel、Ads Optimizer、Inventory Guard、Product Scout 目前是纯规则引擎（if-else + 阈值比较），不符合系统宪法定义的 Agent Native 原则。系统已具备 LLM、DataOS（Feature Store + Decision Memory + Event Lake）、SOP 等全部基础能力，但这些 Agent 没有使用。

---

## 0. 核心问题

### 当前架构（脚本模式）

```
平台数据 → 数值比较(硬编码规则) → 超阈值审批 / 未超阈值自动执行
```

**Agent 不做任何决策，只做判断。**

### 目标架构（Agent Native）

```
平台数据 + DataOS 历史 + SOP 策略 + 记忆
       │
       ▼
  LLM 推理层（理解上下文，生成建议 + 理由）
       │
       ▼
  治理安全网（阈值兜底，防止 LLM 越权）
       │
       ▼
  审批 / 自动执行
       │
       ▼
  记录决策 + 跟踪结果 → 反馈到下次决策
```

**LLM 做决策，规则引擎做安全网。**

---

## 1. 已有但未用的能力

每个 Agent 的 `AgentContext` 已经提供了全部所需能力：

```typescript
interface AgentContext {
  // ✅ LLM 推理 — 所有 Agent 都有，但 3 个不用
  llm(params: { prompt: string; systemPrompt?: string }): Promise<{ text: string }>

  // ✅ DataOS — Feature Store + Decision Memory + Event Lake
  dataOS?: {
    getFeatures(platform, productId)     // 商品特征(转化率、销量、竞品价)
    recallMemory(agentId, context)       // 回忆历史决策
    recordMemory(input)                  // 记录本次决策
    writeOutcome(decisionId, outcome)    // 记录决策结果
    recordPriceEvent(...)                // 价格事件
    queryLakeEvents(...)                 // 查询事件流
    upsertFeature(...)                   // 更新特征
  }

  // ✅ 历史事件
  getRecentEvents(limit): Promise<RecentAgentEvent[]>

  // ✅ 市场上下文
  market?: { convertPrice(...) }

  // ✅ 审批
  requestApproval(params): Promise<void>

  // ✅ Harness（平台操作）
  getHarness(platform): TenantHarness
}
```

Price Sentinel 当前只用了 `dataOS.getFeatures`（读转化率调整阈值）和 `dataOS.recordMemory`（写操作记录）。**它有 LLM 但从不调用；有 recallMemory 但从不回忆。**

---

## 2. 改进方案：逐 Agent 详细设计

### 2.1 Price Sentinel → 智能定价顾问

#### 当前

```
输入: proposals[] (外部传入的调价建议)
逻辑: |delta%| > threshold ? 审批 : 自动执行
```

Agent 甚至**不生成调价建议**——它只是个审批门。

#### 改进后

```
Phase 1: 感知
  ├── 从各平台拉取所有商品当前价格 (Harness.getProducts)
  ├── 从 DataOS Feature Store 读取每个商品:
  │   ├── conv_rate_7d (7日转化率)
  │   ├── sales_velocity (销售速度)
  │   ├── competitor_prices (竞品价格，来自 Market Intel)
  │   └── inventory_level (库存水平，来自 Inventory Guard)
  └── 从 DataOS 回忆历史决策:
      └── recallMemory('price-sentinel', { productId, platform })
          → 上次调价时间、调价幅度、调价后转化率变化

Phase 2: 推理 (LLM)
  ├── systemPrompt: SOP 中的定价策略
  │   "你是一个定价策略专家。卖家经营高端护肤品，不打价格战..."
  ├── prompt 包含:
  │   ├── 每个商品的当前价格 + 特征数据
  │   ├── 竞品价格对比
  │   ├── 历史决策回忆 + 结果 (上次降价效果如何)
  │   └── 库存压力 (积压则可降价促销)
  └── LLM 输出 (structured JSON):
      [
        {
          productId: "xxx",
          proposedPrice: 24.99,
          reason: "竞品均价$22，但我们品牌溢价合理，小幅降至$24.99测试弹性",
          confidence: 0.8,
          riskLevel: "low"
        },
        {
          productId: "yyy",
          action: "hold",
          reason: "转化率5.2%表现良好，维持当前价格"
        }
      ]

Phase 3: 治理安全网 (规则引擎，保留现有逻辑)
  ├── |delta%| > 租户阈值 → requestApproval (附带 LLM 生成的 reason)
  ├── |delta%| ≤ 阈值 → 自动执行 updatePrice
  └── LLM 建议 "hold" → 不操作，只记录

Phase 4: 记忆
  ├── recordMemory: { productId, context: {当前特征}, action: {调价决策} }
  ├── recordPriceEvent: 价格变动记录
  └── 7 天后 writeOutcome: { 调价后转化率变化, 销量变化 }
```

#### 关键变化

| 维度 | 当前 | 改进后 |
|------|------|--------|
| 谁生成调价建议 | 外部传入 `proposals` | **Agent 自己分析生成** |
| 决策依据 | 单一阈值 | 竞品 + 转化率 + 库存 + 历史 + SOP |
| 审批内容 | "delta 12% > 10%" | "竞品降了15%，但我们是高端品牌，建议小降8%测试" |
| 学习能力 | 无 | 回忆上次决策效果，优化本次建议 |

---

### 2.2 Ads Optimizer → 智能广告策略师

#### 当前

```
输入: campaigns[] (从平台同步)
逻辑: if roas < target then budget *= 1.1
```

只有一个方向（加预算），一个策略（+10%），零分析。

#### 改进后

```
Phase 1: 感知
  ├── 从各平台拉取广告活动数据 (Harness.getAdsCampaigns)
  │   ├── 每个活动: 花费、ROAS、点击率、转化率、受众
  │   └── 历史趋势 (queryLakeEvents: ads_optimizer.*)
  ├── 从 DataOS 读取商品特征:
  │   └── 每个广告关联的商品的销量、利润率、库存
  └── 回忆历史决策:
      └── recallMemory('ads-optimizer', { campaignId })
          → 上次调整预算后 ROAS 怎么变的

Phase 2: 推理 (LLM)
  ├── systemPrompt: SOP 中的广告策略
  │   "你是广告优化专家。目标受众25-45岁女性，品牌曝光和直接转化并重..."
  ├── prompt 包含:
  │   ├── 每个活动的完整数据
  │   ├── 关联商品的利润率和库存
  │   ├── 历史调整记录和效果
  │   └── 季节/时间上下文
  └── LLM 输出 (structured JSON):
      [
        {
          campaignId: "aaa",
          action: "increase_budget",
          proposedDailyBudget: 550,
          reason: "ROAS 2.1 低于目标3.0，但该活动带来品牌搜索量提升，
                   建议适度增加预算并优化关键词",
          confidence: 0.7
        },
        {
          campaignId: "bbb",
          action: "decrease_budget",          // 新能力！
          proposedDailyBudget: 200,
          reason: "CPA 持续走高($15>$10目标)，建议降低预算并缩窄受众",
          confidence: 0.85
        },
        {
          campaignId: "ccc",
          action: "pause",                     // 新能力！
          reason: "连续7天ROAS<1，库存已充足无需推广",
          confidence: 0.9
        }
      ]

Phase 3: 治理安全网
  ├── 日预算 > 租户阈值 → requestApproval
  ├── action=pause → requestApproval (暂停广告必须人工确认)
  ├── 日预算 ≤ 阈值 + action=increase/decrease → 自动执行
  └── 单日预算变动 > 30% → requestApproval (Constitution §5.2)

Phase 4: 记忆
  ├── recordMemory: { campaignId, context: {活动数据}, action: {调整决策} }
  └── 3 天后 writeOutcome: { ROAS变化, CPA变化, 转化量变化 }
```

#### 关键变化

| 维度 | 当前 | 改进后 |
|------|------|--------|
| 决策方向 | 只能加预算 | **加/减/暂停/不动** 四种 |
| 策略 | 固定 +10% | LLM 根据具体情况决定幅度和方向 |
| 分析维度 | 仅 ROAS | ROAS + CPA + 库存 + 利润率 + 趋势 + SOP |
| 审批内容 | "预算$528>$500" | "ROAS低但带来品牌搜索量，建议适度增加并优化关键词" |

---

### 2.3 Inventory Guard → 智能库存管家

#### 当前

```
输入: inventoryLevels[] (从平台同步)
逻辑: if qty < safety → low; if qty ≤ 0 → oos; 建议补货 = safety×2 - qty
```

固定补货公式，不考虑销售速度、季节性、供应链周期。

#### 改进后

```
Phase 1: 感知
  ├── 从各平台拉取库存 (Harness.getInventoryLevels)
  ├── 从 DataOS Feature Store 读取每个 SKU:
  │   ├── sales_velocity_7d (7日日均销量)
  │   ├── sales_velocity_30d (30日日均销量)
  │   └── price, category, platform
  ├── 从订单数据估算周转天数:
  │   └── queryLakeEvents: order.created → 近期订单量趋势
  └── 回忆历史决策:
      └── recallMemory('inventory-guard', { productId })
          → 上次补货建议、实际到货时间、期间是否断货

Phase 2: 推理 (LLM)
  ├── systemPrompt: SOP 中的库存策略
  │   "护肤品有效期敏感，不要过度囤货。旺季(双11/黑五)提前3周备货..."
  ├── prompt 包含:
  │   ├── 每个 SKU: 当前库存、安全线、日均销量、趋势
  │   ├── 即将到来的促销/节日 (如果有)
  │   ├── 历史补货记录和到货周期
  │   └── 资金状况参考 (不要一次补太多占用资金)
  └── LLM 输出 (structured JSON):
      [
        {
          productId: "sku-001",
          urgency: "high",
          suggestedRestock: 80,
          reason: "日销12件，当前库存8件，预计0.7天断货。建议立即补80件(约7天量)",
          estimatedDaysUntilStockout: 0.7
        },
        {
          productId: "sku-002",
          urgency: "medium",
          suggestedRestock: 0,
          reason: "当前库存45件，日销2件，可支撑22天。但下月有促销活动，
                   建议2周后补货60件",
          scheduledAction: { in: "14d", restock: 60 }
        },
        {
          productId: "sku-003",
          urgency: "low",
          action: "reduce",
          reason: "库存200件但月销仅5件，周转天数>1年。
                   建议促销清仓或考虑下架",
          confidence: 0.7
        }
      ]

Phase 3: 治理安全网
  ├── suggestedRestock ≥ 补货审批门槛 → requestApproval
  ├── action=reduce (清仓/下架建议) → requestApproval
  ├── urgency=high + restock < 门槛 → 自动执行补货
  └── 总补货金额 > 月预算 X% → requestApproval

Phase 4: 记忆
  ├── recordMemory: { productId, context: {库存+销量}, action: {补货决策} }
  └── 到货后 writeOutcome: { 到货时间, 期间是否断货, 补货后周转天数 }
```

#### 关键变化

| 维度 | 当前 | 改进后 |
|------|------|--------|
| 补货量计算 | `safety×2 - qty`（固定公式） | **基于销售速度 + 到货周期 + 季节 + SOP** |
| 能力范围 | 只能建议补货 | **补货 + 清仓 + 延迟补货 + 预警** |
| 紧急度 | 无 | **基于预计断货天数排序** |
| 审批内容 | "补57件≥50件门槛" | "日销12件，0.7天断货，建议立即补80件(7天量)" |

---

### 2.4 Product Scout → 智能选品官

#### 当前

```
输入: products[] (从平台拉取)
逻辑: if qty ≤ 5 → low_inventory; if price ≥ 10000 → high_price
      + 合规关键词检查
```

只是给商品打标签，不做任何选品分析。

#### 改进后

```
Phase 1: 感知
  ├── 从各平台拉取商品目录
  ├── 从 DataOS 读取每个商品: 销量、转化率、利润率、竞品数据
  ├── Market Intel Agent 的最近分析结果
  └── 回忆历史选品决策

Phase 2: 推理 (LLM)
  ├── systemPrompt: SOP 中的选品策略
  │   "高端护肤品定位，客单价$30-$100，关注成分和功效卖点..."
  └── LLM 输出:
      ├── 热销品推荐 (转化率高 + 利润率好)
      ├── 问题品预警 (滞销 + 高库存)
      ├── 品类缺口建议 (基于市场数据)
      └── 合规风险提醒 (结合 AI 合规审查)

Phase 3: 治理安全网
  ├── 新品上架 → requestApproval (如果 SOP/governance 要求)
  └── 下架建议 → requestApproval

Phase 4: 记忆
  └── 追踪推荐商品后续表现
```

---

## 3. 统一的 LLM 决策层架构

四个 Agent 的改进遵循相同模式，可以抽象为一个可复用的决策层：

```typescript
interface AgentDecisionPipeline<TInput, TDecision> {
  // Phase 1: 感知 — 聚合所有上下文
  gather(ctx: AgentContext, input: TInput): Promise<DecisionContext>

  // Phase 2: 推理 — LLM 生成决策
  reason(ctx: AgentContext, context: DecisionContext): Promise<TDecision[]>

  // Phase 3: 治理 — 规则引擎兜底
  govern(ctx: AgentContext, decisions: TDecision[]): Promise<GovernedDecision<TDecision>[]>

  // Phase 4: 执行 + 记忆
  execute(ctx: AgentContext, governed: GovernedDecision<TDecision>[]): Promise<void>
}

interface DecisionContext {
  platformData: unknown           // Harness 拉取的实时数据
  features: Record<string, unknown>  // DataOS Feature Store
  memories: unknown[]             // DataOS Decision Memory (历史决策+结果)
  recentEvents: RecentAgentEvent[] // 近期事件
  sop: string | null              // 租户 SOP
  systemPrompt: string | null     // SOP 提取的行为指导
}

interface GovernedDecision<T> {
  decision: T
  governanceResult: 'auto_execute' | 'requires_approval' | 'blocked'
  governanceReason: string        // "delta 12% > threshold 10%"
}
```

---

## 4. 规则引擎的新角色：安全网

改进后规则引擎**不消失**，而是角色转变：

```
Before:  规则引擎 = 唯一决策者
After:   LLM = 决策者 → 规则引擎 = 安全网/门控

LLM 说 "降价 25%"
规则引擎说 "超过阈值 8%，需要审批"
→ 带着 LLM 的理由送去审批

LLM 说 "加预算到 $800"
规则引擎说 "超过 $500，需要审批"
→ 带着 LLM 的理由送去审批

LLM 说 "降价 5%"
规则引擎说 "在阈值内，放行"
→ 自动执行，但保留 LLM 的理由到审计日志
```

这给了卖家**双重保护**：
1. LLM 提供智能决策（理解业务上下文）
2. 规则引擎提供合规兜底（确保不越权）

---

## 5. 成本控制

LLM 调用有成本，需要合理控制：

| 策略 | 实现 |
|------|------|
| **批量推理** | 一次 LLM 调用分析所有商品，而非每个商品一次 |
| **模型分层** | 日常分析用 Haiku (便宜/快)，复杂决策用 Sonnet |
| **缓存** | 同一商品 24h 内特征未变则跳过重新分析 |
| **触发式** | 不是每次心跳都做全量分析，只在数据显著变化时触发 LLM |
| **预算封顶** | 每个 Agent 每月 LLM 调用费用上限（已有 budget 机制） |

估算（以 Price Sentinel 为例，100 个商品）：
- 每次分析 ~2000 token input + ~1000 token output
- 用 Haiku: ~$0.001/次
- 每天跑 4 次: ~$0.12/月
- 远低于当前 Agent 月预算 $50

---

## 6. 审批体验的质变

改进后审批内容从**技术参数变成业务建议**：

### Before (当前)

```json
{
  "action": "price.update",
  "payload": {
    "productId": "prod-123",
    "currentPrice": 29.99,
    "proposedPrice": 24.99,
    "deltaPercent": -16.67
  },
  "reason": "price delta -16.67% exceeds 15% threshold"
}
```

卖家看到：一堆数字。不知道为什么要调价。

### After (改进后)

```json
{
  "action": "price.update",
  "payload": {
    "productId": "prod-123",
    "productTitle": "高端保湿精华 30ml",
    "currentPrice": 29.99,
    "proposedPrice": 24.99,
    "deltaPercent": -16.67
  },
  "reason": "3个竞品近7天均降价10-15%，该商品7日转化率从5.2%降至3.1%。
             建议降至$24.99(降17%)测试价格弹性。
             上次类似调价(3月15日降12%)后转化率回升了40%。
             注意：您的SOP要求品牌保护，此降幅已接近底线。",
  "confidence": 0.75,
  "riskLevel": "medium",
  "llmModel": "claude-haiku"
}
```

卖家看到：**为什么要调价、依据是什么、历史效果如何、跟我的策略是否一致。**

---

## 7. 实施路径

| 阶段 | 内容 | 估时 |
|------|------|------|
| **A1** | 抽象 `AgentDecisionPipeline` 接口 + 工具函数 | 1d |
| **A2** | Price Sentinel 改造（LLM gather→reason→govern→execute） | 2d |
| **A3** | Ads Optimizer 改造（加入 decrease/pause 能力） | 2d |
| **A4** | Inventory Guard 改造（销售速度 + 断货预测） | 2d |
| **A5** | Product Scout 改造（选品分析 + 品类建议） | 1.5d |
| **A6** | 审批 payload 格式升级（含 LLM reason） | 1d |
| **A7** | 测试：LLM mock + 真实 API 集成测试 | 2d |
| **A8** | 成本监控 + 模型降级策略 | 0.5d |

**总计：** ~12d

### 与 UI/SOP 方案的依赖关系

```
UI P0 (7d)  ─────────────────────────────────────────→ UI 可用
SOP P0.5 (7d) ──────────────────────────────────────→ SOP 可写入
Agent Native A1-A5 (8.5d) ─────────────────────────→ Agent 真正智能
Agent Native A6-A8 (3.5d) ─────────────────────────→ 审批体验升级

三者可并行：
- UI 用现有 API 数据
- SOP 先落库，Agent 改造后消费
- Agent 改造后的审批 reason 直接提升 UI 审批中心体验
```

---

## 8. 验收标准

| # | 验收条件 |
|---|---------|
| 1 | Price Sentinel **自主生成调价建议**（而非接收外部 proposals） |
| 2 | 每个审批的 `reason` 字段含 **人类可读的业务分析**（非纯数值） |
| 3 | Ads Optimizer 能做出 **加预算 / 减预算 / 暂停 / 维持** 四种决策 |
| 4 | Inventory Guard 的补货建议基于 **销售速度**，而非固定 safety×2 |
| 5 | 四个 Agent 都使用 **Decision Memory**：回忆历史决策，记录本次，追踪结果 |
| 6 | SOP 中的定性策略（品牌保护/受众定位等）体现在 LLM 的 reason 中 |
| 7 | 规则引擎作为安全网，**所有 Constitution §5.2 门控仍然生效** |
| 8 | 单 Agent 月 LLM 成本 **< $5**（Haiku 为主） |
