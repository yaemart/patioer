# Phase 3 · Sprint 4 — Decision Memory + Insight Agent · 逐日 CARD 实施计划

**周期：** Week 7–8（8 工作日）  
**前提：** Sprint 3（Feature Store + Feature Agent）已完成并验收  
**目标：** DecisionMemory recall/record 完整可用 · Insight Agent 每周一回写 outcome · IVFFlat 索引 · 跨租户隔离验证  
**验收：**  
- [ ] Price Sentinel 调价后 `decision_memory` 有对应记录（含 context_vector）
- [ ] Insight Agent 每周一运行，将 7 天前决策回写 outcome
- [ ] 向量召回：相似情境返回 ≥3 条历史案例
- [ ] 跨租户 recall 返回 0 条（隔离验证）

---

## §0. 上游文档对齐（Constitution · Blueprint · Brainstorm · Phase 3 Plan）

> Sprint 4 的每项工作均可追溯至以下上游文档。本节提供 **总览级对齐矩阵**；各 CARD 内通过 `📜` 标注具体条款引用。

### 0.1 Constitution 条款映射（`docs/system-constitution.md` v1.0）

| 宪法章节 | 条款要求 | Sprint 4 落地卡片 | 说明 |
|----------|---------|------------------|------|
| **Ch2.3** Harness 抽象 | Agent 绝不直调平台 SDK → DataOS 是读特征/写事件，**不替代 Harness** | 全局 | Insight Agent 只从 CH 聚合 + 写 PG，不调平台 API |
| **Ch2.4** 事件驱动 | 核心事件包含 `price.changed`、`agent.heartbeat` | D30（Insight 读 CH events） | Insight Agent 消费 `events` / `price_events` |
| **Ch2.5** 数据所有权 | 每个 Service 自有 schema，跨域经 API | D32（路由鉴权测试） | DataOS API 通过 `X-DataOS-Internal-Key` + `X-Tenant-Id` 鉴权 |
| **Ch4.3** 错误处理 | 结构化 `AgentError` 分类 | D31（_generateInsightReport） | Insight Agent 失败生成结构化错误报告 |
| **Ch5.1** 执行前检查 | recall 历史记忆 → 注入 prompt | D28（集成测试验证 recall 流程） | 验证 record → recall → writeOutcome 完整生命周期 |
| **Ch5.3** 必须行为 | 所有操作写入不可变审计日志 | D30（Insight Agent 写 outcome） | outcome 回写本身记录在 `decision_memory.outcome_at` |
| **Ch5.3** 必须行为 | 超预算主动停止并上报 | D30（maxDecisionsPerTick） | Insight Agent 有 `maxDecisionsPerTick` 封顶 |
| **Ch5.3** 必须行为 | 任务失败时生成结构化错误报告 | D31（`_generateInsightReport`） | 含 `failed` 计数 + 失败详情 |
| **Ch6.1** 数据隔离 | 所有核心表 `tenant_id` + RLS | D29（跨租户隔离集成测试） | `WHERE tenant_id=$1` 强制过滤验证 |
| **Ch7.2** 测试覆盖率 | ≥80% | D27–D33（全量测试） | 每日回归确保覆盖率不降 |
| **Ch8.1** 可观测性 | `agent.budget.utilization` 等指标 | D30（4 个 Insight Prometheus 指标） | `dataos_insight_agent_*` 系列 |
| **Ch9** 安全 | API 鉴权 | D32（401/403 路由测试） | `X-DataOS-Internal-Key` + `X-Tenant-Id` UUID 验证 |

### 0.2 蓝图映射（`brainstorms/electroos-devos-master-blueprint-pdf-brainstorm.md`）

| 蓝图章节 | 要求 | Sprint 4 对应 |
|----------|------|--------------|
| **§02** 21 核心 Agents | DataOS 侧 Insight Agent | D30–D31 实现 + 测试 |
| **§05** Governance Gates | `updatePrice` >15% 须审批 | Insight Agent **只读 + 回写 outcome**，不触发调价，不触及审批门控 |
| **§06** Constitution 摘要 | 不可变审计 + Harness 不可绕过 | Insight Agent 不绕 Harness；outcome 回写是**补充信息**非平台操作 |
| **§07** Phase 3 范围 | DataOS 三件套：Event Lake / Feature Store / **Decision Memory** | Sprint 4 = Decision Memory 深度验证 + Insight Agent 闭环 |

### 0.3 数据系统结构映射（`brainstorms/electroos-data-system-structure-brainstorm.md`）

| 文档要点 | Sprint 4 落地 |
|----------|--------------|
| **三层闭环**：执行(ElectroOS) → 学习(DataOS) → 工程(DevOS) | Insight Agent = DataOS 学习层「反馈闭环」的核心：聚合 CH 事件 → 回写 outcome → 下次 recall 时反哺 Agent |
| **Decision Memory = PG + pgvector** | D27–D29 集成测试 + D33 IVFFlat + 性能基准 |
| **向量维度 `vector(1536)`** 与 embedding 模型锁定（Open Question #3） | D29 Embedding 测试验证 `EMBEDDING_DIM = 1536`；确定性 fallback 维度一致 |
| **Agent 执行后写 Event → 异步刷新特征 → 写入决策与 outcome** | Insight Agent 实现此异步 outcome 回写环节 |
| **Mermaid 数据流：** `A -->|recall / record| DM` | Sprint 4 验证 recall/record/writeOutcome 完整路径 |

### 0.4 五阶段路线图映射（`brainstorms/electroos-phase1-5-roadmap-pdf-brainstorm.md`）

