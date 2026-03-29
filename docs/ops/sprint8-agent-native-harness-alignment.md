# Sprint 8 代码 · Agent-Native 原则 & Harness Engineering 原则对齐报告

**审查日期：** 2026-03-28  
**审查范围：** Sprint 8 新增代码（task-graph / loop-error / loop-context / autonomous-loop / 测试 / Shopify 集成测试）  
**审查基准：**
- Agent-Native Architecture 5 原则（Parity / Granularity / Composability / Emergent Capability / Improvement Over Time）
- Agent-Native 反模式清单（Cardinal Sin / Context Starvation / Orphan UI Actions / Workflow-shaped Tools 等）
- Harness Engineering 原则（Constitution §2.3 / §7.3）
- Sprint 7 对齐报告（Gap-01/02/03 跟踪）

---

## 第一层：Agent-Native Architecture 5 原则对齐

### 原则 1 · Parity（动作对等）

> 代理能做的，应该等价于用户能做的。每个实体必须有完整 CRUD。

#### Sprint 8 新增实体的 Parity 审查

| 实体 | 人类操作 | Agent 操作 | 状态 |
|------|---------|------------|------|
| **TaskGraph** | PM 设计任务分解 | `PmDecomposePort.decompose()` 生成 TaskGraph | ✅ |
| **TaskGraph — 排序** | 人工验证依赖无环 | `topologicalSort()` 自动验证 + `TaskGraphCycleError` | ✅ |
| **TaskGraph — 并行调度** | 人工判断可并行任务 | `parallelWaves()` 自动分组 | ✅ |
| **TaskGraph — 状态查询** | 人工检查任务进度 | `readyTasks()` / `isGraphComplete()` / `isGraphSuccessful()` | ✅ |
| **Loop 运行** | 人工发起 E2E 开发流程 | `AutonomousDevLoop.run()` 自动 9 阶段 | ✅ |
| **Loop 日志查询** | 人工查看运行状态 | `LoopContext.getSummary()` 返回完整阶段日志 | ✅ |
| **Loop 事件审计** | 人工查看 agent_events | `EventSink.insertEvent()` 每阶段自动写入 | ✅ |
| **Loop 错误分类** | 人工判断错误可重试性 | `LoopError.isRetryable()` / `isFatal()` 自动分类 | ✅ |

#### Sprint 7 Gap 跟踪

| Gap | Sprint 7 状态 | Sprint 8 修复 | 当前状态 |
|-----|-------------|-------------|---------|
| **Gap-01**: Codebase Intel 无 HTTP 端点 | 🔴 高 | ✅ Sprint 7 尾声已修复：`GET /internal/v1/codebase/query` + `POST /internal/v1/codebase/reindex` | ✅ 已关闭 |
| **Gap-02**: Codebase Intel 无缓存/重建 | 🟡 中 | ✅ Sprint 7 尾声已修复：`_cachedIndex` + `CODEBASE_INDEX_TTL_MS = 15min` | ✅ 已关闭 |
| **Gap-03**: 12 Agent 无 System Prompt | 🟡 中 | ⚠️ 未在 Sprint 8 代码中解决 | 🟡 延期至 Sprint 9 |

#### Port 接口的 Agent Parity 分析

Sprint 8 的核心设计决策是 **Port 接口模式**：每个 Agent 的能力被定义为一个 TypeScript 接口（Port），Loop 协调器通过这些 Port 调用 Agent 能力。

| Port | 人类等价操作 | Agent Port | Parity |
|------|------------|-----------|--------|
| `PmAgentPort.analyze()` | PM 人工分析需求文档 | ✅ 接口化 | ✅ |
| `ArchitectAgentPort.design()` | 架构师人工设计方案 | ✅ 接口化 | ✅ |
| `PmDecomposePort.decompose()` | PM 人工拆分任务 | ✅ 接口化 | ✅ |
| `CodeAgentPort.execute()` | 工程师人工编码 | ✅ 接口化 | ✅ |
| `QaAgentPort.runTests()` | QA 人工跑测试 | ✅ 接口化 | ✅ |
| `SecurityAgentPort.scan()` | 安全工程师人工扫描 | ✅ 接口化 | ✅ |
| `ApprovalPort.requestApproval()` | 人工审批 | ✅ 接口化 | ✅ |
| `DeployAgentPort.deploy()` | DevOps 人工部署 | ✅ 接口化 | ✅ |
| `SreAgentPort.monitor()` | SRE 人工监控 | ✅ 接口化 | ✅ |

**9/9 Port 完全对等。Agent 可以通过 Port 接口实现人类在每个开发阶段的全部操作。**

