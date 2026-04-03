# Agent 基础设施升级 · Claude Code 设计理念整合实施计划

**日期：** 2026-04-03
**修订：** 2026-04-03 v3（风险评估 v2 + 宪法对齐审计）
**状态：** Draft
**前序：** Phase 5B Sprint 20（Agent Native 改造）
**参考：** [Claude Code 官方文档](https://code.claude.com/docs/en/overview)、[phase5b-daily-execution-plan.md](./phase5b-daily-execution-plan.md)、[agent-native-upgrade-plan.md](./agent-native-upgrade-plan.md)

---

## 0. 背景与动机

Phase 5B Sprint 20 正在将 ElectroOS 的 3 个高频 Agent（Price Sentinel、Ads Optimizer、Inventory Guard）从规则脚本升级为真正的 AI Agent（`DecisionPipeline` 五阶段管线）。在改造窗口期引入 [Claude Code](https://github.com/anthropics/claude-code) 项目验证过的 Agent 基础设施模式，避免二次改造。

### v2 修订摘要（风险评估）

> 风险评估发现 5 个关键问题，v2 逐一修正：
>
> | 风险 | 修订措施 |
> |------|---------|
> | **R1** Constitution 文件化引入 prompt 篡改攻击面 | 改为**构建时内联**（`.md` → `.ts` 常量），运行时不读文件系统 |
> | **R2** autoApprove 绕过 Constitution §5.2 安全网 | Phase 5B 期间**仅定义接口**，不启用 autoApprove；Phase 6 校准后开放 |
> | **R3** Hook abort 导致审计链断裂 | abort 时强制 `logAction`；govern 与 execute 之间禁止 abort |
> | **R4** D1/D2 与 Sprint 20 同文件冲突 | D1 延后至 Day 25；D2 拆分为类型定义（Day 21）+ 集成（Day 26） |
> | **R5** Memory 注入膨胀 token 成本 | 不新建 `memories` 字段，增强已有 `pastDecision` + token 上限 |

### v3 修订摘要（宪法对齐审计）

> 逐条对齐系统宪法 7 项绝对约束，发现 7 个缺口 + 1 个代码重复，新增 12 个对齐 CARD：
>
> | 宪法条款 | 缺口 | 对齐措施 |
> |---------|------|---------|
> | §1 治理尊重 | 域规则可能注入治理参数；agentOverrides 无钳位；Agent defaultGovernance 优先级不明 | ALIGN-01/02/03 |
> | §2 不可逆保护 | Hook skip execute 不记录审计 | ALIGN-04 |
> | §3 审计链 | Hook 执行本身无审计；Agent 定义变更无版本追踪 | ALIGN-05/06 |
> | §4 预算红线 | Hook handler 可消耗预算但不受检查 | ALIGN-07 |
> | §5 内部保密 | Constitution/Agent prompt 在 Git 中可见；Memory 注入可能泄露内部决策 | ALIGN-08/09 |
> | §6 商业目标 | Agent system prompt 未明确 SOP 优先级 | ALIGN-10 |
> | §7 安全默认 | agentOverrides 可放松审批模式 | ALIGN-11 |
> | 代码重复 | D4-02 与已有 `approval-progressive.ts` 重复 | ALIGN-12 |
>
> 详见文末 **宪法对齐审计** 章节。

### 核心借鉴

| Claude Code 设计理念 | patioer 当前状态 | 目标状态 |
|---------------------|-----------------|---------|
| `CLAUDE.md` 分层记忆 | Constitution 硬编码在 `prompt-stack.ts` | 文件化编辑、**构建时内联**、可版本控制 |
| Subagent 声明式配置 | Agent 通过 `registerRunner()` 硬绑定 | markdown + YAML frontmatter 声明式定义 |
| Lifecycle Hooks | `LoopContext` 纯记录，无拦截能力 | 可编程的生命周期钩子（含安全约束） |
| Auto Memory | Decision Memory 存在但 Agent 使用率低 | 增强已有 `pastDecision`、智能筛选记忆 |
| Permission Modes | 全局两档 `approval_required/informed` | 逐 Agent 粒度权限配置（autoApprove 延后） |
| Plugin System | `registerHarnessFactory` 平台级注册 | 目录结构化插件 |
| Worktree Isolation | DevOS 串行处理 Ticket | Phase 6 PoC 调研 |
| Agent Teams | HeartbeatRunner 逐个串行 | Phase 6 PoC 调研 |

### 排期策略

- **D1–D4** 与 Phase 5B Sprint 20（Day 21–30）**错峰交织**——等 Price Sentinel 改造完成后再改 prompt-stack
- **D5–D6** 安排在 Sprint 21（Day 31–40）期间，与广告/健康 Harness 工作并行
- **D7–D8** 降级为 Phase 6 **PoC 调研**（非实施），Phase 5B 结束后用 1 周验证可行性

---

## 1. 优先级排序

```
D1 Constitution 文件化 + 构建时内联   ← Sprint 20 Day 25（错峰）          🔴 P0
D2 Pipeline Hooks 事件系统          ← Sprint 20 Day 21 类型 / Day 26 集成 🔴 P0
D3 Agent Auto-Memory 增强          ← Sprint 20 Day 27（增强已有机制）     🟡 P1
D4 逐 Agent 权限配置               ← Sprint 20 Day 28–29               🟡 P1
D5 声明式 Agent 配置文件            ← Sprint 21 可独立执行               🟡 P1
D6 平台插件目录结构                 ← Sprint 21 Harness 扩展窗口         🟢 P2
D7 DevOS Worktree 并行             ← Phase 6 PoC 调研                  🟢 P2
D8 Agent Team 场景编排             ← Phase 6 PoC 调研                  🟢 P2
```

---

## D1 · Constitution 文件化 + 构建时内联

**嵌入时机：** Sprint 20 Day 25–26（Price Sentinel 改造完成后，避免同文件冲突）
**耗时：** 1.5d (BE)
**前置：** CARD-5B-D21-01（DecisionPipeline）完成

### 问题

当前 `SYSTEM_CONSTITUTION_PROMPT` 是 `prompt-stack.ts` 第 32–41 行的字符串常量，平台策略是同文件第 53–69 行的 `Record<string, string>`。

```
packages/agent-runtime/src/prompt-stack.ts
├── SYSTEM_CONSTITUTION_PROMPT  ← 硬编码字符串
├── PLATFORM_POLICIES           ← 硬编码 Record
├── buildPromptStack()          ← 组装函数
└── flattenPromptStack()        ← 兼容适配
```

改行为 = 改代码 = 改仓库 = 走 PR。这违反了 Claude Code 的核心洞察：**指令应该是配置，不是代码**。

### 目标架构

借鉴 Claude Code 的 `CLAUDE.md` + `.claude/rules/` 分层编辑机制，但**不做运行时文件读取**。

> ⚠️ **v2 安全决策：** 原方案在运行时通过 `fs.readFileSync` 读取 `.md` 文件。风险评估发现
> 这会引入 prompt 篡改攻击面——容器内文件系统可写时，攻击者可修改 Constitution 覆盖安全约束。
>
> **修正：** 采用**构建时内联**策略——`.md` 文件仅在开发时编辑，`tsc` 编译前通过脚本生成
> `.ts` 常量文件。运行时只引用不可变的 JS 模块，消除文件系统依赖。

```
packages/agent-runtime/
├── constitution/                     # 人类编辑入口（Git 版本控制）
│   ├── CONSTITUTION.md              # L0 — 系统宪法（不可覆盖）
│   ├── rules/
│   │   ├── pricing.md               # 定价域规则（frontmatter: scope: price-sentinel）
│   │   ├── ads.md                   # 广告域规则
│   │   ├── inventory.md             # 库存域规则
│   │   ├── product-scout.md         # 选品域规则
│   │   └── support.md               # 客服域规则
│   └── platform-policies/
│       ├── amazon.md                # Amazon 平台硬约束
│       ├── shopify.md               # Shopify 平台约束
│       ├── tiktok.md                # TikTok Shop 约束
│       ├── shopee.md                # Shopee 约束
│       └── walmart.md               # Walmart 约束
├── src/
│   ├── generated/                   # ⚡ 构建时自动生成（.gitignore）
│   │   └── constitution-data.ts     # 所有 .md 编译为 TS 常量
│   ├── constitution-loader.ts       # 运行时：从 generated/ 读取常量
│   └── prompt-stack.ts              # 消费层（不变）
```

### 操作

> **🃏 CARD-CI-D1-01 · Constitution 文件化 + 构建时内联生成器**
>
> **类型：** 重构
> **耗时：** 1d
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：**
> 1. 创建 `packages/agent-runtime/constitution/CONSTITUTION.md`：
>    - 将 `SYSTEM_CONSTITUTION_PROMPT` 内容迁移为 markdown
>    - 增加结构化章节：`## Absolute Constraints`、`## Decision Authority`、`## Audit Requirements`
> 2. 创建 `packages/agent-runtime/constitution/platform-policies/*.md`：
>    - 每个平台一个文件，从 `PLATFORM_POLICIES` Record 迁移
> 3. 创建 `packages/agent-runtime/constitution/rules/*.md`：
>    - 带 YAML frontmatter `scope` 字段，匹配 Agent scope
>    - 例如 `pricing.md` 的 frontmatter：`scope: price-sentinel`
> 4. 新建 `packages/agent-runtime/scripts/generate-constitution.ts`（构建时脚本）：
>    ```typescript
>    // 读取所有 .md → 生成 src/generated/constitution-data.ts
>    // 输出格式：
>    export const CONSTITUTION_L0 = `...markdown content...`
>    export const PLATFORM_POLICIES: Record<string, string> = { amazon: `...`, ... }
>    export const AGENT_RULES: Record<string, string> = { 'price-sentinel': `...`, ... }
>    ```
> 5. `package.json` 增加 `"prebuild": "tsx scripts/generate-constitution.ts"`
> 6. `.gitignore` 增加 `src/generated/`
> 7. 新建 `packages/agent-runtime/src/constitution-loader.ts`：
>    ```typescript
>    import { CONSTITUTION_L0, PLATFORM_POLICIES, AGENT_RULES } from './generated/constitution-data'
>
>    interface ConstitutionLayer {
>      level: 'L0' | 'L1' | 'L2' | 'L3'
>      source: string
>      content: string
>    }
>
>    function loadConstitution(): ConstitutionLayer[]
>    function loadPlatformPolicy(platform: string): ConstitutionLayer | null
>    function loadAgentRules(scope: string): ConstitutionLayer[]
>    ```
> 8. 修改 `prompt-stack.ts`：
>    - `SYSTEM_CONSTITUTION_PROMPT` → 调用 `loadConstitution()`
>    - `PLATFORM_POLICIES` Record → 调用 `loadPlatformPolicy()`
>    - `buildPromptStack()` 增加 `scope` 参数，按 Agent 加载域规则
>    - 保留原始常量作为 fallback（生成文件缺失时降级）
> 9. 补测试：Constitution 加载 + 分层优先级 + fallback 降级 + 生成脚本
>
> **安全约束：**
> - 运行时**禁止** `fs.readFile` / `fs.readFileSync` 读取 constitution 文件
> - 生成的 `.ts` 文件是**构建产物**，与编译后的 JS 同级别不可变
> - CI 流水线中 `generate-constitution` 步骤在 `tsc` 前执行
>
> **验收：**
> - `buildPromptStack(ctx, sop)` 行为不变（向后兼容）
> - Constitution 内容源头是 `.md` 文件（人类友好）
> - 修改 `.md` 文件 → 重新构建 → Agent 行为变化
> - 运行时无文件系统读取（零攻击面）

---

> **🃏 CARD-CI-D1-02 · 域规则按 Agent scope 条件加载**
>
> **类型：** 新建
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `constitution/rules/*.md` 的 YAML frontmatter 定义：
>    ```yaml
>    ---
>    scope: price-sentinel
>    description: 定价 Agent 专属行为约束
>    ---
>    ```
> 2. `generate-constitution.ts` 解析 frontmatter `scope` 字段，生成 `AGENT_RULES` 映射
> 3. `constitution-loader.ts` 的 `loadAgentRules(scope)` 从 `AGENT_RULES[scope]` 读取
> 4. `buildPromptStack()` 签名扩展为 `buildPromptStack(ctx, sop, scope?)`
>    - 有 scope 时注入域规则到 system message（L2 和 L3 之间）
>    - 无 scope 时行为不变
>
> **验收：** Price Sentinel 调用 `buildPromptStack` 时包含 `pricing.md` 内容；Ads Optimizer 不包含

---

## D2 · Pipeline Hooks 事件系统

**嵌入时机：** Sprint 20 Day 21（类型定义）+ Day 26（集成到 `runPipeline`，等 Price Sentinel 完成）
**耗时：** 1.5d (BE)
**前置：** CARD-CI-D2-02 依赖 CARD-5B-D21-01（DecisionPipeline）完成

### 问题

当前 `runPipeline()` 是一条直线流水：`gather → reason → govern → execute → remember`。无法在不修改核心代码的情况下注入额外逻辑（数据校验、指标采集、异常通知、动态阈值调整）。

### 目标架构

借鉴 Claude Code 的 `PreToolUse` / `PostToolUse` / `Stop` 等 Hooks 机制，为 `DecisionPipeline` 增加可编程拦截点。

> ⚠️ **v2 安全约束：** govern → execute 之间**禁止 abort**。govern 产出的审计记录必须保留，
> abort 只允许在 gather/reason 阶段（还未产生不可逆决策前）。任何 abort 均强制写入 `logAction`。

### 操作

> **🃏 CARD-CI-D2-01 · Pipeline Hooks 类型定义 + 注册机制**
>
> **类型：** 新建
> **耗时：** 0.5d（Day 21，与 Pipeline 改造并行无冲突）
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：** 新建 `packages/agent-runtime/src/pipeline-hooks.ts`
>
> ```typescript
> type HookAction = 'proceed' | 'skip' | 'abort'
>
> interface HookContext<TPayload = unknown> {
>   agentId: string
>   tenantId: string
>   scope: string
>   stage: PipelineStage
>   payload: TPayload
>   degradation: DegradationFlags
> }
>
> type PipelineStage = 'gather' | 'reason' | 'govern' | 'execute' | 'remember'
>
> /** govern 之后的阶段不允许 abort，保障审计链完整 */
> type AbortableStage = 'gather' | 'reason'
>
> interface PipelineHook {
>   name: string
>   stage: PipelineStage
>   timing: 'pre' | 'post'
>   handler(ctx: HookContext): Promise<HookAction | void>
> }
>
> interface PipelineHookRegistry {
>   register(hook: PipelineHook): void
>   getHooks(stage: PipelineStage, timing: 'pre' | 'post'): PipelineHook[]
> }
>
> function createHookRegistry(): PipelineHookRegistry
> ```
>
> **安全约束：**
> - `register()` 在注册时校验：stage 为 `govern`/`execute`/`remember` 的 hook **不得返回 abort**（类型层面 + 运行时断言）
> - 任何 abort 必须附带 `abortReason: string`
>
> **验收：** 类型导出 + 注册表创建 + 空注册表不影响现有行为 + 尝试注册 post-govern abort hook 抛异常

---

> **🃏 CARD-CI-D2-02 · `runPipeline()` 集成 Hook 调用**
>
> **类型：** 代码变更
> **耗时：** 0.5d（Day 26，Price Sentinel 改造完成后再改）
> **优先级：** 🔴 P0
> **负责：** BE
>
> **操作：** 修改 `packages/agent-runtime/src/decision-pipeline.ts` 的 `runPipeline()`：
>
> 1. 函数签名增加可选参数 `hooks?: PipelineHookRegistry`
> 2. 在每个阶段前后插入 Hook 调用：
>    ```
>    [pre-gather hooks] → gather() → [post-gather hooks]
>    [pre-reason hooks] → reason() → [post-reason hooks]
>    [pre-govern hooks] → govern() → [post-govern hooks]
>    [pre-execute hooks] → execute() → [post-execute hooks]
>    [pre-remember hooks] → remember() → [post-remember hooks]
>    ```
> 3. Hook 返回 `'abort'`（仅 gather/reason 阶段允许）→ 管线中止，**强制调用 `logAction` 记录 abort 事件**，返回 partial result
> 4. Hook 返回 `'skip'` → 跳过当前阶段（仅对 `execute` 和 `remember` 有效）
> 5. govern/execute/remember 阶段收到 `'abort'` → 降级为 `'proceed'` + 告警日志
> 6. 无 hooks 参数时行为完全不变（向后兼容）
>
> **验收：**
> - 现有测试全通过
> - 注册一个 pre-reason hook 返回 `'abort'` → 管线在 reason 前停止 + audit 日志写入
> - 尝试在 post-govern 阶段 abort → 降级为 proceed + 告警

---

> **🃏 CARD-CI-D2-03 · 内置 Hooks：降级通知 + 指标采集**
>
> **类型：** 新建
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：** 创建 `packages/agent-runtime/src/builtin-hooks.ts`
>
> 1. `degradationNotifyHook`：post-gather 阶段，当 `degradation.profitDataMissing` 时记录告警事件
> 2. `metricsCollectorHook`：post-execute 阶段，发射 Prometheus 指标（`agent_pipeline_duration_seconds`、`agent_pipeline_decisions_total`）
> 3. `dataValidationHook`：pre-reason 阶段，验证 `DecisionContext.platformData` 非空；否则返回 `'abort'`（此处 abort 合法：尚未进入 govern）
>
> **验收：** 3 个内置 Hook 注册后行为正确；指标可在 `/metrics` 查到；dataValidation abort 有 audit log

---

## D3 · Agent Auto-Memory 增强

**嵌入时机：** Sprint 20 Day 27（Price Sentinel + Ads Optimizer 改造完成后）
**耗时：** 1d (BE)
**前置：** D2（需要 post-remember hook 注入点）、三个 Agent Pipeline 完成

### 问题

agent-native-upgrade-plan.md 第 75 行指出："它有 LLM 但从不调用；有 recallMemory 但从不回忆。" Phase 5B 的 Pipeline 改造已为 Price Sentinel 引入了 `pastDecision` 机制（`gather()` 中 `recallMemory`），但：
- 仅 Price Sentinel 实现了，Ads Optimizer / Inventory Guard 尚未
- 召回结果未格式化注入 LLM prompt
- `remember()` 无选择地写入所有决策，缺少筛选

> ⚠️ **v2 简化决策：** 原方案在 `DecisionContext` 新增 `memories: RecalledMemory[]` 字段，
> 与已有 `pastDecision` 重复。修正：不新增类型，增强已有 `pastDecision` 机制的覆盖面和质量。

### 目标架构

借鉴 Claude Code 的 Auto Memory，在已有 `pastDecision` 基础上增强：
- 三个 Pipeline **统一**使用 `recallMemory()` 召回历史决策
- 召回结果格式化为 LLM 可消费的文本块，注入 `reason()` 的 prompt
- `remember()` 阶段智能筛选，只记录有学习价值的决策
- 严格限制注入 token 量，防止成本膨胀

### 操作

> **🃏 CARD-CI-D3-01 · 三 Pipeline 统一 recallMemory + prompt 注入**
>
> **类型：** 代码变更
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. 将 Price Sentinel `gather()` 中已有的 `recallMemory()` 逻辑提取为共享函数：
>    ```typescript
>    // packages/agent-runtime/src/auto-memory.ts
>    async function recallPastDecisions(
>      ctx: AgentContext,
>      scope: string,
>      keys: Record<string, string>,  // 如 { productId: 'SKU-001' }
>      options?: { maxRecords?: number; daysBack?: number },
>    ): Promise<Record<string, unknown>[]>
>    ```
> 2. Ads Optimizer / Inventory Guard 的 `gather()` 调用 `recallPastDecisions()`
>    - 召回条件：同 Agent scope + 同商品/活动/SKU + 最近 30 天
>    - 最多召回 3 条（非 5 条——控制 token）
>    - DataOS 不可用时返回空数组（降级安全）
> 3. 新增 `formatMemoryForPrompt()` 将 `pastDecision` 格式化为 LLM 文本块：
>    ```
>    HISTORICAL DECISIONS (max 3):
>    - [2026-03-25] SKU-001: 降价8% → 转化率提升40%（成功）
>    - [2026-03-20] SKU-001: 降价15% → 利润率低于底线（失败）
>    ```
> 4. **token 预算上限**：`formatMemoryForPrompt()` 结果截断至 **500 tokens**
>    - 优先保留有 outcome 的记忆，裁剪无 outcome 的
>
> **验收：** 三个 Agent 推理时均包含历史决策上下文；prompt 中 memory 部分不超过 500 tokens

---

> **🃏 CARD-CI-D3-02 · remember() 智能筛选**
>
> **类型：** 代码变更
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. 在 `packages/agent-runtime/src/auto-memory.ts` 中新增：
>    ```typescript
>    interface MemoryWorthinessConfig {
>      lowConfidenceThreshold: number      // < 0.7 → 值得记录
>      governanceTriggered: boolean        // 被门控 → 值得记录
>      significantDelta: number            // 变动幅度 > X% → 值得记录
>      maxMemoriesPerRun: number           // 单次运行最多记录条数（默认 3）
>    }
>
>    function evaluateMemoryWorthiness<T>(
>      decisions: GovernedDecision<T>[],
>      config: MemoryWorthinessConfig,
>    ): GovernedDecision<T>[]
>    ```
> 2. 三个 Agent Pipeline 的 `remember()` 方法使用 `evaluateMemoryWorthiness()` 筛选后再 `recordMemory()`
> 3. 每条 memory 附带 `worthinessReason`（`'low_confidence'` / `'governance_triggered'` / `'significant_delta'`）
>
> **验收：** 高置信度 + 无门控的常规决策不写入 memory；低置信度决策自动记录；单次运行最多写 3 条

---

## D4 · 逐 Agent 权限配置

**嵌入时机：** Sprint 20 Day 28–29（与 CARD-5B-D28-01 审批模式渐进同天）
**耗时：** 1.5d (BE) + 0.5d (FE)
**前置：** CARD-5B-D28-01 完成 `approval_mode` 字段

### 问题

当前 `GovernanceSettings` 是租户级全局配置，所有 Agent 共享同一套阈值和 `approvalMode`。但卖家对不同 Agent 的信任度不同——可能信任 Price Sentinel 自动调小幅度价格，但不信任 Ads Optimizer 自动花钱。

### 目标架构

借鉴 Claude Code 每个 subagent 独立 `permissionMode` 的理念：

```typescript
interface AgentPermissionConfig {
  agentType: string
  approvalMode: ApprovalMode      // 覆盖全局 approvalMode
  thresholds: {                   // 覆盖全局阈值
    priceChangeThreshold?: number
    adsBudgetApproval?: number
    inventoryReorderApproval?: number
  }
  autoApproveConditions?: {       // ⚠️ Phase 5B 仅定义接口，不启用
    minConfidence: number
    withinSafetyNet: boolean
    minHistoricalSuccessRate?: number
  }
}
```

> ⚠️ **v2 安全决策：** `autoApproveConditions` 在 Phase 5B 期间**仅定义接口 + 评估函数**，
> 不在 `govern()` 中实际调用。原因：
> 1. LLM 输出的 `confidence` 尚未校准（Phase 5B 是首次上线 LLM 决策）
> 2. 无历史成功率数据（`minHistoricalSuccessRate` 需积累 ≥ 2 周运行数据）
> 3. Constitution §5.2「存疑则申请人工审批」要求冷启动期间偏向安全
>
> **Phase 6 开放条件：** 积累 ≥ 2 周生产数据后，通过 A/B 实验逐步开放 autoApprove。

### 操作

> **🃏 CARD-CI-D4-01 · Agent 级权限配置数据模型**
>
> **类型：** DB migration + 代码变更
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `tenant_governance_settings` 增加 `agent_overrides JSONB DEFAULT '{}'`
>    ```sql
>    ALTER TABLE tenant_governance_settings
>      ADD COLUMN agent_overrides JSONB NOT NULL DEFAULT '{}';
>    -- 示例值：
>    -- {
>    --   "price-sentinel": { "approvalMode": "approval_informed", "priceChangeThreshold": 10 },
>    --   "ads-optimizer": { "approvalMode": "approval_required", "adsBudgetApproval": 200 }
>    -- }
>    ```
> 2. `GovernanceSettings` 类型增加 `agentOverrides` 字段
> 3. `GovernancePort.getSettings()` 返回包含 overrides 的完整配置
> 4. 修改 `context.ts` 的 `getEffectiveGovernance(scope)`：
>    - 合并顺序：`globalDefaults → tenantSettings → agentOverrides[scope] → sopGovernance`
>    - 窄覆盖宽（Agent 级 > 租户级 > 全局默认）
>    - **约束：** `agentOverrides` 只能**收紧**权限（如 `informed` → `required`），不能**放松**（`required` → `informed` 需要全局级别设置）
>
> **验收：** 为 `price-sentinel` 设置 `approvalMode: 'informed'` 后，只有 Price Sentinel 自动执行

---

> **🃏 CARD-CI-D4-02 · 自动批准条件评估（仅接口 + 测试）**
>
> **类型：** 新建
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：** 新建 `packages/agent-runtime/src/auto-approve-evaluator.ts`
>
> 1. `evaluateAutoApprove(decision, config, historicalStats)` 函数
> 2. 评估条件：
>    - `decision.confidence >= config.minConfidence`（默认 0.9）
>    - `decision.guard.constitutionTriggered === false`（宪法安全网未触发）
>    - `historicalSuccessRate >= config.minHistoricalSuccessRate`（默认 80%）
> 3. 返回 `{ autoApprove: boolean, reason: string }`
> 4. **🚫 Phase 5B 期间不在 `govern()` 中调用此函数**
>    - 仅编写函数 + 单元测试，验证评估逻辑正确
>    - `govern()` 中预留注释：`// TODO Phase 6: evaluate autoApprove after confidence calibration`
> 5. 新增 `FeatureFlag`：`ENABLE_AUTO_APPROVE`（默认 `false`）
>
> **验收：** 函数 + 测试通过；`govern()` 中无 autoApprove 调用；feature flag 默认关闭

---

> **🃏 CARD-CI-D4-03 · Agent 权限设置前端**
>
> **类型：** 前端变更
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** FE
>
> **操作：**
> - `(tenant)/agents/[id]/page.tsx` 的「高级参数」Tab 增加权限配置区域
> - 每个 Agent 可独立设置：
>   - 审批模式 toggle（跟随全局 / 独立设置）
>   - 阈值 slider（跟随全局 / 自定义值）
>   - 自动批准条件区域：显示为「灰色/待开放」状态 + 提示 "积累 2 周数据后开放"
> - 保存调用 `PUT /api/v1/settings/governance` 的 `agentOverrides` 字段
>
> **验收：** 可为单个 Agent 配置独立权限；自动批准区域不可操作

---

## D5 · 声明式 Agent 配置文件

**嵌入时机：** Sprint 21（Day 31+ 可独立执行）
**耗时：** 2.5d (BE)
**前置：** D1（Constitution 构建时内联）、Sprint 20 Agent 改造完成

### 目标架构

借鉴 Claude Code 的 subagent markdown + YAML frontmatter 模式。

> ⚠️ **v2 修订：**
> 1. **构建时内联**——与 D1 保持一致，`.md` 在构建时编译为 `.ts` 常量，运行时无文件系统依赖
> 2. **不引入 `gray-matter`**——frontmatter 格式简单（扁平 YAML + 列表），自研 ~50 行解析器足矣，避免新依赖

```
packages/agent-runtime/
├── agents/                          # 人类编辑入口
│   ├── price-sentinel.md
│   ├── ads-optimizer.md
│   ├── inventory-guard.md
│   ├── product-scout.md
│   ├── content-writer.md
│   ├── market-intel.md
│   ├── finance-agent.md
│   ├── ceo-agent.md
│   └── support-relay.md
├── src/
│   ├── generated/
│   │   └── agent-definitions.ts     # ⚡ 构建时生成（.gitignore）
│   └── agent-definition-loader.ts   # 运行时：从 generated/ 读取
```

每个 `.md` 文件格式：

```markdown
---
name: price-sentinel
description: 智能定价顾问。扫描全平台商品，生成调价建议。
model: claude-haiku-4-5
pipeline: decision
tools:
  - harness.getProducts
  - harness.updatePrice
  - dataos.getFeatures
  - dataos.recallMemory
  - dataos.recordMemory
  - llm
disallowedTools:
  - harness.deleteProduct
defaultGovernance:
  priceChangeThreshold: 15
  approvalMode: approval_required
memory: project
maxBudgetPerMonth: 50
---

你是一个定价策略专家，服务于 ElectroOS 平台的电商卖家。

## 决策框架
1. 分析每个商品的竞品价格、转化率趋势、库存压力
2. 参考历史决策效果（recallMemory）
3. 遵循卖家 SOP 策略

## 输出格式
Structured JSON: { productId, action, proposedPrice, reason, confidence }
```

### 操作

> **🃏 CARD-CI-D5-01 · Agent 定义文件解析器（构建时）**
>
> **类型：** 新建
> **耗时：** 1d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. 在 `scripts/generate-constitution.ts` 中扩展（或新建 `scripts/generate-agent-definitions.ts`）：
>    - 自研 frontmatter 解析（`---` 分隔符 + 简单 YAML 键值/列表解析，~50 行）
>    - 不引入 `gray-matter` 依赖
> 2. 生成 `src/generated/agent-definitions.ts`：
>    ```typescript
>    export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
>      'price-sentinel': { name: '...', model: '...', systemPrompt: '...', ... },
>      // ...
>    }
>    ```
> 3. 新建 `packages/agent-runtime/src/agent-definition-loader.ts`：
>    ```typescript
>    import { AGENT_DEFINITIONS } from './generated/agent-definitions'
>
>    interface AgentDefinition {
>      name: string
>      description: string
>      model: string
>      pipeline: 'decision' | 'heartbeat' | 'passive'
>      tools: string[]
>      disallowedTools: string[]
>      defaultGovernance: Partial<GovernanceSettings>
>      memory: 'user' | 'project' | 'none'
>      maxBudgetPerMonth: number
>      systemPrompt: string
>    }
>
>    function getAgentDefinition(name: string): AgentDefinition | null
>    function getAllAgentDefinitions(): AgentDefinition[]
>    ```
> 4. `package.json` 的 `prebuild` 脚本同时生成 constitution + agent-definitions
>
> **验收：** 9 个 Agent 定义文件均可正确解析；零新依赖；类型安全

---

> **🃏 CARD-CI-D5-02 · 9 个 Agent 定义文件迁移**
>
> **类型：** 新建 + 重构
> **耗时：** 1d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. 为 9 个 ElectroOS Agent 各创建一个 `.md` 定义文件
> 2. 每个文件的 system prompt 从当前 Agent `run()` 函数中的硬编码 prompt 提取
> 3. `electroos-seed.ts` 中的 model / budget 等配置迁移到 frontmatter
> 4. `registerRunner()` 调用处增加：从 `getAgentDefinition()` 读取 systemPrompt 注入 `reason()` 阶段
>
> **验收：** 修改 `.md` 文件 → 重新构建 → Agent 行为变化

---

> **🃏 CARD-CI-D5-03 · Agent Registry 重构：定义驱动**
>
> **类型：** 重构
> **耗时：** 0.5d
> **优先级：** 🟡 P1
> **负责：** BE
>
> **操作：**
> 1. `agent-registry.ts` 的 `registerRunner()` 增加 `definition?: AgentDefinition` 参数
> 2. 启动时从 `getAllAgentDefinitions()` 读取定义，为每个定义注册对应 runner
> 3. 运行时 `getRunner(agentType)` 优先查找定义驱动的 runner，fallback 到手动注册的 runner
> 4. 保持向后兼容：现有手动 `registerRunner()` 调用继续生效
>
> **验收：** 新增一个 Agent `.md` 文件 → 重新构建 → 自动注册，无需写 TypeScript

---

## D6 · 平台插件目录结构

**嵌入时机：** Sprint 21（与广告/健康 Harness 扩展并行）
**耗时：** 2d (BE)
**前置：** D5（声明式 Agent 配置）

### 目标架构

借鉴 Claude Code 的 Plugin 目录约定：

```
packages/harness/
├── plugins/
│   ├── amazon/
│   │   ├── plugin.json               # { name, platforms: ["amazon"], version }
│   │   ├── harness/
│   │   │   ├── amazon-base.ts         # 基础 Harness
│   │   │   └── amazon-ads-keyword.ts  # KeywordAdsHarness 扩展
│   │   ├── agents/
│   │   │   └── amazon-keyword-optimizer.md  # Amazon 广告专用子代理
│   │   └── rules/
│   │       └── amazon-pricing.md      # Amazon 定价域规则
│   ├── shopify/
│   │   ├── plugin.json
│   │   ├── harness/
│   │   │   └── shopify-base.ts
│   │   └── rules/
│   │       └── shopify-checkout.md
│   └── tiktok/
│       └── ...
```

### 操作

> **🃏 CARD-CI-D6-01 · Plugin 加载器 + 目录约定**
>
> **类型：** 新建
> **耗时：** 1d
> **优先级：** 🟢 P2
> **负责：** BE
>
> **操作：**
> 1. 定义 `plugin.json` schema：`{ name, version, platforms, agents?, rules? }`
> 2. 新建 `packages/harness/src/plugin-loader.ts`：
>    - 扫描 `plugins/*/plugin.json`
>    - 自动调用 `registerHarnessFactory()` 注册 harness 实现
>    - 将 `agents/*.md` 注册到 Agent Registry
>    - 将 `rules/*.md` 注册到 Constitution Loader
> 3. `server.ts` 启动时调用 `loadPlugins()` 替代当前手动 `registerHarnessFactory()` 调用
>
> **验收：** 新平台接入 = 创建 `plugins/xxx/` 目录 + 实现 Harness + 写 `plugin.json`

---

> **🃏 CARD-CI-D6-02 · 现有平台迁移到 Plugin 结构**
>
> **类型：** 重构
> **耗时：** 1d
> **优先级：** 🟢 P2
> **负责：** BE
>
> **操作：**
> 1. 将现有 Amazon / Shopify / TikTok / Shopee / Walmart Harness 迁移到 `plugins/` 目录
> 2. 为每个平台创建 `plugin.json`
> 3. 验证 `loadPlugins()` 能正确发现和注册所有平台
> 4. 删除 `server.ts` 中旧的手动注册代码
>
> **验收：** 所有现有平台测试通过；`server.ts` 无平台特定注册代码

---

## D7 · DevOS Worktree 并行开发（Phase 6 PoC）

**嵌入时机：** Phase 6 第 1 周（PoC 调研，非全量实施）
**耗时：** 1.5d (BE) PoC
**前置：** Phase 5B 全部完成

> ⚠️ **v2 降级决策：** 原方案 3d 全量实施。风险评估发现：
> 1. worktree 并行涉及 git 操作（merge、冲突检测）的可靠性问题，需先验证
> 2. 与现有 CI/CD 流水线（单分支部署）存在兼容风险
> 3. DevOS 的 `AutonomousDevLoop` 本身尚未充分生产验证
>
> **降级为 PoC：** 在隔离环境中验证 worktree 隔离 + 并行执行的可行性，产出评估报告后再决定是否全量实施。

### 问题

当前 `AutonomousDevLoop.run()` 串行处理单个 Ticket。DevOS 无法同时处理多个 Bug/Feature 请求。

### 目标架构

借鉴 Claude Code 的 `isolation: "worktree"` 模式：

```
main (生产)
├── worktree/ticket-001/ → Backend Agent 编码
├── worktree/ticket-002/ → Frontend Agent 编码
└── worktree/ticket-003/ → DB Agent 编码
         ↓
    Stage 06: 并行 Code Review
         ↓
    Stage 07: 批量 Human Approval
         ↓
    按优先级顺序合入 main
```

### PoC 操作

> **🃏 CARD-CI-D7-01 · Worktree 并行 PoC**
>
> **类型：** 调研 + PoC
> **耗时：** 1.5d
> **优先级：** 🟢 P2
> **负责：** BE
>
> **操作：**
> 1. 在 `packages/devos-bridge/src/__tests__/` 中编写 worktree 并行测试：
>    - 创建 3 个 worktree → 并行执行简单文件修改 → 顺序合入 main
>    - 模拟合入冲突场景 → 验证检测 + 回退策略
> 2. 评估项目：
>    - worktree 创建/销毁延迟
>    - 磁盘空间占用（monorepo + node_modules）
>    - 与 pnpm workspace 的兼容性
>    - CI 流水线适配方案
> 3. 产出 `docs/plans/devos-worktree-poc-report.md`：
>    - 可行性结论（Go / No-Go / 需调整）
>    - 全量实施的修订 CARDs
>    - 风险清单 + 缓解方案
>
> **验收：** PoC 报告产出；Go/No-Go 决策明确

---

## D8 · Agent Team 场景编排（Phase 6 PoC）

**嵌入时机：** Phase 6 第 2 周（PoC 调研，非全量实施）
**耗时：** 1.5d (BE) PoC
**前置：** D2（Pipeline Hooks）、Sprint 20 Agent 改造完成

> ⚠️ **v2 降级决策：** 原方案 4d（3d BE + 1d FE）全量实施。风险评估发现：
> 1. 多 Agent 并行 LLM 调用的成本模型未验证（可能单场景成本 > $5）
> 2. Agent 间通信（`getPhaseResult`）的数据格式标准化尚未定义
> 3. 需要先评估 HeartbeatRunner 串行改并行的线程安全性
>
> **降级为 PoC：** 实现 `launch`（新品上架）单场景端到端验证，产出评估报告。

### 目标架构

借鉴 Claude Code 的 Agent Teams：主代理分配子任务，子代理并行执行，结果汇总。

```
场景触发（如 SOP scenario "新品上架"）
    │
    ▼
CEO Agent (协调者)
    ├── → Product Scout: 可行性分析    [并行]
    ├── → Market Intel: 竞品分析       [并行]
    └── → Finance Agent: 利润预测      [并行]
    │
    ← 汇总三方结论（AgentTeamContext）
    │
    ├── → Price Sentinel: 制定定价      [串行]
    ├── → Ads Optimizer: 推广计划       [串行]
    └── → Inventory Guard: 备货建议     [串行]
    │
    ← 汇总决策包 → 批量审批
```

### PoC 操作

> **🃏 CARD-CI-D8-01 · Agent Team PoC（launch 场景）**
>
> **类型：** 调研 + PoC
> **耗时：** 1.5d
> **优先级：** 🟢 P2
> **负责：** BE
>
> **操作：**
> 1. 新建 `packages/agent-runtime/src/agent-team.ts`（最小实现）：
>    ```typescript
>    interface AgentTeamConfig {
>      name: string
>      trigger: 'scenario' | 'schedule' | 'manual'
>      phases: AgentTeamPhase[]
>    }
>
>    interface AgentTeamPhase {
>      name: string
>      agents: string[]
>      execution: 'parallel' | 'sequential'
>      timeout: number
>    }
>    ```
> 2. 仅实现 `launch` 场景的 2-phase 编排：
>    - Phase 1：Product Scout + Market Intel + Finance（并行）
>    - Phase 2：Price Sentinel + Ads Optimizer + Inventory Guard（串行）
> 3. 评估项目：
>    - 单次 `launch` 场景的 LLM token 消耗 + 成本
>    - 并行执行的延迟 vs 串行执行的延迟
>    - Agent 间数据传递的格式标准化方案
>    - HeartbeatRunner 并发安全性
> 4. 产出 `docs/plans/agent-team-poc-report.md`：
>    - 成本模型（单场景 LLM 费用）
>    - 可行性结论 + 全量实施修订 CARDs
>
> **验收：** `launch` 场景端到端跑通；PoC 报告 + 成本模型产出

---

## 时间线汇总

```
Phase 5B Sprint 20 (Day 21–30) 错峰嵌入:
  D2-01 Hook 类型定义 ·············· Day 21      0.5d BE  (无文件冲突)
  D1    Constitution 构建时内联 ····· Day 25–26   1.5d BE  (Price Sentinel 完成后)
  D2-02 runPipeline 集成 Hooks ···· Day 26      0.5d BE  (D1 完成后同天)
  D2-03 内置 Hooks ················ Day 27      0.5d BE
  D3    Auto-Memory 增强 ·········· Day 27      1d   BE  (三 Pipeline 完成后)
  D4    逐 Agent 权限 ············· Day 28–29   1.5d BE + 0.5d FE
                                               ──────────────
                                    小计         5.5d BE + 0.5d FE

Phase 5B Sprint 21 (Day 31–40) 并行:
  D5 声明式 Agent 配置 ············ Day 31–33   2.5d BE
  D6 平台插件目录结构 ·············· Day 34–35   2d BE
                                               ──────────────
                                    小计         4.5d BE

Phase 6 PoC (Phase 5B 结束后):
  D7 Worktree 并行 PoC ··········· Week 1      1.5d BE  (调研+报告)
  D8 Agent Team PoC ·············· Week 2      1.5d BE  (调研+报告)
                                               ──────────────
                                    小计         3d BE

总计 v3: 13d BE + 1.5d 对齐 + 0.5d FE = 15d（原 v1: 18d，缩减 3d）
注：+1.5d 宪法对齐 CARD 分散在 D1–D5 实现中，不改变排期日期（并行执行）
```

> **v2 vs v1 缩减对比：**
> | 工作流 | v1 | v2 | 缩减原因 |
> |--------|----|----|---------|
> | D3 | 1.5d | 1d | 删除 `memories` 新类型 + 质量评分 CARD |
> | D7 | 3d | 1.5d | 降级为 PoC |
> | D8 | 4d | 1.5d | 降级为 PoC |

### 依赖关系图

```
          Day 21            Day 25           Day 26–27        Day 28
          ┌───────┐         ┌──────┐         ┌───────┐        ┌──────┐
          │D2-01  │         │ D1   │────────▶│D2-02  │        │ D4   │
          │Hook   │         │Const.│         │Hook   │        │权限  │
          │类型   │         │内联  │         │集成   │        │配置  │
          └───────┘         └──────┘         ├───────┤        └──────┘
                                             │D2-03  │
                                             │内置   │
                                             │Hook   │
                                             ├───────┤
                                             │ D3    │
                                             │Memory │
                                             │增强   │
                                             └───────┘

          Day 31–33         Day 34–35        Phase 6 Week 1–2
          ┌───────┐         ┌──────┐         ┌───────────┐
  D1 ───▶│ D5    │────────▶│ D6   │         │D7 PoC     │(独立)
          │Agent  │         │Plugin│         │D8 PoC     │(依赖 D2)
          │声明式 │         │目录  │         └───────────┘
          └───────┘         └──────┘

关键路径: D1 → D2-02 → D5 → D6
```

---

## 验收标准

| # | 验收条件 | 来源 | v2 修订 |
|---|---------|------|---------|
| 1 | Constitution 源头是 `.md` 文件；修改 `.md` → 重新构建 → Agent 行为变化 | D1 | ✅ 构建时内联 |
| 2 | 运行时**无文件系统读取**（Constitution 以 JS 模块形式加载） | D1 | 🆕 安全约束 |
| 3 | 平台策略按 Agent scope 条件加载（Price 看不到 Ads 的规则） | D1 | — |
| 4 | Pipeline Hook 可拦截管线执行（仅 gather/reason 阶段允许 abort） | D2 | ✅ abort 范围收窄 |
| 5 | Hook abort 时强制写入 audit log | D2 | 🆕 审计保障 |
| 6 | 降级、指标、数据校验三个内置 Hook 正常工作 | D2 | — |
| 7 | 三个 Agent 的 `gather()` 统一调用 `recallPastDecisions()`；memory 注入不超过 500 tokens | D3 | ✅ 合并已有机制 |
| 8 | 只记忆有价值的决策（低置信度/被门控/大幅变动）；单次最多写 3 条 | D3 | — |
| 9 | 可为单个 Agent 配置独立的审批模式和阈值 | D4 | — |
| 10 | autoApprove 接口已定义 + 测试通过；但 `govern()` 中**未启用**（feature flag off） | D4 | ✅ 延后启用 |
| 11 | 修改 Agent `.md` 文件 → 重新构建 → Agent 行为变化；零新依赖 | D5 | ✅ 无 gray-matter |
| 12 | 新平台接入 = 添加 `plugins/xxx/` 目录 | D6 | — |
| 13 | D7 PoC 报告产出，包含 Go/No-Go 决策 | D7 | ✅ 降级为 PoC |
| 14 | D8 PoC 报告产出，包含 `launch` 场景成本模型 | D8 | ✅ 降级为 PoC |
| 15 | `pnpm typecheck && pnpm lint && pnpm test` 全绿 | 全局 | — |

---

## 风险与缓解（v2 修订）

| ID | 风险 | 影响 | 概率 | 缓解措施 | v2 处置 |
|----|------|------|------|---------|---------|
| R1 | D1 Constitution 文件化引入 prompt 篡改攻击面 | 🔴 严重：安全约束被绕过 | 中 | ~~运行时读取~~ → **构建时内联**，运行时零文件系统依赖 | ✅ 已消除 |
| R2 | D4 autoApprove 绕过 Constitution §5.2 安全网 | 🔴 严重：不可逆操作被自动执行 | 高 | Phase 5B **仅定义接口不启用**；Phase 6 积累数据后 A/B 实验开放 | ✅ 已延后 |
| R3 | D2 Hook abort 导致 govern 之后审计链断裂 | 🟡 高：审计合规缺失 | 中 | govern/execute/remember 阶段**禁止 abort**（类型 + 运行时双保险）；abort 强制 logAction | ✅ 已约束 |
| R4 | D1/D2 与 Sprint 20 同文件冲突（`prompt-stack.ts`、`decision-pipeline.ts`） | 🟡 高：阻塞 Sprint 20 进度 | 高 | D1 延后至 Day 25；D2 拆分为 Day 21（类型）+ Day 26（集成） | ✅ 已错峰 |
| R5 | D3 Memory 注入膨胀 token 成本 | 🟡 中：LLM 调用成本增加 | 中 | 不新增 `memories` 类型；增强已有 `pastDecision`；**500 token 上限** | ✅ 已限制 |
| R6 | D2 Hook 执行超时拖慢管线 | 🟡 中：Agent 延迟增加 | 低 | Hook 默认超时 5s；超时自动 `proceed`（不阻断） | — 保持 |
| R7 | D3 Auto-Memory 写入过多 | 🟢 低：DataOS 存储压力 | 低 | `maxMemoriesPerRun` 限制（默认 3）；30 天自动过期 | — 保持 |
| R8 | D7 Worktree 与 pnpm workspace 不兼容 | 🟡 中：并行方案不可行 | 中 | **降级为 PoC**，先验证后决策 | ✅ 已降级 |
| R9 | D8 多 Agent 并行 LLM 调用成本飙升 | 🟡 中：单场景成本失控 | 高 | **降级为 PoC**，先测量单场景成本后决策 | ✅ 已降级 |

---

## 宪法对齐审计（v3）

> 本节在 v2 修订基础上，逐条对齐系统宪法 7 项绝对约束。
> 宪法原文见 `packages/agent-runtime/src/prompt-stack.ts` 第 34–41 行。

### §1 治理尊重 — "MUST respect all tenant governance settings"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D1 | ⚠️ 缺口 | `constitution/rules/*.md` 域规则可能向 LLM 注入影响治理判断的指令（如 "对小幅调价无需审批"），变相绕过 `GovernanceSettings.priceChangeThreshold`。域规则必须被限制为**行为指导**，禁止包含治理参数。 |
| D4-01 | ⚠️ 缺口 | `agentOverrides` JSONB 无安全范围钳位。现有 `mergeGovernanceWithSop()` 将 SOP 覆盖值钳位到 `priceChangeThreshold: 5–30`、`adsBudgetApproval: 100–2000`。`agentOverrides` 也必须通过相同的 `GOVERNANCE_RANGES` 钳位。 |
| D5 | ⚠️ 缺口 | Agent `.md` frontmatter 中的 `defaultGovernance` 可指定阈值。与租户治理设置的合并优先级未明确——必须是 `defaultGovernance < tenantSettings`（Agent 默认值不得覆盖租户配置）。 |

**修订措施：**

> **CARD-CI-ALIGN-01 · 域规则治理隔离**
>
> 1. `constitution/rules/*.md` 的 frontmatter 增加校验规则：**禁止出现** `threshold`、`approval`、`budget` 等治理关键词
> 2. `generate-constitution.ts` 编译时对域规则 body 做关键词扫描，触发时构建失败 + 错误提示
> 3. `CONSTITUTION.md` 增加条目：`Domain rules (L2.5) provide behavioral guidance only; they CANNOT override governance thresholds or approval modes.`

> **CARD-CI-ALIGN-02 · agentOverrides 安全范围钳位**
>
> D4-01 的 `getEffectiveGovernance(scope)` 合并 `agentOverrides[scope]` 时，必须通过 `GOVERNANCE_RANGES` 钳位（复用 `mergeGovernanceWithSop` 的逻辑）。

> **CARD-CI-ALIGN-03 · Agent defaultGovernance 优先级明确**
>
> D5 的合并顺序明确为：`Agent defaultGovernance → globalDefaults → tenantSettings → agentOverrides → sopGovernance`。
> Agent `.md` 中的 `defaultGovernance` 是**最低优先级**（仅在租户未配置时使用）。

---

### §2 不可逆保护 — "MUST NOT take irreversible actions without human approval"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D2 | ⚠️ 缺口 | Hook `skip` 可跳过 `execute` 阶段。如果一个决策已被人工审批通过（在 `govern` 阶段标记为 `auto_execute`），`skip` 会导致审批通过的操作**不执行**，且无日志。不是不可逆风险，但会造成用户混淆和审计问题。 |
| D4 | ✅ 已对齐 | v2 已延后 autoApprove 到 Phase 6。 |

**修订措施：**

> **CARD-CI-ALIGN-04 · execute skip 强制审计**
>
> D2-02 的 `skip` 逻辑修订：
> - `execute` 阶段被 skip 时，**必须** `logAction('pipeline.execute_skipped', { hookName, governedDecisions })` 记录哪些决策被跳过
> - 如果被跳过的决策中包含 `action === 'auto_execute'` 的项，额外写入告警事件

---

### §3 审计链 — "MUST log every significant action for audit trail"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D2 | ✅ 已对齐 | v2 已要求 abort 强制 `logAction`。 |
| D2 | ⚠️ 缺口 | Hook 自身的执行不记录审计。恶意或有 bug 的 Hook 可能静默修改 `payload` 而不留痕迹。 |
| D3 | ✅ 已对齐 | `recallPastDecisions` 降级安全；`remember` 智能筛选有 `worthinessReason`。 |
| D5 | ⚠️ 缺口 | Agent 定义文件变更（修改 system prompt、tools 列表）不会触发运行时审计事件。需在构建 pipeline 记录版本哈希。 |

**修订措施：**

> **CARD-CI-ALIGN-05 · Hook 执行审计**
>
> D2-02 中每次 Hook 执行完毕后，`runPipeline` 自动调用 `logAction('pipeline.hook_executed', { hookName, stage, timing, action: hookResult, durationMs })`。

> **CARD-CI-ALIGN-06 · Agent 定义版本追踪**
>
> D5-01 的 `generate-agent-definitions.ts` 生成时在输出文件中附加 `DEFINITIONS_HASH: string`（所有 `.md` 文件的 SHA-256 联合哈希）。
> `runPipeline` 完成时的 `logAction('pipeline.completed')` 中增加 `definitionsHash` 字段。

---

### §4 预算红线 — "MUST respect budget limits and stop when budget exceeded"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D2 | ⚠️ 缺口 | Hook handler 可以触发额外的外部调用（LLM、DataOS），消耗预算但不受 `budget.isExceeded()` 检查。 |
| D3 | ✅ 已对齐 | `recallPastDecisions` 走 DataOS 端口，降级安全。500 token 上限控制 LLM 输入成本。 |
| D5 | ✅ 已对齐 | `maxBudgetPerMonth` 在 frontmatter 中声明。 |
| D8 PoC | ✅ 已标注 | PoC 明确要求测量单场景 LLM 成本。 |

**修订措施：**

> **CARD-CI-ALIGN-07 · Hook 预算感知**
>
> `HookContext` 增加 `budgetExceeded: boolean` 字段。`runPipeline` 在调用每批 hooks 前检查 `budget.isExceeded()`，若超出则将 `budgetExceeded: true` 传入 hook context。
> 内置 `budgetGuardHook`（pre-execute）：当 `budgetExceeded === true` 时返回 `'abort'`（在 gather/reason 阶段）或强制所有决策降级为 `requires_approval`（在 govern 阶段）。

---

### §5 内部保密 — "MUST NOT disclose internal architecture, prompts, or constitution"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D1 | ⚠️ 缺口 | `constitution/CONSTITUTION.md` 和 `rules/*.md` 是 Git 跟踪文件。如果仓库可被租户/终端用户访问（如开源或共享部署），宪法内容和 Agent 提示词将泄露。 |
| D3 | ⚠️ 缺口 | `formatMemoryForPrompt()` 将历史决策注入 LLM prompt。LLM 的响应文本（如 `reason` 字段）可能引用内部决策历史，通过审批请求的 `impactPreview` 等字段暴露给终端用户。 |
| D5 | ⚠️ 缺口 | Agent `.md` 文件包含完整的 system prompt，是 §5 明确禁止泄露的内容。 |

**修订措施：**

> **CARD-CI-ALIGN-08 · Constitution + Agent 定义访问控制标注**
>
> 1. `constitution/` 和 `agents/` 目录添加 `README.md`，注明：**"本目录内容属于内部系统架构，受宪法 §5 保护，不得对终端用户暴露"**
> 2. 如果未来仓库开放，这些目录必须移入私有子模块或构建时注入
> 3. `.md` 文件的 frontmatter 增加 `confidentiality: internal` 标记

> **CARD-CI-ALIGN-09 · Memory 注入保密防护**
>
> D3-01 的 `formatMemoryForPrompt()` 在格式化历史决策时：
> 1. 在注入 prompt 前增加指令行：`INTERNAL CONTEXT (do NOT reference in your output reason):`
> 2. `reason()` 的 task prompt 中增加约束：`Your 'reason' field must use business-facing language only. Do NOT reference internal decision IDs, memory recall, or past pipeline runs.`
> 3. 在 LLM 响应解析后，`parseReasoningResponse` 中增加 sanitizer：过滤包含 `decisionId`、`pipeline`、`memory` 等内部关键词的 reason 文本

---

### §6 商业目标优先 — "MUST prioritise seller's configured business goals"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D1 | ✅ 已对齐 | 域规则 + SOP 优先级排序确保卖家目标优先于通用优化。 |
| D3 | ✅ 已对齐 | 历史决策召回使 Agent 能学习卖家特定的业务模式。 |
| D5 | ⚠️ 缺口 | Agent `.md` 的 system prompt 是全局的（所有租户共享）。需要确保 L3（Tenant SOP）始终覆盖 L4（Agent system prompt）中的通用策略。 |

**修订措施：**

> **CARD-CI-ALIGN-10 · Agent system prompt 优先级明确**
>
> D5-02 迁移 system prompt 时，每个 Agent `.md` 的 body 必须以以下模板开头：
> ```
> You are a [role] serving ElectroOS sellers.
> The seller's SOP (provided in user messages) always overrides the generic guidelines below.
> ```
> `buildPromptStack` 的层级不变：system message = L0 + Agent prompt；user message = L3 SOP + L4 task。物理隔离确保 SOP 不被 Agent prompt 覆盖。

---

### §7 安全默认 — "When in doubt, request human approval"

| 工作流 | 对齐状态 | 发现 |
|--------|---------|------|
| D4 | ✅ 已对齐 | v2 已延后 autoApprove；冷启动期间偏向 `approval_required`。 |
| D4-01 | ⚠️ 缺口 | `agentOverrides` 允许将审批模式从 `required` 改为 `informed`。但 v2 已说"只能收紧不能放松"——需要在代码层面强制执行，否则 API 层可能被绕过。 |
| D2 | ✅ 已对齐 | Hook abort 后降级处理（非直接丢弃），安全方向正确。 |

**修订措施：**

> **CARD-CI-ALIGN-11 · agentOverrides 单向锁定**
>
> D4-01 的 `getEffectiveGovernance(scope)` 合并逻辑增加**单向锁定**断言：
> ```typescript
> // agentOverrides 只能收紧，不能放松
> if (override.approvalMode === 'approval_informed' && base.approvalMode === 'approval_required') {
>   // 忽略此覆盖，保持 approval_required
>   logAction('governance.override_blocked', { scope, reason: 'cannot relax approval mode' })
> }
> ```
> API 层（`PUT /api/v1/settings/governance`）同样校验：拒绝将全局 `required` 的 Agent 设为 `informed`。

---

### 重大发现：D4-02 与现有 `approval-progressive.ts` 重复

现有代码 `packages/agent-runtime/src/approval-progressive.ts` 已实现：
- `evaluateAutoApprovable()` — 评估 `confidence >= 0.9` + 未触发降级/业务门控
- `resolveEffectiveAction()` — 当 `approvalMode === 'approval_informed'` 且 `autoApprovable` 时，`requires_approval → auto_execute`
- `computeMaturityMetrics()` — 审批成熟度指标

D4-02 计划新建 `auto-approve-evaluator.ts` 实现几乎相同的逻辑，**造成代码重复**。

**修订措施：**

> **CARD-CI-ALIGN-12 · 合并 D4-02 到已有 approval-progressive.ts**
>
> 1. **不新建** `auto-approve-evaluator.ts`
> 2. 在现有 `approval-progressive.ts` 中扩展：
>    - `evaluateAutoApprovable()` 增加 `historicalSuccessRate` 参数（Phase 6 启用）
>    - 增加 `ENABLE_AUTO_APPROVE` feature flag 检查
> 3. D4-02 的验收标准改为：
>    - `approval-progressive.ts` 中增加 `historicalSuccessRate` 参数（默认忽略）
>    - feature flag `ENABLE_AUTO_APPROVE` 默认 `false` 时，`resolveEffectiveAction` 直接返回原 action
>    - 现有测试全部通过 + 新增 feature flag 测试

---

### 宪法对齐总结

| 宪法条款 | D1 | D2 | D3 | D4 | D5 | D6 |
|---------|----|----|----|----|----|----|
| §1 治理尊重 | ALIGN-01 | ✅ | ✅ | ALIGN-02 | ALIGN-03 | ✅ |
| §2 不可逆保护 | ✅ | ALIGN-04 | ✅ | ✅ | ✅ | ✅ |
| §3 审计链 | ✅ | ALIGN-05 | ✅ | ✅ | ALIGN-06 | ✅ |
| §4 预算红线 | ✅ | ALIGN-07 | ✅ | ✅ | ✅ | ✅ |
| §5 内部保密 | ALIGN-08 | ✅ | ALIGN-09 | ✅ | ALIGN-08 | ✅ |
| §6 商业目标优先 | ✅ | ✅ | ✅ | ✅ | ALIGN-10 | ✅ |
| §7 安全默认 | ✅ | ✅ | ✅ | ALIGN-11 | ✅ | ✅ |

**12 个对齐 CARD（ALIGN-01 ~ ALIGN-12）**，其中：
- 6 个需要修改现有 CARD（合入对应 D 的实现中）
- 4 个需要新增验证逻辑（构建时/运行时）
- 1 个删除重复 CARD（D4-02 合并到 `approval-progressive.ts`）
- 1 个增加约束条款（Constitution 自身增补）

**估算增量工时：** +1.5d BE（分散在 D1–D5 实现中，不改变整体排期）

---

## Related

- [Phase 5B 逐日执行计划](./phase5b-daily-execution-plan.md)
- [Phase 5B 租户产品化计划](./phase5b-tenant-product-plan.md)
- [Agent Native 改进方案](./agent-native-upgrade-plan.md)
- [Claude Code 官方文档](https://code.claude.com/docs/en/overview)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Memory](https://code.claude.com/docs/en/memory)
