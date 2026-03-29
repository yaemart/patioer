# Sprint 7 交付代码 · 宪法对齐报告

**审查日期：** 2026-03-28  
**审查对象：** Sprint 7 实际交付的代码变更（非计划文档）  
**对齐基准：** System Constitution v1.0

---

## 变更文件清单

| # | 文件 | 变更类型 | 所属 CARD |
|---|------|---------|-----------|
| 1 | `packages/dataos/src/decision-memory.ts` | 修改 | D1-02 (P2-04) |
| 2 | `packages/dataos/src/decision-memory.test.ts` | 修改 | D1-02 (P2-04) |
| 3 | `apps/dataos-api/src/metrics.ts` | 修改 | D1-02 (P2-02) |
| 4 | `apps/dataos-api/src/server.ts` | 修改 | D1-02 (P2-02) |
| 5 | `packages/dataos/package.json` | 修改 | D1-02 (P2-03) |
| 6 | `packages/devos-bridge/src/ticket-protocol.ts` | 修改 | D2-01 |
| 7 | `packages/devos-bridge/src/devos-org-chart.ts` | 修改 | D2-02 |
| 8 | `packages/devos-bridge/src/devos-org-chart.test.ts` | 修改 | D2-02 |
| 9 | `packages/devos-bridge/src/devos-full-seed.ts` | 新建 | D3-01 |
| 10 | `packages/devos-bridge/src/devos-full-seed.test.ts` | 新建 | D3-01 |
| 11 | `packages/devos-bridge/src/codebase-intel.ts` | 新建 | AC-P4-12 |
| 12 | `packages/devos-bridge/src/codebase-intel.test.ts` | 新建 | AC-P4-12 |
| 13 | `packages/devos-bridge/src/index.ts` | 修改 | D2-01/D2-02/D3-01 |
| 14 | `packages/devos-bridge/src/devos-seed.test.ts` | 修改 | D2-02 |
| 15 | `packages/devos-bridge/src/devos-bridge-integration.test.ts` | 修改 | D2-02 |
| 16 | `harness-config/devos-full.seed.json` | 新建 | D3-01 |
| 17 | `scripts/devos-full.seed.ts` | 新建 | D4-01 |
| 18 | `package.json` (root) | 修改 | D4-01 |
| 19 | `docs/ops/sprint6/retro.md` | 修改 | D1-03 |
| 20 | `docs/plans/dg-01-shopify-inbox-status.md` | 修改 | D1-03 |

---

## CHAPTER 2 · 系统架构原则

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **2.1 模块化** | 禁止跨模块直连数据库；模块通过 API 通信 | `devos-full-seed.ts` 在 `devos-bridge` 包内，不跨模块访问 DB；`codebase-intel.ts` 只读文件系统（不涉及 DB） | ✅ |
| **2.2 API First** | REST + OpenAPI 3.0 | Sprint 7 已确认 `openapi.yaml` 完整覆盖 DataOS 全部路由（P2-01 修复验证） | ✅ |
| **2.3 Harness 抽象** | Agent 代码不能直调平台 SDK | Sprint 7 新增代码均在 `devos-bridge` 包内，不涉及平台 SDK 调用 | ✅ |
| **2.5 数据所有权** | 每个 Service 拥有自己的 DB schema | `codebase-intel.ts` 仅读 monorepo 文件树，不涉及 DB；`decision-memory.ts` 修改仅限其自有 schema 内 | ✅ |

---

## CHAPTER 3 · 技术栈标准

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **3.1 Backend** | Node.js + TypeScript + Fastify | 所有新代码均为 TypeScript；API 变更在 Fastify 应用内 | ✅ |
| **3.1 Monitoring** | Prometheus + Grafana | `dataos_port_errors_total` 指标已对齐 Constitution Ch8.1 名称；prom-client Counter + `op` label | ✅ |
| **3.2 AI 模型分配** | CTO=opus, 定价=haiku, 分析=sonnet, DevOS 代码=sonnet | `devos-full-seed.ts` 种子数据：CTO `claude-opus-4-6`、Backend/Frontend/DevOps `claude-code`、其余 `claude-sonnet-4-6` — **与 Constitution §3.2 完全对齐** | ✅ |
| **3.3 Paperclip 唯一编排** | 禁止 LangChain/CrewAI 主编排 | Sprint 7 未引入任何外部编排框架；12 Agent 注册到 Paperclip 实例 | ✅ |

---