---

### 原则 2 · Granularity（原子粒度）

> 工具是原语；特性是由代理在循环中实现的结果。工具不应编码决策逻辑。

#### Sprint 8 工具粒度审查

| 工具/函数 | 是否原语 | 评价 |
|----------|---------|------|
| `topologicalSort(graph)` | ✅ 原语 | 纯函数：输入 TaskGraph → 输出排序后 Task[]，不编码业务判断 |
| `parallelWaves(graph)` | ✅ 原语 | 纯函数：输入 TaskGraph → 输出 Task[][]，不编码调度策略 |
| `readyTasks(graph)` | ✅ 原语 | 纯状态查询，不改变任何状态 |
| `isGraphComplete(graph)` | ✅ 原语 | 纯谓词函数 |
| `isGraphSuccessful(graph)` | ✅ 原语 | 纯谓词函数 |
| `LoopContext.beginStage()` | ✅ 原语 | 只做一件事：记录阶段开始 |
| `LoopContext.completeStage()` | ✅ 原语 | 只做一件事：记录阶段完成 |
| `LoopContext.failStage()` | ✅ 原语 | 只做一件事：记录阶段失败 |
| `LoopContext.getSummary()` | ✅ 原语 | 只做一件事：返回当前运行摘要 |
| `LoopError.isRetryable()` | ✅ 原语 | 纯谓词，不编码重试逻辑本身 |
| `LoopError.isFatal()` | ✅ 原语 | 纯谓词，不编码中止逻辑本身 |
| `AutonomousDevLoop.run()` | ⚠️ **协调器** | 不是原语 — 是将原语组合为 9 阶段流水线的**编排层**。这是设计意图：Loop 本身是"Agent 在循环中操作直到达成目标"的实现。 |

**协调器 vs 工作流工具 辨析：**

`AutonomousDevLoop.run()` **不是** Agent-Native 反模式中的"Workflow-shaped Tool"，因为：
1. 它不编码业务判断 — 每个阶段的判断由注入的 Port（Agent）完成
2. 它是"Agent 在循环中操作"的**基础设施** — 类似 Claude Code 的 agent loop runner
3. PM Agent 决定做什么，Architect Agent 决定怎么做，QA Agent 决定质量是否达标 — Loop 只管调度顺序
4. 修改行为方式：替换 Port 实现或调整 Config（`maxCodeReviewRetries`），不需要重构 Loop 代码

**结论：Sprint 8 工具粒度完全符合原则，11 个原语 + 1 个协调器（设计意图正确）。**

---

### 原则 3 · Composability（可组合性）

> 原子工具 + 对等能力 → 新特性可以只写 Prompt 来实现。

#### Sprint 8 的 Composability 实现

**核心洞察：AutonomousDevLoop 的 Port 接口使"新 Agent 特性 = 新 Prompt"成为可能。**

| 场景 | 如何实现 | 需要代码修改？ |
|------|---------|-------------|
| 让 PM Agent 更关注性能需求 | 修改 `PmAgentPort` 实现中的 system prompt | ❌ 不需要 |
| 让 QA Agent 关注 E2E 覆盖率而不仅仅行覆盖率 | 修改 `QaAgentPort` 实现中的测试策略 | ❌ 不需要 |
| 让 Architect Agent 优先选择已有模块扩展 | 修改 `ArchitectAgentPort` 实现中的 system prompt | ❌ 不需要 |
| 增加 Code Linting 阶段 | 在 Stage 06 的 `QaAgentPort` 中增加 lint 检查 | ❌ 不需要修改 Loop |
| 修改覆盖率门槛从 80% 到 90% | 修改 `autonomous-loop.ts` 中的 `80` → `90` | ⚠️ 需要改一行代码 |
| 增加第 10 个 Stage（如 Performance Test） | 在 `autonomous-loop.ts` 中添加新 Stage | ⚠️ 需要改代码 |

**Composability 评估：**
- **Port 层面**（Agent 行为）：✅ 纯 Prompt 可调，高度可组合
- **Loop 层面**（阶段结构）：⚠️ 9 阶段硬编码，新增阶段需改代码 — 这是 ADR-0004 D19 的设计决策（YAGNI），Phase 5 可根据需求演进为动态 Stage 注册

**覆盖率门槛硬编码分析：**

```typescript
if (!qa.passed || qa.coveragePct < 80)   // autonomous-loop.ts:258
```

`80` 是 Constitution §7.2 的硬性门槛，宪法条款本身是硬编码的。如果改为配置化（`config.minCoveragePct`），会引入"有人可能配低于 80%"的风险。**硬编码是正确的设计决策** — 宪法规定不可妥协。