| 路线图要点 | Sprint 4 对应 |
|-----------|--------------|
| **Phase 3 做：** Decision Memory、3×DataOS Agent（Ingestion/Feature/**Insight**） | Sprint 4 = Insight Agent 实现（第 3 个 DataOS Agent） |
| **Phase 3 不做：** 强化学习训练、**跨租户共享学习** | D29 跨租户隔离测试 = **显式验证不做跨租户共享** |
| **Phase 3 不做：** DataOS 对外公共 API | DataOS API 仅 `/internal/v1/*`，`X-DataOS-Internal-Key` 鉴权 |
| **阶段门禁：** 验收清单全过再进下阶段 | D34 检查点清单 16 项 = Sprint 4 出口门禁 |

### 0.5 工程师检查清单映射（`brainstorms/electroos-engineering-checklist-brainstorm.md`）

| 清单章节 | 清单条目 | Sprint 4 CARD |
|----------|---------|---------------|
| **§五 DataOS 集成** | `执行前调用 recall()` | D28 集成测试验证 recall 调用 |
| **§五 DataOS 集成** | `执行后调用 record()` | D28 集成测试验证 record 调用 |
| **§五 DataOS 集成** | `有 outcome 回写机制（异步）` | D30 Insight Agent = 异步 outcome 回写实现 |
| **§五 DataOS 集成** | `所有关键行为写入 ClickHouse` | Insight Agent 读 CH（验证 Event Lake 链路完整） |
| **§五 DataOS 集成** | `payload 完整（context + action + metadata）` | D28 集成测试断言 `context` + `action` JSONB 完整 |
| **§六 测试** | Service 层有测试 / 集成测试 / ≥80% | D27–D33 单测 + 集成测试 + 每日回归 |
| **§九 多租户** | 所有核心表 `tenant_id` / 无跨租户泄露 | D29 六项跨租户隔离断言 |
| **§十 可观测性** | 已上报 Prometheus 指标 | D30 四个 `dataos_insight_agent_*` 指标 |
| **§十一 反模式** | 没有 Event 记录 → ❌ | Insight Agent 依赖 Event Lake 数据，反向验证 Event 链路存在 |

### 0.6 Phase 3 实施计划架构决策映射（`docs/plans/phase3-plan.md` §0）

| 决策编号 | 决策内容 | Sprint 4 遵循 |
|---------|---------|--------------|
| **D13** | ClickHouse 24+（Event Lake）· pgvector:pg16（Decision Memory）· Redis（Feature 缓存） | D33 IVFFlat 索引 = pgvector:pg16 上操作；Insight Agent 从 CH 24+ 聚合 |
| **D14** | DataOS 独立 Compose 栈：PG 端口 `5434`、API 端口 `3300` | D34 冒烟测试使用 `localhost:3300` / `localhost:5434` |
| **D16** | PG 审计 vs CH 湖：`agent_events`(PG) = 审计真相源；CH = 分析湖 | Insight Agent 只从 **CH 聚合** outcome 数据，不读 ElectroOS PG |
| **D17** | 降级策略：超时 5s + try/catch | Sprint 4 不直接实现降级（Sprint 5 范围），但 `DataOsClient` 已有 5s 超时 |
| **D18** | DataOS 租户隔离：`WHERE tenant_id` 强制过滤 | D29 跨租户测试 = D18 的直接验证 |

### 0.7 Sprint 4 验收 ↔ Phase 3 AC 映射

| Sprint 4 验收项 | Phase 3 验收项 | 验证方式 | Day |
|----------------|---------------|---------|-----|
| Price Sentinel 调价后 `decision_memory` 有记录 | **AC-P3-10** | 集成测试 `record()` + 冒烟 curl | D28, D34 |
| Insight Agent 每周一运行回写 outcome | **AC-P3-11** | 单测 + `/insight/trigger` curl | D30, D31, D34 |
| 向量召回 ≥3 条历史案例 | **AC-P3-12** | 基准测试 `recall returns ≥3` | D33 |
| 跨租户 recall 返回 0 条 | **AC-P3-18** + **AC-P3-20** | 隔离集成测试 6 项断言 | D29, D34 |

---

## 现有代码基线（Sprint 3 产出）

| 文件 | 状态 | 说明 |
|------|------|------|
| `packages/dataos/src/decision-memory.ts` | ✅ 已有 | `recall` / `record` / `writeOutcome` / `delete` / `listRecent` |
| `packages/dataos/src/decision-memory.test.ts` | ✅ 已有 | 10 个 mock 单测 |
| `packages/dataos/src/embeddings.ts` | ✅ 已有 | `deterministicEmbedding` / `embedText` / `EmbeddingPort` |
| `packages/dataos/src/embeddings.test.ts` | ✅ 已有 | 基础单测 |
| `apps/dataos-api/src/internal-routes.ts` | ✅ 已有 | memory/recall + record + outcome + decisions + delete 路由 |
| `apps/dataos-api/src/workers/insight-agent.ts` | ❌ 不存在 | Sprint 4 新建 |
| `DecisionMemoryService.listPendingOutcomesOlderThan()` | ❌ 不存在 | Sprint 4 新增方法 |
| Insight Agent Prometheus 指标 | ❌ 不存在 | Sprint 4 新增 |

---

## Day 27 — `listPendingOutcomesOlderThan` 方法 + 集成测试脚手架

---

> **🃏 CARD-D27-01 · `DecisionMemoryService.listPendingOutcomesOlderThan()` 方法**
>
> **类型：** 代码变更  
> **耗时：** 1h  
> **目标文件：** `packages/dataos/src/decision-memory.ts`  
> **📜 对齐：** 工程清单 §五「有 outcome 回写机制（异步）」的前置查询 · Phase 3 Plan 任务 4.4 · 数据系统 brainstorm「Decision Memory = PG + pgvector」
>
> **新增方法签名：**
> ```typescript
> async listPendingOutcomesOlderThan(
>   days: number,
>   opts?: { limit?: number },
> ): Promise<Array<Pick<DecisionMemoryRow, 'id' | 'tenant_id' | 'agent_id' | 'platform' | 'entity_id' | 'context' | 'action' | 'decided_at'>>>
> ```
>
> **SQL 实现：**
> ```sql
> SELECT id, tenant_id, agent_id, platform, entity_id, context, action, decided_at
> FROM decision_memory
> WHERE outcome IS NULL
>   AND decided_at < NOW() - INTERVAL '$1 days'
> ORDER BY decided_at ASC
> LIMIT $2
> ```
>
> **约束：**
> - 使用参数化查询，`days` 通过 `INTERVAL '1 day' * $1` 或 `make_interval(days => $1)` 实现（避免 SQL 注入）
> - 默认 `limit = 200`，上限 `1000`
> - 返回的行**不含** `outcome`（已确认为 NULL）和 `context_vector`（避免传输大向量）
>
> **验证：** `pnpm --filter @patioer/dataos typecheck`
>
> **产出：** Insight Agent 依赖的核心查询方法

---

> **🃏 CARD-D27-02 · `listPendingOutcomesOlderThan` 单元测试**
>
> **类型：** 代码变更  
> **耗时：** 30 min  
> **目标文件：** `packages/dataos/src/decision-memory.test.ts`（追加）
>
> **新增测试用例：**
> ```
> ✓ listPendingOutcomesOlderThan queries decisions without outcome older than N days
> ✓ listPendingOutcomesOlderThan respects custom limit capped at 1000
> ✓ listPendingOutcomesOlderThan returns empty array when no pending decisions
> ```
>
> **验证：** `pnpm --filter @patioer/dataos test`
>
> **产出：** 新方法测试覆盖

---

> **🃏 CARD-D27-03 · DecisionMemory 集成测试脚手架**
>
> **类型：** 新建文件  
> **耗时：** 1.5h  
> **目标文件：** `packages/dataos/src/decision-memory.integration.test.ts`（新建）
>
> **测试脚手架设计：**
> - 使用 `describe.skipIf(!process.env.DATAOS_TEST_DATABASE_URL)` 条件跳过（CI 无 PG 时跳过）
> - `beforeAll`：连接真实 DataOS PG · 确认 `vector` 扩展可用 · 清理测试数据（`DELETE FROM decision_memory WHERE tenant_id IN (test UUIDs)`）
> - `afterAll`：清理 + 关闭连接
> - 测试用 tenant IDs：
>   - `TENANT_INTEG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`
>   - `TENANT_INTEG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`
>
> **本 Day 仅搭建脚手架，Day 28 编写具体 test cases。**
>
> **验证：**
> ```bash
> # 无 DATABASE_URL 时跳过
> pnpm --filter @patioer/dataos test
> # 有 DATABASE_URL 时运行
> DATAOS_TEST_DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm --filter @patioer/dataos test -- --reporter=verbose
> ```
>
> **产出：** 集成测试基础设施

---

> **🃏 CARD-D27-04 · Day 27 回归 + 检查点**
>
> **类型：** 验证  
> **耗时：** 15 min
>
> | # | 检查项 | 期望 |
> |---|--------|------|
> | 1 | `listPendingOutcomesOlderThan` 方法存在 | `grep listPendingOutcomesOlderThan` 可见 |
> | 2 | 新增 3 个单元测试通过 | `pnpm --filter @patioer/dataos test` |
> | 3 | 集成测试文件存在并可跳过 | `pnpm --filter @patioer/dataos test` exit 0 |
> | 4 | 全量测试不受影响 | `pnpm test` exit 0 |
>
> **产出：** Day 27 完成

---

**Day 27 卡片执行顺序汇总：**

```
09:00  CARD-D27-01  listPendingOutcomesOlderThan 方法          (1h)
10:00  CARD-D27-02  listPendingOutcomesOlderThan 单测          (30min)
10:30  CARD-D27-03  集成测试脚手架                              (1.5h)
12:00  CARD-D27-04  回归 + 检查点                               (15min)
12:15  Day 27 完成
```

---

## Day 28 — DecisionMemory 集成测试（record → recall → writeOutcome 完整循环）

---

> **🃏 CARD-D28-01 · DecisionMemory 集成测试：完整生命周期**
>
> **类型：** 代码变更  
> **耗时：** 2.5h  
> **目标文件：** `packages/dataos/src/decision-memory.integration.test.ts`  
> **📜 对齐：** Constitution Ch5.1「执行前 recall」+ Ch5.3「所有操作写入审计」 · 工程清单 §五「执行前 recall() / 执行后 record() / outcome 回写」 · 数据系统 brainstorm Mermaid 流「A → recall/record → DM」 · Phase 3 Plan 任务 4.1 · **AC-P3-10**
>
> **测试用例（需真实 PG + pgvector）：**
>
> ```
> describe('DecisionMemory integration (full lifecycle)')
>   ✓ record() inserts a decision and returns a valid UUID
>   ✓ listRecent() returns the recorded decision
>   ✓ recall() returns the recorded decision when context is similar
>   ✓ recall() returns empty when context is completely different (below threshold)
>   ✓ recall() only returns decisions with outcome (outcome IS NOT NULL filter)
>   ✓ writeOutcome() updates the decision and sets outcome_at
>   ✓ recall() returns the decision after outcome is written
>   ✓ listPendingOutcomesOlderThan() returns decisions without outcome
>   ✓ listPendingOutcomesOlderThan() excludes decisions with outcome
>   ✓ delete() removes the decision
>   ✓ recall() returns empty after deletion
> ```
>
> **测试流程（顺序执行）：**
> 1. `record()` 3 条决策（相似情境），记录返回的 `id`
> 2. `listRecent()` 验证 3 条可见
> 3. `recall()` 使用相似上下文 → 应返回 0 条（因为 outcome 为 NULL）
> 4. `writeOutcome()` 为 3 条中的 2 条写入 outcome
> 5. `recall()` 使用相似上下文 → 应返回 2 条
> 6. `listPendingOutcomesOlderThan(0)` → 应返回 1 条（未写 outcome 的）
> 7. `delete()` 删除 1 条
> 8. `listRecent()` 验证剩余 2 条
>
> **关键断言：**
> - `context_vector` 维度 = 1536（确定性 embedding）
> - `similarity` 字段为 number 且 ∈ [0, 1]
> - `decided_at` 为有效时间戳
> - `outcome_at` 在 writeOutcome 后非 null
>
> **验证：**
> ```bash
> DATAOS_TEST_DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm --filter @patioer/dataos test -- decision-memory.integration --reporter=verbose
> ```
>
> **产出：** DecisionMemory 完整生命周期集成测试通过

---

> **🃏 CARD-D28-02 · Day 28 回归**
>
> ```bash
> pnpm --filter @patioer/dataos test
> pnpm test
> ```
>
> **产出：** Day 28 完成

---

**Day 28 卡片执行顺序汇总：**

```
09:00  CARD-D28-01  DecisionMemory 集成测试编写     (2.5h)
11:30  CARD-D28-02  回归                             (15min)
11:45  Day 28 完成
```

---

## Day 29 — Embedding 集成测试 + DecisionMemory 跨租户隔离测试

---

> **🃏 CARD-D29-01 · Embedding 服务集成测试**
>
> **类型：** 代码变更  
> **耗时：** 1h  
> **目标文件：** `packages/dataos/src/embeddings.test.ts`（追加）  
> **📜 对齐：** 数据系统 brainstorm Open Question #3「`vector(1536)` 是否与 embedding 模型锁定」 · Phase 3 Plan D13「pgvector:pg16」 · Phase 3 技术栈「OpenAI text-embedding-3-small 1536 维」 · Phase 3 Plan 任务 4.2
>
> **新增测试用例：**
> ```
> describe('embeddings integration')
>   ✓ deterministicEmbedding returns exactly 1536 dimensions
>   ✓ deterministicEmbedding is deterministic (same input → same output)
>   ✓ deterministicEmbedding produces different vectors for different inputs
>   ✓ deterministicEmbedding output is a unit vector (norm ≈ 1.0)
>   ✓ embedText uses deterministicEmbedding when no port is provided
>   ✓ embedText delegates to injected EmbeddingPort when provided
>   ✓ deterministicEmbeddingPort.embed returns same result as deterministicEmbedding
>   ✓ cosine similarity of similar texts > similarity of dissimilar texts (sanity)
> ```
>
> **新增辅助函数（测试内）：**
> ```typescript
> function cosineSimilarity(a: number[], b: number[]): number {
>   let dot = 0, normA = 0, normB = 0
>   for (let i = 0; i < a.length; i++) {
>     dot += a[i]! * b[i]!
>     normA += a[i]! ** 2
>     normB += b[i]! ** 2
>   }
>   return dot / (Math.sqrt(normA) * Math.sqrt(normB))
> }
> ```
>
> **验证：** `pnpm --filter @patioer/dataos test -- embeddings`
>
> **产出：** Embedding 服务全面测试

---

> **🃏 CARD-D29-02 · DecisionMemory 跨租户隔离集成测试**
>
> **类型：** 代码变更  
> **耗时：** 2h  
> **目标文件：** `packages/dataos/src/decision-memory.integration.test.ts`（追加 describe 块）  
> **📜 对齐：** Constitution Ch6.1「所有核心表 tenant_id + RLS」 · Phase 3 Plan D18「pgvector 检索 SQL 强制 tenant_id 谓词」 · 工程清单 §九「无跨租户数据泄露」 · 五阶段路线图「Phase 3 不做跨租户共享学习」 · **AC-P3-18** + **AC-P3-20** · Phase 3 Plan 任务 4.3
>
> **测试用例：**
> ```
> describe('DecisionMemory cross-tenant isolation (AC-P3-18, AC-P3-20)')
>   ✓ tenant A records 5 decisions → tenant B recall returns 0
>   ✓ tenant A records decisions → tenant B listRecent returns 0
>   ✓ tenant A records decisions → tenant B listPendingOutcomesOlderThan returns only own
>   ✓ tenant B cannot writeOutcome for tenant A's decision (UPDATE affects 0 rows)
>   ✓ tenant B cannot delete tenant A's decision (returns false)
>   ✓ recall with identical context across tenants returns disjoint result sets
> ```
>
> **测试流程：**
> 1. Tenant A `record()` 5 条相似情境决策
> 2. Tenant B `record()` 3 条不同情境决策
> 3. Tenant A `writeOutcome()` 全部 5 条
> 4. Tenant B `recall()` 使用 Tenant A 的上下文 → **必须返回 0 条**
> 5. Tenant A `recall()` 使用相同上下文 → **必须返回 ≥3 条**
> 6. Tenant B `writeOutcome()` 尝试写 Tenant A 的 decision ID → `UPDATE` 影响 0 行
> 7. Tenant B `delete()` 尝试删 Tenant A 的 decision → 返回 `false`
>
> **这是 AC-P3-18 / AC-P3-20 的直接验证。**
>
> **验证：**
> ```bash
> DATAOS_TEST_DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm --filter @patioer/dataos test -- decision-memory.integration --reporter=verbose
> ```
>
> **产出：** 跨租户隔离测试完整通过

---

> **🃏 CARD-D29-03 · Day 29 回归**
>
> ```bash
> pnpm --filter @patioer/dataos test
> pnpm test
> ```
>
> **产出：** Day 29 完成

---

**Day 29 卡片执行顺序汇总：**

```
09:00  CARD-D29-01  Embedding 集成测试              (1h)
10:00  CARD-D29-02  跨租户隔离集成测试              (2h)
12:00  CARD-D29-03  回归                             (15min)
12:15  Day 29 完成
```

---

## Day 30 — Insight Agent Worker 实现

---

> **🃏 CARD-D30-01 · Prometheus 指标：Insight Agent 专用**
>
> **类型：** 代码变更  
> **耗时：** 20 min  
> **目标文件：** `apps/dataos-api/src/metrics.ts`  
> **📜 对齐：** Constitution Ch8.1「`agent.budget.utilization` 等指标」 · Constitution Ch3.1「Prometheus + Grafana + OTel」 · 工程清单 §十「已上报 Prometheus 指标」
>
> **新增指标：**
>
> | 指标名 | 类型 | 含义 |
> |--------|------|------|
> | `dataos_insight_agent_ticks_total` | Counter | Insight Agent 执行次数 |
> | `dataos_insight_agent_outcomes_written_total` | Counter | 成功回写的 outcome 数量 |
> | `dataos_insight_agent_outcomes_failed_total` | Counter | 回写失败的 outcome 数量 |
> | `dataos_insight_agent_pending_decisions` | Gauge | 当前待回写的决策数量 |
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Insight Agent 可观测性指标就绪

---

> **🃏 CARD-D30-02 · `apps/dataos-api/src/workers/insight-agent.ts`**
>
> **类型：** 新建文件  
> **耗时：** 3h  
> **目标文件：** `apps/dataos-api/src/workers/insight-agent.ts`（新建）  
> **📜 对齐：** 蓝图 §02「DataOS 侧 Insight Agent」 · 五阶段路线图「Phase 3：3×DataOS Agent（Ingestion/Feature/Insight）」 · Phase 3 Plan 目录「`apps/dataos-api/src/workers/insight-agent.ts` — DA-03: 周一 09:00 → outcome 回写 + 周报」 · 数据系统 brainstorm「Agent 执行后写 Event → 异步刷新特征 → 写入决策与 outcome」 · Constitution Ch2.3「DataOS 是读特征/写事件，不替代 Harness」 · Constitution Ch4.3「结构化错误报告」 · **AC-P3-11** · Phase 3 Plan 任务 4.4
>
> **函数签名：**
> ```typescript
> export interface InsightAgentOptions {
>   /** Minimum age of a decision before trying outcome lookup (default 7 days). */
>   outcomeLookbackDays?: number
>   /** Max decisions to process per tick (default 100). */
>   maxDecisionsPerTick?: number
> }
>
> export function startInsightAgentInterval(
>   services: DataOsServices,
>   ms: number,
>   opts?: InsightAgentOptions,
> ): ReturnType<typeof setInterval>
>
> /** @internal Exported for unit testing. */
> export async function _runInsightAgentTick(
>   services: DataOsServices,
>   opts: InsightAgentOptions,
> ): Promise<{ processed: number; written: number; failed: number }>
> ```
>
> **`_runInsightAgentTick` 执行流程：**
>
> 1. 调用 `services.decisionMemory.listPendingOutcomesOlderThan(outcomeLookbackDays)`
>    → 获取待回写 outcome 的决策列表
> 2. 对每条决策，按 `(tenant_id, agent_id, entity_id)` 从 ClickHouse 聚合 outcome 数据：
>    ```sql
>    SELECT
>      count() AS events_after,
>      -- 如果 agent_id = 'price-sentinel'，查 price_events 获取调价后效果
>    FROM events
>    WHERE tenant_id = {tenantId:UUID}
>      AND entity_id = {entityId:String}
>      AND created_at > {decidedAt:DateTime64(3)}
>      AND created_at <= {decidedAt:DateTime64(3)} + INTERVAL 7 DAY
>    ```
> 3. 对 `price-sentinel` 的决策，额外查 `price_events` 获取：
>    - `conv_rate_7d`：调价后 7 天转化率
>    - `revenue_7d`：调价后 7 天营收
> 4. 构造 `outcome` 对象并调用 `services.decisionMemory.writeOutcome()`
> 5. 失败记录日志但不中断循环
>
> **约束：**
> - `setInterval` 包裹防重入 `running` 锁（参照 `feature-agent.ts` 模式）
> - 默认每周一 09:00 触发（由 `server.ts` 设置 `ms` 参数控制，或由外部 cron 触发）
> - 当无待处理决策时 no-op（仅递增 `insightAgentTicks`）
> - 处理每条决策后递增 `insightAgentOutcomesWritten` 或 `insightAgentOutcomesFailed`
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Insight Agent Worker 核心逻辑落地

---

> **🃏 CARD-D30-03 · `apps/dataos-api/src/server.ts` 集成 Insight Agent**
>
> **类型：** 代码变更  
> **耗时：** 30 min  
> **目标文件：** `apps/dataos-api/src/server.ts`
>
> **变更：**
> 1. `import { startInsightAgentInterval } from './workers/insight-agent.js'`
> 2. 在 Feature Agent 启动后调用：
>    ```typescript
>    const insightEveryMs = Number.parseInt(
>      process.env.DATAOS_INSIGHT_AGENT_MS ?? `${7 * 24 * 60 * 60 * 1000}`, 10,
>    )
>    const insightTimer = startInsightAgentInterval(services, insightEveryMs, {
>      outcomeLookbackDays: Number.parseInt(process.env.DATAOS_INSIGHT_LOOKBACK_DAYS ?? '7', 10),
>    })
>    ```
> 3. `shutdown()` 中加入 `clearInterval(insightTimer)`
>
> **环境变量（新增）：**
>
> | 变量 | 默认值 | 说明 |
> |------|--------|------|
> | `DATAOS_INSIGHT_AGENT_MS` | `604800000`（7天） | Insight Agent 触发间隔 |
> | `DATAOS_INSIGHT_LOOKBACK_DAYS` | `7` | 决策成熟天数 |
>
> **注意：** 生产环境建议使用外部 cron（`vercel.json` cron 或系统 crontab）触发 `/internal/v1/insight/trigger`，而非纯 `setInterval`。此处 `setInterval` 是本地开发兜底。
>
> **验证：**
> ```bash
> pnpm --filter @patioer/dataos-api typecheck
> ```
>
> **产出：** Insight Agent 随服务启动

---

> **🃏 CARD-D30-04 · Day 30 回归**
>
> ```bash
> pnpm --filter @patioer/dataos-api typecheck
> pnpm typecheck
> pnpm test
> ```
>
> **产出：** Day 30 完成

---

**Day 30 卡片执行顺序汇总：**

```
09:00  CARD-D30-01  Insight Agent Prometheus 指标    (20min)
09:20  CARD-D30-02  insight-agent.ts Worker 实现     (3h)
12:20  午餐
13:30  CARD-D30-03  server.ts 集成 Insight Agent     (30min)
14:00  CARD-D30-04  回归                              (15min)
14:15  Day 30 完成
```

---

## Day 31 — Insight Agent 单元测试 + 周报生成逻辑

---

> **🃏 CARD-D31-01 · `apps/dataos-api/src/workers/insight-agent.test.ts`**
>
> **类型：** 新建文件  
> **耗时：** 2h  
> **目标文件：** `apps/dataos-api/src/workers/insight-agent.test.ts`（新建）
>
> **测试策略：**
> - Mock `DataOsServices`（`services.decisionMemory.listPendingOutcomesOlderThan` / `writeOutcome`、`services.eventLake.raw`）
> - 直接调用 `_runInsightAgentTick()` 测试处理逻辑
>
> **测试用例：**
> ```
> describe('Insight Agent (_runInsightAgentTick)')
>   ✓ returns { processed: 0, written: 0, failed: 0 } when no pending decisions
>   ✓ queries CH for events after decision and writes outcome
>   ✓ queries price_events for price-sentinel decisions
>   ✓ constructs outcome with events_after count and conv_rate_7d
>   ✓ calls writeOutcome with correct decisionId and tenantId
>   ✓ increments outcomes_written counter on success
>   ✓ increments outcomes_failed counter on writeOutcome failure
>   ✓ continues processing remaining decisions after individual failure
>   ✓ respects maxDecisionsPerTick option
>   ✓ uses default 7 days lookback when option not provided
> ```
>
> **验证：** `pnpm --filter @patioer/dataos-api test -- insight-agent --reporter=verbose`
>
> **产出：** Insight Agent Worker 测试覆盖完整

---

> **🃏 CARD-D31-02 · Insight Agent 周报摘要逻辑**
>
> **类型：** 代码变更  
> **耗时：** 1.5h  
> **目标文件：** `apps/dataos-api/src/workers/insight-agent.ts`（追加）
>
> **新增：`_generateInsightReport` 内部函数**
> ```typescript
> /** @internal Generate a structured summary of this tick's outcomes. */
> export function _generateInsightReport(results: {
>   processed: number
>   written: number
>   failed: number
>   highlights: Array<{
>     decisionId: string
>     agentId: string
>     entityId?: string
>     outcome: unknown
>   }>
> }): InsightReport
>
> export interface InsightReport {
>   generatedAt: string          // ISO timestamp
>   processed: number
>   written: number
>   failed: number
>   highlights: Array<{
>     decisionId: string
>     agentId: string
>     entityId?: string
>     summary: string            // 简洁的 outcome 摘要
>   }>
> }
> ```
>
> **摘要规则：**
> - `price-sentinel` 决策：`"价格 {before}→{after}，7天转化率 {conv_rate_7d}%，营收 {revenue_7d}"`
> - 其他 agent：`"操作完成，后续 {events_after} 个事件"`
> - `highlights` 仅保留前 10 条（避免周报过大）
>
> **集成点（_runInsightAgentTick 修改）：**
> - Tick 结束时调用 `_generateInsightReport()` 并 `console.info('[dataos-insight-agent] report', report)`
> - 后续 Sprint 5 可将此 report 通过 DevOS Ticket 推送
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Insight Agent 周报生成逻辑

---

> **🃏 CARD-D31-03 · `_generateInsightReport` 单元测试**
>
> **类型：** 代码变更  
> **耗时：** 30 min  
> **目标文件：** `apps/dataos-api/src/workers/insight-agent.test.ts`（追加）
>
> **新增测试用例：**
> ```
> describe('_generateInsightReport')
>   ✓ generates report with correct counts
>   ✓ price-sentinel highlights include price and conv_rate summary
>   ✓ other agent highlights include events_after summary
>   ✓ highlights are capped at 10 items
>   ✓ generatedAt is a valid ISO timestamp
> ```
>
> **验证：** `pnpm --filter @patioer/dataos-api test`
>
> **产出：** 周报逻辑测试覆盖

---

> **🃏 CARD-D31-04 · Day 31 回归**
>
> ```bash
> pnpm --filter @patioer/dataos-api test -- --reporter=verbose
> pnpm test
> ```
>
> **产出：** Day 31 完成

---

**Day 31 卡片执行顺序汇总：**

```
09:00  CARD-D31-01  insight-agent.test.ts 单测       (2h)
11:00  CARD-D31-02  周报摘要逻辑 _generateInsightReport  (1.5h)
12:30  午餐
13:30  CARD-D31-03  _generateInsightReport 测试       (30min)
14:00  CARD-D31-04  回归                              (15min)
14:15  Day 31 完成
```

---

## Day 32 — DataOS API Memory 路由测试 + 触发端点

---

> **🃏 CARD-D32-01 · Insight Agent HTTP 触发端点**
>
> **类型：** 代码变更  
> **耗时：** 30 min  
> **目标文件：** `apps/dataos-api/src/internal-routes.ts`（追加）
>
> **新增路由：**
>
> | Method | Path | 说明 |
> |--------|------|------|
> | POST | `/internal/v1/insight/trigger` | 手动触发 Insight Agent tick |
>
> **实现：**
> ```typescript
> app.post('/internal/v1/insight/trigger', async (request, reply) => {
>   if (!requireKey(request, reply, internalKey)) return
>   const result = await _runInsightAgentTick(services, {
>     outcomeLookbackDays: 7,
>     maxDecisionsPerTick: 100,
>   })
>   return reply.send({ ok: true, ...result })
> })
> ```
>
> **约束：**
> - `_runInsightAgentTick` 需从 `insight-agent.ts` 导入
> - `registerInternalRoutes` 签名不变（`services` 已包含所有依赖）
>
> **验证：** `pnpm --filter @patioer/dataos-api typecheck`
>
> **产出：** Insight Agent 可通过 HTTP 触发（支持 cron + 手动调试）

---

> **🃏 CARD-D32-02 · DataOS API Memory 路由单元测试**
>
> **类型：** 新建文件  
> **耗时：** 2h  
> **目标文件：** `apps/dataos-api/src/internal-routes.test.ts`（新建或追加 memory describe）  
> **📜 对齐：** Constitution Ch2.5「跨域经 API」+ Ch9「API 鉴权」 · Phase 3 Plan §8 DataOS 内部 API 路由表 · 工程清单 §六「API 有端到端测试」 · Phase 3 Plan 任务 4.6
>
> **测试策略：**
> - 使用 `fastify.inject()` 模拟 HTTP 请求
> - Mock `DataOsServices`（所有 service 方法为 `vi.fn()`）
> - 验证正确的鉴权头、参数传递、错误处理
>
> **测试用例：**
> ```
> describe('Memory routes (/internal/v1/memory/*)')
>   describe('POST /memory/recall')
>     ✓ returns 401 without X-DataOS-Internal-Key
>     ✓ returns 400 without X-Tenant-Id
>     ✓ returns 400 with invalid body (missing agentId)
>     ✓ returns memories array on success
>     ✓ passes limit and minSimilarity to decisionMemory.recall
>
>   describe('POST /memory/record')
>     ✓ returns 401 without auth header
>     ✓ returns decision id on success
>     ✓ passes tenantId from X-Tenant-Id header (not body)
>
>   describe('POST /memory/outcome')
>     ✓ returns 403 when body tenantId ≠ X-Tenant-Id
>     ✓ calls writeOutcome with correct params on success
>
>   describe('GET /memory/decisions')
>     ✓ returns decisions list with agentId filter
>     ✓ returns empty list when no decisions
>
>   describe('DELETE /memory/decisions/:decisionId')
>     ✓ returns 400 for non-UUID decisionId
>     ✓ returns { deleted: true } when found
>     ✓ returns { deleted: false } when not found (cross-tenant)
>
>   describe('POST /insight/trigger')
>     ✓ returns 401 without auth header
>     ✓ returns tick result on success
> ```
>
> **验证：** `pnpm --filter @patioer/dataos-api test -- internal-routes --reporter=verbose`
>
> **产出：** Memory 路由全面测试

---

> **🃏 CARD-D32-03 · Day 32 回归**
>
> ```bash
> pnpm --filter @patioer/dataos-api test -- --reporter=verbose
> pnpm typecheck
> pnpm test
> ```
>
> **产出：** Day 32 完成

---

**Day 32 卡片执行顺序汇总：**

```
09:00  CARD-D32-01  Insight Agent 触发端点           (30min)
09:30  CARD-D32-02  Memory 路由单元测试              (2h)
11:30  CARD-D32-03  回归                              (15min)
11:45  Day 32 完成
```

---

## Day 33 — IVFFlat 索引 + pgvector 性能基准 + 召回精度调优

---

> **🃏 CARD-D33-01 · IVFFlat 索引条件创建脚本**
>
> **类型：** 新建文件  
> **耗时：** 45 min  
> **目标文件：** `scripts/dataos-apply-ivfflat.ts`（新建）  
> **📜 对齐：** Phase 3 Plan Sprint 1 Day 2「`scripts/dataos-pgvector-ivfflat.sql`（预留）」 · Phase 3 Plan 任务 4.7 · Phase 3 技术栈「pgvector/pgvector pg16」 · 数据系统 brainstorm「ClickHouse / pgvector 作为目标态能力」
>
> **实现要求：**
> 1. 连接 DataOS PG（`DATABASE_URL` 环境变量）
> 2. 查询 `SELECT count(*) FROM decision_memory` 检查行数
> 3. 行数 ≥ 100 时执行 `scripts/dataos-pgvector-ivfflat.sql`
> 4. 行数 < 100 时打印 `[ivfflat] skipped: only {n} rows (need ≥100)` 并 exit 0
> 5. 执行后验证索引存在：`SELECT indexname FROM pg_indexes WHERE tablename='decision_memory' AND indexname='decision_memory_context_vector_ivfflat'`
>
> **验证：**
> ```bash
> DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm exec tsx scripts/dataos-apply-ivfflat.ts
> # 行数不足时期望：[ivfflat] skipped: only 0 rows (need ≥100)
> ```
>
> **产出：** 可安全执行的 IVFFlat 索引应用脚本

---

> **🃏 CARD-D33-02 · pgvector 查询性能基准测试**
>
> **类型：** 新建文件  
> **耗时：** 2h  
> **目标文件：** `packages/dataos/src/decision-memory.benchmark.test.ts`（新建）  
> **📜 对齐：** Phase 3 风险表「pgvector 检索延迟/精度 — IVFFlat lists 调参 + similarity 阈值 0.85 可调」 · **AC-P3-09**（扩展到 pgvector 查询性能） · **AC-P3-12**（≥3 条历史案例） · Phase 3 Plan 任务 4.8
>
> **测试设计（`describe.skipIf(!process.env.DATAOS_TEST_DATABASE_URL)`）：**
>
> ```
> describe('DecisionMemory pgvector benchmark')
>   beforeAll:
>     - 插入 N 条测试数据（N = 100 / 1000 / 可选 10000）
>     - 每条使用 deterministicEmbedding(randomContext) 生成向量
>     - 为部分记录写入 outcome
>
>   ✓ recall with 100 rows completes in < 100ms
>   ✓ recall with 1000 rows completes in < 500ms
>   ✓ recall returns ≥ 3 similar decisions from 1000 rows
>   ✓ recall precision: top-3 results have similarity > 0.7 for known-similar contexts
>
>   afterAll:
>     - 清理所有基准测试数据
> ```
>
> **性能测量方法：**
> ```typescript
> const start = performance.now()
> const results = await svc.recall(tenantId, agentId, targetContext)
> const elapsed = performance.now() - start
> expect(elapsed).toBeLessThan(threshold)
> ```
>
> **结果输出：** 打印性能数据到 stdout，供归档。
>
> **验证：**
> ```bash
> DATAOS_TEST_DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm --filter @patioer/dataos test -- decision-memory.benchmark --reporter=verbose
> ```
>
> **产出：** pgvector 性能基线数据

---

> **🃏 CARD-D33-03 · Decision Memory 召回精度调优**
>
> **类型：** 代码变更 + 文档  
> **耗时：** 1h  
> **目标文件：** `packages/dataos/src/decision-memory.ts` + 基准测试结果
>
> **调优维度：**
>
> | 参数 | 当前默认值 | 调优范围 | 依据 |
> |------|-----------|---------|------|
> | `minSimilarity` | `0.85` | `0.70 – 0.90` | 基准测试实际 similarity 分布 |
> | `limit` | `5` | `3 – 10` | 取决于 prompt context window 容量 |
> | `WHERE outcome IS NOT NULL` | 是 | 保持 | 无 outcome 的记忆没有反馈价值 |
>
> **调优流程：**
> 1. 运行基准测试，收集 similarity 分布统计（min / p50 / p90 / max）
> 2. 若 p50 > 0.85 → 保持默认阈值
> 3. 若 p50 在 0.70-0.85 → 下调 `minSimilarity` 默认值到 `0.75`
> 4. 记录调优结论到代码注释
>
> **注意：** 使用确定性 embedding 的 similarity 分布与真实 OpenAI embedding 不同。确定性模式下阈值可能需要更低。建议在代码中保留可配置性，不硬编码。
>
> **验证：** 基准测试通过 + typecheck
>
> **产出：** 召回精度调优完成，参数可配置

---

> **🃏 CARD-D33-04 · Day 33 回归**
>
> ```bash
> pnpm --filter @patioer/dataos test
> pnpm typecheck
> pnpm test
> ```
>
> **产出：** Day 33 完成

---

**Day 33 卡片执行顺序汇总：**

```
09:00  CARD-D33-01  IVFFlat 索引条件创建脚本         (45min)
09:45  CARD-D33-02  pgvector 性能基准测试             (2h)
11:45  CARD-D33-03  召回精度调优                      (1h)
12:45  午餐
14:00  CARD-D33-04  回归                              (15min)
14:15  Day 33 完成
```

---

## Day 34 — Sprint 4 全量集成验证 + 检查点

---

> **🃏 CARD-D34-01 · Sprint 4 全量验证**
>
> **类型：** 验证  
> **耗时：** 2h
>
> **验证步骤：**
>
> ```bash
> # ── 1. 类型检查 ──────────────────────────────────
> pnpm typecheck
> # 期望：全 Done，0 errors
>
> # ── 2. 全量测试 ──────────────────────────────────
> pnpm test
> # 期望：0 failures
>
> # ── 3. DataOS 容器验证 ──────────────────────────
> docker-compose -f docker-compose.dataos.yml up -d
> sleep 5
> curl -s http://localhost:3300/health | jq .
> # 期望：{ "ok": true, "service": "dataos-api" }
>
> # ── 4. Memory Record 冒烟 ──────────────────────
> curl -s -X POST http://localhost:3300/internal/v1/memory/record \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -H 'X-Tenant-Id: 00000000-0000-0000-0000-000000000001' \
>   -d '{"agentId":"price-sentinel","platform":"shopify","entityId":"P001","context":{"price":29.99,"conv_rate":0.02},"action":{"newPrice":27.99}}' | jq .
> # 期望：{ "id": "<uuid>" }
>
> # ── 5. Memory Recall 冒烟 ──────────────────────
> curl -s -X POST http://localhost:3300/internal/v1/memory/recall \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -H 'X-Tenant-Id: 00000000-0000-0000-0000-000000000001' \
>   -d '{"agentId":"price-sentinel","context":{"price":30.00,"conv_rate":0.02}}' | jq .
> # 期望：{ "memories": [...] }（可能为空，因 outcome 尚未写入）
>
> # ── 6. Memory Outcome 冒烟 ──────────────────────
> # 使用 step 4 返回的 id
> DECISION_ID="<step 4 返回的 id>"
> curl -s -X POST http://localhost:3300/internal/v1/memory/outcome \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -H 'X-Tenant-Id: 00000000-0000-0000-0000-000000000001' \
>   -d "{\"tenantId\":\"00000000-0000-0000-0000-000000000001\",\"decisionId\":\"${DECISION_ID}\",\"outcome\":{\"conv_rate_7d\":0.025,\"revenue_7d\":850}}" | jq .
> # 期望：{ "ok": true }
>
> # ── 7. 验证 Recall 返回有 outcome 的记忆 ────────
> curl -s -X POST http://localhost:3300/internal/v1/memory/recall \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -H 'X-Tenant-Id: 00000000-0000-0000-0000-000000000001' \
>   -d '{"agentId":"price-sentinel","context":{"price":30.00,"conv_rate":0.02},"minSimilarity":0.3}' | jq .
> # 期望：memories 数组含刚写入 outcome 的记忆
>
> # ── 8. Insight Agent 触发冒烟 ──────────────────
> curl -s -X POST http://localhost:3300/internal/v1/insight/trigger \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' | jq .
> # 期望：{ "ok": true, "processed": 0, "written": 0, "failed": 0 }
> # (processed=0 因为刚写入的决策未超过 7 天)
>
> # ── 9. 跨租户隔离验证 ──────────────────────────
> curl -s -X POST http://localhost:3300/internal/v1/memory/recall \
>   -H 'Content-Type: application/json' \
>   -H 'X-DataOS-Internal-Key: dev-dataos-internal-key' \
>   -H 'X-Tenant-Id: 00000000-0000-0000-0000-000000000002' \
>   -d '{"agentId":"price-sentinel","context":{"price":30.00,"conv_rate":0.02},"minSimilarity":0.1}' | jq .
> # 期望：{ "memories": [] }（租户 B 看不到租户 A 的记忆）
>
> # ── 10. Prometheus 指标验证 ─────────────────────
> curl -s http://localhost:3300/metrics | grep dataos_insight
> # 期望：
> #   dataos_insight_agent_ticks_total
> #   dataos_insight_agent_outcomes_written_total
> #   dataos_insight_agent_outcomes_failed_total
> #   dataos_insight_agent_pending_decisions
>
> # ── 11. IVFFlat 脚本可执行 ─────────────────────
> DATABASE_URL=postgres://dataos:dataos@localhost:5434/dataos \
>   pnpm exec tsx scripts/dataos-apply-ivfflat.ts
> # 期望：[ivfflat] skipped 或 [ivfflat] created（取决于行数）
> ```

---

> **🃏 CARD-D34-02 · Sprint 4 检查点清单**
>
> | # | 检查项 | 对应验收 | 期望 |
> |---|--------|---------|------|
> | 1 | `listPendingOutcomesOlderThan` 方法存在 | 4.4 | `grep` 可见 |
> | 2 | `insight-agent.ts` 文件存在 | 4.4 | `ls` 可见 |
> | 3 | Insight Agent 集成到 `server.ts` | 4.4 | `grep insightTimer` 可见 |
> | 4 | POST `/insight/trigger` 返回 200 | 4.4, 4.5 | curl 验证 |
> | 5 | `_generateInsightReport` 函数存在 | 4.5 | `grep` 可见 |
> | 6 | Memory record → outcome → recall 完整链路 | AC-P3-10 | 冒烟测试通过 |
> | 7 | 跨租户 recall 返回 0 条 | AC-P3-20 | curl 验证 |
> | 8 | `decision-memory.integration.test.ts` 通过 | 4.1, 4.3 | vitest 通过 |
> | 9 | `decision-memory.benchmark.test.ts` 通过 | 4.8 | vitest 通过 |
> | 10 | Embedding 测试全面通过 | 4.2 | vitest 通过 |
> | 11 | `insight-agent.test.ts` 通过 | 4.4 | vitest 通过 |
> | 12 | `internal-routes.test.ts` memory 测试通过 | 4.6 | vitest 通过 |
> | 13 | IVFFlat 脚本可执行（条件跳过或创建） | 4.7 | exit 0 |
> | 14 | 4 个 Insight Agent Prometheus 指标可见 | 4.4 | `/metrics` curl |
> | 15 | `pnpm typecheck` 0 errors | — | exit 0 |
> | 16 | `pnpm test` 0 failures | — | exit 0 |
>
> **产出：** Sprint 4 全部验收通过 · 代码可安全合并

---

**Day 34 卡片执行顺序汇总：**

```
09:00  CARD-D34-01  全量验证（11 步冒烟）             (2h)
11:00  CARD-D34-02  检查点清单逐项确认                (30min)
11:30  Sprint 4 完成 → 进入 Sprint 5
```

---

## 附录 A：Sprint 4 文件变更汇总

| 操作 | 文件路径 | Day |
|------|----------|-----|
| **变更** | `packages/dataos/src/decision-memory.ts` | D27 |
| **变更** | `packages/dataos/src/decision-memory.test.ts` | D27 |
| **新建** | `packages/dataos/src/decision-memory.integration.test.ts` | D27, D28, D29 |
| **变更** | `packages/dataos/src/embeddings.test.ts` | D29 |
| **变更** | `apps/dataos-api/src/metrics.ts` | D30 |
| **新建** | `apps/dataos-api/src/workers/insight-agent.ts` | D30, D31 |
| **变更** | `apps/dataos-api/src/server.ts` | D30 |
| **新建** | `apps/dataos-api/src/workers/insight-agent.test.ts` | D31 |
| **变更** | `apps/dataos-api/src/internal-routes.ts` | D32 |
| **新建** | `apps/dataos-api/src/internal-routes.test.ts` | D32 |
| **新建** | `scripts/dataos-apply-ivfflat.ts` | D33 |
| **新建** | `packages/dataos/src/decision-memory.benchmark.test.ts` | D33 |

---

## 附录 B：Sprint 4 与 Phase 3 验收项映射

| Sprint 4 任务 | Phase 3 验收项 | Day |
|---------------|---------------|-----|
| 4.1 集成测试 | AC-P3-10（decision_memory 有记录） | D28 |
| 4.2 Embedding 测试 | AC-P3-12（向量召回） | D29 |
| 4.3 跨租户隔离 | AC-P3-18 / AC-P3-20（隔离验证） | D29 |
| 4.4 Insight Agent | AC-P3-11（每周一回写 outcome） | D30 |
| 4.5 周报生成 | AC-P3-11 + DevOS 协议 | D31 |
| 4.6 路由测试 | — (工程质量) | D32 |
| 4.7 IVFFlat 索引 | AC-P3-12（向量检索性能） | D33 |
| 4.8 性能基准 | AC-P3-09（查询 <2s 扩展到 pgvector） | D33 |
| 4.9 精度调优 | AC-P3-12（≥3 条历史案例） | D33 |
| 4.10 集成验证 | 全部 Sprint 4 AC | D34 |

---

## 附录 C：环境变量（Sprint 4 新增）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATAOS_INSIGHT_AGENT_MS` | `604800000` (7 天) | Insight Agent 触发间隔 ms |
| `DATAOS_INSIGHT_LOOKBACK_DAYS` | `7` | 决策需要多少天后才做 outcome 回写 |
| `DATAOS_TEST_DATABASE_URL` | (无) | 集成测试专用 PG 连接字符串 |