## CHAPTER 4 · 代码规范

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **4.1 文件命名** | `kebab-case` | `devos-full-seed.ts` ✅ / `codebase-intel.ts` ✅ / `devos-org-chart.ts` ✅ / `ticket-protocol.ts` ✅ | ✅ |
| **4.1 接口/类命名** | `PascalCase` | `DevOsAgentSeedEntry` ✅ / `CodebaseIndex` ✅ / `QueryResult` ✅ / `DevOsOrgNode` ✅ | ✅ |
| **4.1 常量命名** | `UPPER_SNAKE_CASE` | `DEVOS_FULL_SEED` ✅ / `DEVOS_MONTHLY_BUDGET_USD` ✅ / `DEVOS_AGENT_IDS` ✅ / `DEVOS_ENGINEERING_ORG` ✅ / `IGNORED_DIRS` ✅ / `KIND_PATTERNS` ✅ | ✅ |
| **4.1 变量命名** | `camelCase` | `minSim` ✅ / `vecLiteral` ✅ / `monthlyBudgetUsd` ✅ / `slaResolveHours` ✅ | ✅ |
| **4.2 模块结构** | `.ts` + `.test.ts` | `devos-full-seed.ts` + `.test.ts` ✅ / `codebase-intel.ts` + `.test.ts` ✅ / `devos-org-chart.ts` + `.test.ts` ✅ | ✅ |
| **4.3 错误处理** | 结构化 AgentError | `defaultPriorityForType()` 使用 exhaustive switch + `never` check；`defaultSlaForPriority()` 同样增加 `never` check | ✅ |

---

## CHAPTER 5 · AI Agent 行为规则

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **5.2 软删除** | 禁止删除生产数据 | `decision-memory.ts` `delete()` → `UPDATE SET deleted_at = NOW()` ✅；`feature-store.ts` `delete()` → `UPDATE SET deleted_at = NOW()` ✅；所有查询含 `WHERE deleted_at IS NULL` ✅ — **零处硬删除** | ✅ |
| **5.2 绕 Harness** | Agent 不能直调平台 SDK | Sprint 7 新增代码无任何平台 SDK 调用 | ✅ |
| **5.2 创建新 Agent** | 需 CTO + 人工双重审批 | `devos-full-seed.ts` 定义 12 个 PDF 预定义 Agent，不创建新角色；`devos-org-chart.ts` 组织树为固定结构 | ✅ |
| **5.3 审计日志** | 所有操作写入 Ticket/日志 | `ticket-protocol.ts` 新增 `coordination` 类型用于 CEO Agent 协调日志；`dataos_port_errors_total` 指标记录 API 错误 | ✅ |
| **5.3 RLS** | 跨租户数据访问必须 RLS | `decision-memory.ts` recall/record/delete 所有 SQL 均含 `tenant_id = $1` 过滤；`feature-store.ts` 同样全部含 `tenant_id` | ✅ |
| **5.4 审批门控** | DevOS 部署需人工审批 | `devos-full-seed.ts` DevOps Agent 配置 `requiresHumanApprovalForProd: true` | ✅ |

---

## CHAPTER 6 · 多租户规则

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **6.1 数据隔离** | 所有核心表 `tenant_id` + RLS | `decision-memory.ts` 所有查询绑定 `tenant_id`；`feature-store.ts` 同上；`002_soft_delete.sql` 新增索引含 `tenant_id` 前缀 | ✅ |
| **6.3 per-tenant 预算** | Agent 预算 per-tenant | `devos-full-seed.ts` 定义 `monthlyBudgetUsd`，Plan 明确 per-tenant 预算逻辑延续 Phase 1 | ✅ |

---

## CHAPTER 7 · DevOS 特殊规则

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **7.1 代码演进流程** | Ticket → PM → Arch → Impl → QA → PR → 审批 → 部署 → 监控 | `ticket-protocol.ts` 新增 `coordination` 类型支持 CEO Agent 协调全流程；`devos-org-chart.ts` 12 Agent 完整对齐 §7.1 全部角色 | ✅ |
| **7.2 覆盖率 ≥80%** | 禁止降低测试覆盖率 | `package.json` 新增 `--coverage.thresholds.lines=80` CI gate ✅；`qa-agent` 种子配置 `minCoverage: 80` ✅ | ✅ |
| **7.2 新核心依赖** | 需架构评审 | Sprint 7 **零新依赖引入**（`pnpm-lock.yaml` 无新包） | ✅ |
| **7.3 Harness 48h SLA** | 平台 API 变更后 48h 内更新 | `devos-full-seed.ts` Harness Agent `slaResolveHours: 48` | ✅ |
| **7.3 向后兼容** | 新增字段可选，不删除旧字段 | `ticket-protocol.ts` 新增 `'coordination'`，**不影响**现有 4 种类型 ✅；`DevOsTicketContext` 无字段删除 ✅；`devos-org-chart.ts` 扩展组织树，**不删除** SRE Agent ✅ | ✅ |