---

### 原则 4 · Emergent Capability（涌现能力）

> 代理能完成设计时未明确预期的任务。

#### Sprint 8 的涌现能力支撑

| 涌现维度 | 支撑机制 | 评价 |
|---------|---------|------|
| **TaskGraph 灵活性** | `TaskKind` 含 8 种类型，但 `CodeAgentPort.execute()` 接受 `context: unknown` — Agent 可传递任意上下文 | ✅ |
| **Loop 异常处理的涌现** | 10 种 `LoopErrorCode` 覆盖已知失败；`isRetryable()` / `isFatal()` 让协调器根据错误类型自动决策 | ✅ |
| **Stage 09 自愈** | SRE 失败时自动创建 P0 bug Ticket → 触发新的 Loop 迭代 — **自发的涌现修复循环** | ✅ 优秀 |
| **Stage 06 重试** | `maxCodeReviewRetries` 允许 Agent 在失败后自动修复并重试 — Agent 从失败中学习 | ✅ |
| **未预期的 TaskGraph 拓扑** | `topologicalSort` + `parallelWaves` 对任意 DAG 结构都有效，PM Agent 可生成任何合法拓扑 | ✅ |

**Stage 09 → Stage 01 闭环是 Sprint 8 最重要的涌现能力：**

```
SRE 检测异常 → createTicket(type: 'bug', priority: 'P0')
  → 新 Ticket 进入下一次 Loop 的 Stage 01
    → PM 分析 → Architect 设计 → 自动修复 → 重新部署 → 监控
```

这实现了**无需人工干预的自愈循环**，是 Agent-Native 涌现能力的直接体现。

---

### 原则 5 · Improvement Over Time（随时间改进）

> 系统通过积累上下文和 Prompt 优化变得更好。

#### Sprint 8 的改进机制

| 机制 | 实现 | 位置 |
|------|------|------|
| **阶段日志积累** | 每次 Loop 运行产生 9 个 Stage 的结构化日志，写入 `agent_events` | `loop-context.ts:175-196` |
| **失败模式积累** | `LoopError.toJSON()` 结构化记录每次失败的 code/stage/context/details | `loop-error.ts:92-99` |
| **TaskGraph 记录** | 每次 Loop 运行的 TaskGraph 保存在 `LoopRunSummary.taskGraph` 中 | `loop-context.ts:48` |
| **Decision Memory 闭环** | `EventSink` 写入的 Loop 事件可被 Insight Agent 分析，形成 record → outcome → recall 反馈回路 | `loop-context.ts:52-62` + `autonomous-loop.ts:20` |
| **运行时间统计** | `StageLog.durationMs` 记录每个阶段耗时，供后续性能优化 | `loop-context.ts:110` |

**Sprint 8 新增的 Improvement 飞轮：**

```
Loop Run N:
  → Stage 日志写入 agent_events
  → Decision Memory 可记录 PM/Architect 的决策
  
Loop Run N+1:
  → PM Agent 可 recall() 上次类似 Ticket 的决策
  → Architect Agent 可参考上次的 approach + riskLevel
  → QA Agent 可参考上次的 failedTests 名单
  → SRE Agent 可参考上次的 anomalies 模式
```

**这是 Agent-Native "Improvement Over Time" 的标准实现。**

---

## 第二层：Agent-Native 反模式检查

### 反模式逐项审查

| 反模式 | Sprint 8 是否存在 | 说明 |
|--------|-----------------|------|
| **Cardinal Sin: Agent 只执行你的代码** | ❌ 不存在 | Loop 不编码 Agent 判断——PM 决定做什么，Architect 决定怎么做，QA 判断质量 |
| **Workflow-shaped Tools** | ❌ 不存在 | 11 个原语 + 1 个协调器（设计意图正确） |
| **Context Starvation** | ⚠️ 部分存在 | Gap-03 延续：12 Agent 仍无 system prompt，但 Sprint 8 的 Port 接口设计为 Sprint 9 定义 prompt 奠定了基础 |
| **Orphan UI Actions** | ❌ 不存在 | Loop 的每个 Stage 都有对应的 Agent Port |
| **Silent Actions** | ❌ 不存在 | 每个 Stage 转换都写入 `agent_events`（审计日志） |
| **Heuristic Completion** | ❌ 不存在 | Stage 09 `ctx.complete('success')` 是显式完成信号 |
| **Static Tool Mapping** | ❌ 不存在 | `CAPABILITIES_RESPONSE` 动态发现模式继续生效（v1.1.0 含 codebase 实体） |
| **Incomplete CRUD** | ❌ 不存在 | Sprint 8 新增实体（TaskGraph / Loop）为只读计算结果，不需要 CRUD |
| **Sandbox Isolation** | ❌ 不存在 | Loop 通过 `EventSink` 写入共享数据空间（agent_events） |
| **Agent as Router** | ❌ 不存在 | Agent 不只做路由，每个 Port 内 Agent 有完整推理能力 |
| **Request/Response Thinking** | ❌ 不存在 | Loop 是真正的循环——Stage 06 支持重试，Stage 09 支持自愈 |
| **Defensive Tool Design** | ❌ 不存在 | `CodeAgentPort.execute()` 接受 `context: unknown`，不过度约束 |