---

## 附录 D：Constitution 合规清单（Sprint 4 出口 Gate）

> 参照工程清单 brainstorm：**任一条不满足 → 不允许合入 / 不允许部署**。

### 架构合规（Ch2）

- [ ] Insight Agent **不**直调任何平台 SDK（Ch2.3 Harness 抽象）
- [ ] Insight Agent **不**跨模块直接访问 ElectroOS PG（Ch2.5 数据所有权）
- [ ] DataOS API 所有路由通过 `X-DataOS-Internal-Key` 鉴权（Ch2.2 API First / Ch9 安全）
- [ ] 新增 `/insight/trigger` 路由遵循 `/internal/v1/` 版本化（Ch2.2）

### Agent 行为（Ch5）

- [ ] Insight Agent 有 `maxDecisionsPerTick` 预算封顶（Ch5.3 超预算停止）
- [ ] Insight Agent 失败时生成结构化报告 `InsightReport`（Ch5.3）
- [ ] Insight Agent tick 结果写入日志（Ch5.3 不可变审计）
- [ ] recall SQL 强制 `WHERE tenant_id = $1 AND agent_id = $2`（Ch5.2 禁止跨租户访问）

### 多租户隔离（Ch6）

- [ ] `decision_memory` 表有 `tenant_id` 列（Ch6.1）
- [ ] `recall()` SQL 强制 `WHERE tenant_id`（Ch6.1 + Phase 3 D18）
- [ ] `writeOutcome()` SQL 强制 `WHERE tenant_id`（Ch6.1）
- [ ] `listPendingOutcomesOlderThan()` 返回结果含 `tenant_id`（供 Insight Agent 按租户处理）
- [ ] 跨租户隔离集成测试 6 项全部通过（Ch6.1 验证）