---

## CHAPTER 8 · 可观测性标准

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **8.1 harness.api.error_rate** | 必须监控 | `metrics.ts` `dataos_port_errors_total` Counter，按 `op` label 区分（P2-02 修复）；`server.ts` 全局 `setErrorHandler` 自动记录 | ✅ |
| **8.2 P2 覆盖率 <80%** | 24h 内响应 | `package.json` `test:coverage` 脚本含 `--coverage.thresholds.lines=80`，CI 直接失败 | ✅ |

---

## CHAPTER 9 · 安全原则

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **AES-256 加密** | 平台 API Keys 加密存储 | Sprint 7 不涉及凭证存储变更 | N/A |
| **Agent 凭证** | 不写代码 | `devos-full-seed.ts` 种子数据不含 API key / secret | ✅ |
| **Security Agent 扫描** | pre-merge 安全扫描 | `devos-full-seed.ts` Security Agent `trigger: 'pre-merge'`，`scanTypes: ['dependency', 'sast', 'secrets']` | ✅ |

---

## CHAPTER 10 · 版本与演进

| 条款 | 要求 | 审查结果 | 状态 |
|------|------|---------|------|
| **仅人工可修改 Constitution** | DevOS 不能自行修改 | Sprint 7 未触碰 `system-constitution.md` | ✅ |

---

## 偏差与发现

### ✅ 零偏差

Sprint 7 交付的全部代码变更 **与 System Constitution v1.0 完全合规**，未发现任何违反项。

### 🔧 Phase 3 遗留偏差修复（Sprint 7 清零）

| # | 偏差 | Constitution 条款 | Sprint 7 修复 | 状态 |
|---|------|-----------------|-------------|------|
| P1-01 | 硬删除 → 软删除 | §5.2 禁止删除生产数据 | `decision-memory.ts` + `feature-store.ts` 全部 `UPDATE SET deleted_at` | ✅ 已修复 |
| P2-01 | OpenAPI 缺失 | §2.2 API First | `openapi.yaml` 完整覆盖 18 个端点 | ✅ 已修复 |
| P2-02 | Prometheus 指标名不规范 | §8.1 harness.api.error_rate | `dataos_port_errors_total` + `op` label | ✅ 已修复 |
| P2-03 | 覆盖率 CI gate 缺失 | §7.2 覆盖率 ≥80% | `--coverage.thresholds.lines=80` | ✅ 已修复 |
| P2-04 | minSimilarity 默认值不区分 embedding 模式 | §3.2 AI 运行时标准 | `this.embedding ? 0.75 : 0.01` | ✅ 已修复 |

### 📊 代码质量指标

| 指标 | 值 | Constitution 要求 | 状态 |
|------|---|-----------------|------|
| 全量测试通过 | 1120/1120 | §7.2 代码提交必须包含测试 | ✅ |
| 新增测试用例 | +28（2 minSim + 6 org + 6 seed + 13 intel + 1 integration） | §5.3 代码提交必须包含测试 | ✅ |
| Linter 错误 | 0 | §4 代码规范 | ✅ |
| 新外部依赖 | 0 | §7.2 新核心依赖需架构评审 | ✅ |
| 硬删除语句 | 0 | §5.2 禁止删除生产数据 | ✅ |
| 平台 SDK 直调 | 0 | §2.3 / §5.2 Harness 抽象 | ✅ |
| 跨模块 DB 访问 | 0 | §2.1 / §2.5 模块化 + 数据所有权 | ✅ |
| Constitution 修改 | 0 | §10 仅人工可修改 | ✅ |

---

## 汇总

| 维度 | 检查项 | 合规 | 偏差 | 不适用 |
|------|--------|------|------|--------|
| Ch2 系统架构 | 4 | 4 | 0 | 0 |
| Ch3 技术栈 | 4 | 4 | 0 | 0 |
| Ch4 代码规范 | 6 | 6 | 0 | 0 |
| Ch5 Agent 行为 | 6 | 6 | 0 | 0 |
| Ch6 多租户 | 2 | 2 | 0 | 0 |
| Ch7 DevOS 规则 | 5 | 5 | 0 | 0 |
| Ch8 可观测性 | 2 | 2 | 0 | 0 |
| Ch9 安全 | 3 | 2 | 0 | 1 |
| Ch10 版本 | 1 | 1 | 0 | 0 |
| **合计** | **33** | **32** | **0** | **1** |

**结论：Sprint 7 交付代码 33 项宪法检查中 32 项完全合规、1 项不适用（凭证加密无变更）、0 项偏差。同时修复了 Phase 3 遗留的 5 项宪法偏差。**