---

## 第三层：Harness Engineering 原则对齐

### §2.3 Harness 抽象原则

> Agent 代码绝对不能直接调用 Shopify/Amazon SDK。

#### Sprint 8 代码审查

| 文件 | 直接 SDK 调用 | 评价 |
|------|-------------|------|
| `task-graph.ts` | 无 | ✅ 纯数据结构 + 算法 |
| `loop-error.ts` | 无 | ✅ 纯错误类型 |
| `loop-context.ts` | 无 | ✅ 日志写入用注入的 `EventSink` |
| `autonomous-loop.ts` | 无 | ✅ 所有 Agent 操作通过 Port 接口 |
| `autonomous-loop.test.ts` | 无 | ✅ 全部 mock |
| `shopify.integration.test.ts` | ✅ 通过 `ShopifyHarness` | ✅ 不直调 Shopify SDK，通过 Harness 层 |

**Sprint 8 全部代码零平台 SDK 直调。**

#### Autonomous Loop 与 Harness 的关系分析

**关键发现：Sprint 8 的 Loop 设计天然遵守 Harness 原则。**

```
Loop Stage 05: CodeAgentPort.execute()
  ↓ 生产环境注入的实现：
  Backend Agent → 生成代码（含 Harness 调用，而非直调 SDK）
  ↓ 被检查者：
  Security Agent (Stage 06) → 可扫描是否有直调 SDK 的代码
```

这意味着 Loop 不仅自身不直调 SDK，还通过 Stage 06 的 Security Agent **强制检查生成的代码是否遵守 Harness 原则**——双重保障。

### §7.3 Harness 维护责任

#### Sprint 8 对 Harness 维护的贡献

| §7.3 要求 | Sprint 8 贡献 | 状态 |
|----------|-------------|------|
| 平台 API 变更后 48h 内更新 | Loop 框架为 Harness Agent（Sprint 9）提供了自动化基础设施 | ✅ 基础就绪 |
| Harness 接口向后兼容 | Sprint 8 未修改任何 Harness 接口 | ✅ 不触发 |
| 每个 Harness 方法有集成测试 | `shopify.integration.test.ts` 新增 5 个 Shopify 真实联调测试 | ✅ |

#### Shopify 集成测试 Harness 合规性

```
shopify.integration.test.ts 验证链路：
  ShopifyHarness.getProducts()    → Shopify Admin REST API (通过 Harness 层)
  ShopifyHarness.getProduct()     → Shopify Admin REST API (通过 Harness 层)
  ShopifyHarness.getProductsPage()→ Shopify Admin REST API (通过 Harness 层)
  ShopifyHarness.updatePrice()    → Shopify Admin REST API (通过 Harness 层)
```

全部通过 `ShopifyHarness` 类操作，不直接使用 `fetch` 或 Shopify SDK。✅

---

## 汇总

### 原则对齐总表

| 原则 | 检查项 | 合规 | Gap | 说明 |
|------|--------|------|-----|------|
| **Parity** | 9 Port 接口对等 | 9/9 | 0 | 每个人类角色都有 Agent Port |
| **Parity** | Sprint 7 Gap 跟踪 | 2/3 | 1 | Gap-01/02 已关闭；Gap-03 延期 |
| **Granularity** | 12 个工具/函数粒度 | 11 原语 + 1 协调器 | 0 | 协调器是设计意图 |
| **Composability** | Port 层可组合性 | ✅ | 0 | Agent 行为可纯 Prompt 调整 |
| **Composability** | Loop 层可组合性 | ⚠️ | 0 | 9 阶段硬编码（ADR-0004 YAGNI） |
| **Emergent Capability** | 自愈循环 | ✅ | 0 | Stage 09 → 新 Ticket → 新 Loop |
| **Improvement Over Time** | 日志/记忆积累 | ✅ | 0 | agent_events + Decision Memory 闭环 |
| **反模式** | 12 项检查 | 11/12 | 1 | Context Starvation（Gap-03）延续 |
| **Harness §2.3** | 零 SDK 直调 | ✅ | 0 | 全部通过 Port 或 Harness |
| **Harness §7.3** | 集成测试 | ✅ | 0 | Shopify 真实联调 5 测试 |

