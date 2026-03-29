# Sprint 7 代码 · Agent-Native 原则 & Harness Engineering 原则对齐报告

**审查日期：** 2026-03-28  
**审查基准：**
- Agent-Native Architecture Principles（Parity / Granularity / Composability / Emergent Capability / Improvement Over Time）
- Harness Engineering 原则（Constitution §2.3 / §7.3）

---

## 第一层：Agent-Native Architecture 对齐

### 原则 1 · Parity（动作对等）

> 代理能做的，应该等价于用户能做的。每个实体必须有完整 CRUD，不允许"孤儿动作"。

#### CRUD 完整性审查

| 实体 | Create | Read | Update | Delete | 状态 |
|------|--------|------|--------|--------|------|
| **Events（事件湖）** | ✅ `POST /lake/events` | ✅ `GET /lake/events` | N/A（事件不可变，审计日志设计） | N/A | ✅ |
| **PriceEvents（价格事件）** | ✅ `POST /lake/price-events` | ✅ `GET /lake/price-events` | N/A（追加型） | N/A | ✅ |
| **Features（特征快照）** | ✅ `POST /features/upsert` | ✅ `GET /features` + `GET /features/:p/:id` | ✅ `POST /features/upsert`（ON CONFLICT） | ✅ `DELETE /features/:p/:id` | ✅ |
| **Decisions（决策记忆）** | ✅ `POST /memory/record` | ✅ `POST /memory/recall` + `GET /memory/decisions` | ✅ `POST /memory/outcome`（写结果） | ✅ `DELETE /memory/decisions/:id` | ✅ |
| **Insight（洞察触发）** | ✅ `POST /insight/trigger` | 结果写入 Decisions，不需独立 Read | N/A | N/A | ✅ |
| **CodebaseIndex（代码索引）** | ✅ `buildCodebaseIndex()`（库函数） | ✅ `queryCodebase()`（库函数） | N/A（由文件系统驱动） | N/A | ⚠️ **见 Gap-01** |

#### 动态能力发现（Dynamic Capability Discovery）

```
GET /internal/v1/capabilities → 返回完整操作列表
```

`CAPABILITIES_RESPONSE` 实现了 Agent-Native 的 Discovery 模式：
- 每个实体 (`events` / `priceEvents` / `features` / `decisions`) 列出全部操作
- 每个操作含 `method` / `path` / `description` / `parameters`
- 代理可通过一次 GET 自主发现所有可用能力 ✅

**这是 Agent-Native 的优秀实践**，等价于 HealthKit 的 `list_available_types` 模式。

#### 发现的 Parity Gap

| ID | 问题 | 位置 | 优先级 |
|----|------|------|--------|
| **Gap-01** | `codebase-intel.ts` 仅为库函数，**无 HTTP 端点**；注册在 Paperclip 的 Codebase Intel Agent 无法通过 API 调用 `queryCodebase` | `codebase-intel.ts` | 🔴 高 |
| **Gap-02** | Codebase Intel Agent 种子配置 `indexInterval: '15m'` 但无重建索引的 `POST /codebase/reindex` 端点；代理无法主动触发重索引 | `devos-full-seed.ts` | 🟡 中 |
| **Gap-03** | 12 个 Agent 已注册到 Paperclip，但**无任何 system prompt 定义**；代理不知道什么时候用哪个工具（Context Starvation 反模式） | `scripts/devos-full.seed.ts` | 🟡 中 |

---

### 原则 2 · Granularity（原子粒度）

> 工具是原语；特性是由代理在循环中实现的结果。工具不应编码决策逻辑。

#### 代码审查

**DataOS Internal API 路由：**

| 操作 | 是否原语 | 评价 |
|------|---------|------|
| `POST /memory/record` | ✅ | 只做一件事：存储决策 |
| `POST /memory/recall` | ✅ | 只做一件事：语义检索 |
| `POST /memory/outcome` | ✅ | 只做一件事：写结果 |
| `DELETE /memory/decisions/:id` | ✅ | 只做一件事：软删除 |
| `POST /insight/trigger` | ⚠️ | 触发整个 Insight 分析循环——偏向"工作流工具"而非纯原语；但对于批处理 Agent tick 是可接受的 |

**DevOS Bridge 函数：**