### 可观测性（Ch8）

- [ ] 4 个 Insight Agent Prometheus 指标已注册并可导出（Ch8.1）
- [ ] `dataos_insight_agent_outcomes_failed_total` 可触发 P2 告警（Ch8.2）

### 测试（Ch7.2）

- [ ] Sprint 4 新增代码不导致全量测试覆盖率低于 80%
- [ ] `pnpm test` 全量 0 failures
- [ ] `pnpm typecheck` 0 errors

---

## 附录 E：Sprint 4 显式「不做」确认（与上游文档对齐）

> 以下项目在上游文档中明确标注为 Phase 3「不做」或 Sprint 5+ 范围。Sprint 4 **显式不实现**，避免范围蔓延。

| 不做项 | 来源 | 对应 Sprint |
|--------|------|------------|
| **跨租户共享学习** | 五阶段路线图 Phase 3「不做」 | Phase 4 |
| **强化学习训练** | Phase 3 Plan §0「不做」 | Phase 4 |
| **DataOS 对外公共 API** | Phase 3 Plan §0「不做」 | Phase 4 |
| **Price Sentinel 接入 Feature Store / Decision Memory** | Phase 3 Plan Sprint 5 任务 5.4–5.6 | Sprint 5 |
| **Content Writer / Market Intel Agent 实现** | Phase 3 Plan Sprint 5 任务 5.7–5.8 | Sprint 5 |
| **DataOS 降级测试（Agent 无记忆模式）** | Phase 3 Plan Sprint 5 任务 5.9 / D17 | Sprint 5 |
| **A/B 可观测指标定义** | Phase 3 Plan Sprint 5 任务 5.10 | Sprint 5 |
| **Insight Agent → DevOS Ticket 推送** | Phase 3 Plan Sprint 5 + 蓝图 §03 Dev Loop | Sprint 5（周报逻辑 D31 预留接口） |
| **IVFFlat 索引生产执行** | Phase 3 Plan Day 2 CARD-D2-03 注释「Sprint 4 数据量足够后」 | D33 脚本就绪，行数不足时跳过；生产执行视数据量 |