### 行动项状态（Sprint 7 → Sprint 8）

| # | 行动项 | Sprint 7 状态 | Sprint 8 状态 |
|---|--------|-------------|-------------|
| A-01 | Codebase Intel HTTP query 端点 | 🔴 Gap | ✅ 已关闭 |
| A-02 | Codebase Intel reindex 端点 | 🔴 Gap | ✅ 已关闭 |
| A-03 | Capabilities Discovery 更新 | 🔴 Gap | ✅ v1.1.0 含 codebase |
| A-04 | CodebaseIndex 内存缓存 | 🟡 Gap | ✅ 15min TTL |
| A-05 | Agent System Prompt | 🟡 Gap | 🟡 **延期至 Sprint 9** |
| A-06 | Harness Agent 监控工具链 | 🟡 计划 | 🟡 Sprint 9 范围 |

### 新增行动项（Sprint 9）

| # | 行动项 | 优先级 | 说明 |
|---|--------|--------|------|
| A-07 | 为 PM Agent + CTO Agent 定义 system prompt（解决 Gap-03 Context Starvation） | 🟡 中 | Sprint 9 Day 1 首要任务；至少包含：角色描述 + 可用工具列表 + 判断准则 |
| A-08 | 覆盖率门槛可配置化评估 | ⚪ 低 | 当前 80% 硬编码正确（宪法条款），Phase 5 评估是否需要 per-tenant 可配 |
| A-09 | Loop Stage 动态注册评估 | ⚪ 低 | 当前 9 Stage 硬编码正确（ADR-0004），Phase 5 评估是否需要动态 Stage |

---

## 良好实践（Sprint 8 新增，值得记录）

| 实践 | 位置 | 对应原则 |
|------|------|---------|
| **Port 接口模式** — 每个 Agent 能力定义为 TypeScript 接口，支持 mock 测试和生产环境注入 | `autonomous-loop.ts:26-120` | Parity + Granularity |
| **9 阶段完全对应宪法 §7.1 代码演进流程** — 不遗漏、不新增阶段 | `autonomous-loop.ts:172-356` | Parity（与宪法对等） |
| **Stage 06 QA+Security 并行 + 重试** — `Promise.all` 并行检查 + `maxCodeReviewRetries` 自动重试 | `autonomous-loop.ts:248-287` | Emergent Capability（Agent 从失败中学习） |
| **Stage 09 → 新 Ticket 自愈闭环** — SRE 异常自动创建 P0 Ticket，触发新 Loop | `autonomous-loop.ts:336-345` | Emergent Capability（自愈） |
| **LoopError exhaustive switch + never 兜底** — 10 种错误码编译期保证全覆盖 | `loop-error.ts:46-71` | Granularity（错误分类清晰） |
| **EventSink 注入 + 失败静默** — 日志写入永不阻塞 Loop 执行 | `loop-context.ts:175-196` | 容错设计 |
| **Shopify 集成测试 env-skip 模式** — env 缺失自动跳过，CI 安全 | `shopify.integration.test.ts:27-34` | 测试工程最佳实践 |

---

## 结论

**Sprint 8 代码与 Agent-Native 5 原则和 Harness Engineering 原则高度对齐。**

- **5 原则合规**：Parity / Granularity / Composability / Emergent Capability / Improvement Over Time — 全部满足
- **12 项反模式**：11/12 无问题，唯一 1 项（Context Starvation / Gap-03）为 Sprint 7 延续的已知项，Sprint 9 解决
- **Harness 原则**：零 SDK 直调 + Shopify 真实联调测试通过
- **Sprint 7 Gap**：3 个 Gap 中 2 个已关闭，1 个延期至 Sprint 9

**Sprint 8 最重要的 Agent-Native 贡献：**
1. **Port 接口模式** — 将 Agent 能力标准化为可注入接口，是 Agent-Native Parity 的工程化最佳实践
2. **Stage 09 → 新 Ticket 自愈闭环** — 实现了无需人工干预的涌现自修复循环
3. **EventSink → Decision Memory 飞轮** — 为 "Improvement Over Time" 提供了生产级数据管道

---

*Sprint 8 Code · Agent-Native & Harness Engineering Alignment Report · 2026-03-28*