| 函数 | 是否原语 | 评价 |
|------|---------|------|
| `defaultPriorityForType()` | ✅ | 纯函数映射，无副作用 |
| `defaultSlaForPriority()` | ✅ | 纯函数映射 |
| `isDevOsTicket()` | ✅ | 纯验证器 |
| `buildSreBootstrapTicket()` | ⚠️ | 封装了 ticket 构建逻辑；但作为引导脚本工厂函数（非 Agent tool）是可接受的 |
| `buildCodebaseIndex()` | ✅ | 原语：扫描目录，返回索引 |
| `queryCodebase()` | ✅ | 原语：按 query 查询索引，返回结果 |
| `flattenAgents()` | ✅ | 纯树遍历，无副作用 |

**结论：Sprint 7 代码粒度整体良好，无"工作流工具"反模式。`POST /insight/trigger` 是边界案例，在 Agent tick 语义下可接受。**

---

### 原则 3 · Composability（可组合性）

> 原子工具 + 对等能力 → 新特性可以只写 Prompt 来实现。

**现有 DataOS API 支持的代理组合路径：**

```
Agent 决策循环（可纯由 Prompt 驱动）：
  1. recall()       → 检索历史决策上下文
  2. [Agent 推理]   → 基于记忆和当前状态决策
  3. [Harness 调用] → 通过 Harness 执行操作
  4. record()       → 存储本次决策
  5. writeOutcome() → 下次 tick 时回写结果
  6. insight/trigger → 批量分析历史决策质量
```

这个循环正是 DevOS Autonomous Loop 的核心数据层支撑，完全由原语组合实现，无需修改代码即可调整 Agent 行为。✅

**`/internal/v1/capabilities` 实现了 Composability 的前提条件**：代理可在运行时发现所有操作，而不依赖硬编码工具列表。✅

---

### 原则 4 · Emergent Capability（涌现能力）

> 代理能完成设计时未明确预期的任务。

**`/capabilities` 端点支撑涌现：**
- 代理可自行发现 `sinceMs` 时间过滤参数，组合出"查最近 1 小时的价格事件"这类未被显式设计的查询
- Codebase Intel 的 `queryCodebase()` 支持自由文本查询，含词级模糊匹配 — 天然支持未预期查询

**限制：Gap-01 阻塞了 Codebase Intel 的涌现能力**：代理在 Paperclip 内部无法调用 `queryCodebase`，因为缺少 HTTP 端点。

---

### 原则 5 · Improvement Over Time（随时间改进）

> 系统通过积累上下文和 Prompt 优化变得更好。

**Decision Memory 是该原则的直接实现：**

| 机制 | 实现 | 位置 |
|------|------|------|
| 积累上下文 | `record()` 存储每次决策 + context | `decision-memory.ts` |
| 学习反馈 | `writeOutcome()` 关闭反馈回路 | `decision-memory.ts` |
| 基于历史决策 | `recall()` 语义检索过去同类决策 | `decision-memory.ts` |
| 批量洞察 | `insight/trigger` 分析历史决策质量 | `insight-agent.ts` |
| minSim 区分模式 | 真实 embedding 时 0.75，确定性时 0.01 | `decision-memory.ts` L27 |

Sprint 7 的 `minSimilarity` 修复（P2-04）直接提升了基于真实 embedding 的语义召回质量，是"随时间改进"机制的保障。✅

---

## 第二层：Harness Engineering 原则对齐

### §2.3 Harness 抽象原则

> 所有平台操作必须通过 PlatformHarness 接口；Agent 代码绝对不能直接调用 Shopify/Amazon SDK。

#### Sprint 7 代码审查

| 文件 | 直接 SDK 调用 | 评价 |
|------|-------------|------|
| `decision-memory.ts` | 无 | ✅ |
| `feature-store.ts` | 无 | ✅ |
| `metrics.ts` | 无 | ✅ |
| `server.ts` | 无 | ✅ |
| `ticket-protocol.ts` | 无 | ✅ |
| `devos-org-chart.ts` | 无 | ✅ |
| `devos-full-seed.ts` | 无 | ✅ |
| `codebase-intel.ts` | 无（只访问本地文件系统） | ✅ |
| `scripts/devos-full.seed.ts` | 无 | ✅ |

**Sprint 7 全部代码零平台 SDK 直调。**