---

## 附录 F：上游文档完整索引

| 文档 | 路径 | Sprint 4 引用章节 |
|------|------|------------------|
| **System Constitution v1.0** | `docs/system-constitution.md` | Ch2.3, Ch2.4, Ch2.5, Ch4.3, Ch5.1, Ch5.3, Ch6.1, Ch7.2, Ch8.1, Ch9 |
| **Master Blueprint Brainstorm** | `docs/brainstorms/2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md` | §02 Agents, §05 Governance, §06 Constitution, §07 Phase 3 |
| **Constitution PDF Brainstorm** | `docs/brainstorms/2026-03-21-electroos-system-constitution-pdf-brainstorm.md` | 章节约览表全部 |
| **数据系统结构 Brainstorm** | `docs/brainstorms/2026-03-21-electroos-data-system-structure-brainstorm.md` | 三层闭环, Decision Memory 技术选型, Mermaid 数据流, Open Question #3 |
| **五阶段路线图 Brainstorm** | `docs/brainstorms/2026-03-21-electroos-phase1-5-roadmap-pdf-brainstorm.md` | Phase 3 范围与「不做」 |
| **工程师检查清单 Brainstorm** | `docs/brainstorms/2026-03-21-electroos-engineering-checklist-brainstorm.md` | §五 DataOS 集成, §六 测试, §九 多租户, §十 可观测性, §十一 反模式 |
| **Phase 3 实施计划** | `docs/plans/phase3-plan.md` | §0 决策 D13–D18, §2 Sprint 4 任务表, §3 接口定义, §6 隔离方案, §7 风险表, §8 API 路由表, §9 AC 清单 |
| **ADR-0003** | `docs/adr/0003-phase3-dataos-stack.md` | DataOS 栈选型、端口分配 |