#### TenantHarness 接口现状

`base.harness.ts` 定义的 `TenantHarness` 接口（Phase 1-3 已稳定）：

```typescript
interface TenantHarness {
  getProduct(productId: string): Promise<Product | null>
  getProducts(opts?): Promise<Product[]>
  getProductsPage(opts?): Promise<PaginatedResult<Product>>
  updatePrice(productId: string, price: number): Promise<void>
  updateInventory(productId: string, qty: number): Promise<void>
  getOrders(opts?): Promise<Order[]>
  getOrdersPage(opts?): Promise<PaginatedResult<Order>>
  replyToMessage(threadId: string, body: string): Promise<void>
  getOpenThreads(): Promise<Thread[]>
  getAnalytics(range: DateRange): Promise<Analytics>
}
```

| Constitution §2.3 要求 | 现状 | 状态 |
|------------------------|------|------|
| `getProducts()` | ✅ `getProducts` + `getProductsPage` | ✅ |
| `updatePrice()` | ✅ 含 `>15%` 审批门控 | ✅ |
| `getOrders()` | ✅ `getOrders` + `getOrdersPage` | ✅ |
| `replyToMessage()` | ✅（DG-01 降级为 webhook-only，有 ADR 记录） | ⚠️ 已知偏差 |
| `getAnalytics()` | ✅ | ✅ |

---

### §7.3 Harness 维护责任

#### SLA 配置审查

`devos-full-seed.ts` Harness Agent 种子：

```typescript
{
  id: 'harness-agent',
  model: 'claude-sonnet-4-6',
  trigger: 'api-change',           // ✅ 响应 API 变更事件
  slaResolveHours: 48,             // ✅ Constitution §7.3 要求 48h 内
  config: {
    role: 'platform',
    monitoredApis: ['shopify', 'amazon', 'tiktok', 'shopee'],  // ✅ 四平台全覆盖
  }
}
```

#### Harness Agent 工具链完整性

| §7.3 要求 | Sprint 7 状态 | 缺口 |
|----------|-------------|------|
| 平台 API 变更后 48h 内更新 Harness | 种子配置 `slaResolveHours: 48` ✅ | Harness Agent 无监控平台 changelog 的工具（Sprint 9 实现） |
| Harness 接口向后兼容 | `ticket-protocol.ts` 新增 `coordination` 不删旧字段 ✅ | |
| 每个 Harness 方法有集成测试 | Shopify/Amazon/TikTok 等 Harness 已有（Phase 1-3）| Sprint 7 未添加新 Harness 方法，无需新增测试 |

#### Harness Agent 实现缺口（Sprint 9 前置条件）

| 功能 | 状态 | 计划 Sprint |
|------|------|------------|
| 监控 Shopify/Amazon changelog | 未实现 | Sprint 9 |
| 检测接口变更 → 生成 Harness 补丁 | 未实现 | Sprint 9 |
| 自动提交 PR | 未实现 | Sprint 9 |
| `api-change` 触发器的实际来源 | 未定义 | Sprint 9 |

**这些均不属于 Sprint 7 范围（Phase 4 Plan §S9 任务 9.9），不计为 Sprint 7 缺陷。**

---

## 汇总：发现与建议

### 🔴 高优先级 Gap（Sprint 8 开始前解决）

#### Gap-01：Codebase Intel 无 HTTP 端点

**问题：** `codebase-intel.ts` 是纯库函数，Codebase Intel Agent 注册在 Paperclip 后无法通过 API 调用查询。

**影响：** 违反 Agent-Native Parity 原则 — 人类可以调用库函数，但 Paperclip Agent 无法通过 HTTP 发起查询。

**建议修复：** 在 `apps/dataos-api/src/internal-routes.ts` 添加：

```typescript
// GET /internal/v1/codebase/query?q=Price+Sentinel
app.get('/internal/v1/codebase/query', async (request, reply) => {
  if (!requireKey(request, reply, internalKey)) return
  const q = (request.query as Record<string, string>).q ?? ''
  const index = buildCodebaseIndex(MONOREPO_ROOT)
  const result = queryCodebase(index, q)
  return reply.send(result)
})

// POST /internal/v1/codebase/reindex  (主动触发重建)
app.post('/internal/v1/codebase/reindex', async (request, reply) => {
  if (!requireKey(request, reply, internalKey)) return
  const index = buildCodebaseIndex(MONOREPO_ROOT)
  return reply.send({ ok: true, entriesCount: index.entries.length, scannedAt: index.scannedAt })
})
```

同时将这两个端点加入 `CAPABILITIES_RESPONSE`，完成 Discovery 对接。

**预估工作量：** 2-3 小时（含测试）。

---

### 🟡 中优先级 Gap（Sprint 8 内解决）

#### Gap-02：Codebase Intel 缺少缓存/定时重建机制

**问题：** `indexInterval: '15m'` 是种子配置中的意图，但无实现。每次 HTTP 请求都会重新扫描文件系统（同步阻塞）。

**建议：** 在 `server.ts` 或独立 worker 中加入定时重建逻辑，并将索引缓存在内存中：

```typescript
// server.ts
let cachedIndex: CodebaseIndex | null = null
const INDEX_TTL_MS = 15 * 60 * 1000

function getCodebaseIndex(): CodebaseIndex {
  if (!cachedIndex || Date.now() - new Date(cachedIndex.scannedAt).getTime() > INDEX_TTL_MS) {
    cachedIndex = buildCodebaseIndex(MONOREPO_ROOT)
  }
  return cachedIndex
}
```

#### Gap-03：12 Agent 无 System Prompt

**问题：** Agent 注册后缺少 system prompt，无法知道何时使用哪个工具（Context Starvation 反模式）。

**建议：** Sprint 8 在实现 Autonomous Loop Stage 02-05 时，同步为对应 Agent 定义 system prompt（CTO/PM/Architect/Backend/QA/DevOps/SRE）。至少在 Sprint 8 Day 1 为 `cto-agent` 和 `pm-agent` 补充。

---

### ✅ 良好实践（值得记录）

| 实践 | 位置 | 对应原则 |
|------|------|---------|
| `GET /capabilities` 实现动态能力发现 | `internal-routes.ts` L71-113 | Granularity + Emergent Capability |
| Decision Memory 完整 CRUD（create/recall/update outcome/list/delete） | `internal-routes.ts` + `decision-memory.ts` | Parity (CRUD Completeness) |
| `minSimilarity` 区分真实/确定性 embedding | `decision-memory.ts` L27 | Improvement Over Time |
| `record → writeOutcome → recall` 构成完整反馈回路 | `decision-memory.ts` | Improvement Over Time |
| `DevOsAgentTrigger` union type 限制触发器类型 | `devos-full-seed.ts` | Granularity（工具边界清晰） |
| `harness-agent` 配置 `trigger: 'api-change'` — 事件驱动而非轮询 | `devos-full-seed.ts` | Agent-Native 事件响应模式 |
| `codebase-intel.ts` 查询分离：`buildCodebaseIndex` + `queryCodebase` 两个独立原语 | `codebase-intel.ts` | Granularity（原子化） |
| `soft-delete` 而非物理删除，确保代理决策日志不可破坏 | `decision-memory.ts` + `feature-store.ts` | Improvement Over Time（历史数据保全） |

---

## 行动项清单

| # | 行动项 | 优先级 | Sprint | 文件 |
|---|--------|--------|--------|------|
| A-01 | 为 Codebase Intel 添加 `GET /internal/v1/codebase/query` HTTP 端点 | 🔴 高 | S8 Day 1 | `internal-routes.ts` |
| A-02 | 为 Codebase Intel 添加 `POST /internal/v1/codebase/reindex` 端点 | 🔴 高 | S8 Day 1 | `internal-routes.ts` |
| A-03 | 将 codebase 操作加入 `CAPABILITIES_RESPONSE` 完成 discovery 对接 | 🔴 高 | S8 Day 1 | `internal-routes.ts` |
| A-04 | 为 CodebaseIndex 添加内存缓存 + 定时重建（15 min TTL） | 🟡 中 | S8 Day 2 | `server.ts` |
| A-05 | 为 `cto-agent` + `pm-agent` 定义初始 system prompt | 🟡 中 | S8 Day 1 | `scripts/` 或 Paperclip |
| A-06 | Sprint 9：实现 Harness Agent 监控 → PR 提交工具链 | 🟡 中 | S9 | `packages/devos-bridge/` |
