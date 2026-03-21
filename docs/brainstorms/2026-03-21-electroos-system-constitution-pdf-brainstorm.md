---
date: 2026-03-21
topic: electroos-system-constitution-pdf
version: "1.0"
source_pdf: "workspaceStorage/.../system-constitution.pdf (user local)"
related:
  - docs/brainstorms/2026-03-21-electroos-devos-constitution-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-engineering-checklist-brainstorm.md
---

# System Constitution v1.0（PDF）— 头脑风暴摘要

## What We're Building

将 **`System Constitution` PDF（v1.0，9 章 + 序言）** 提炼为仓库内 **单一 WHAT 索引**：作为 **ElectroOS + DevOS 最高法则**，规定使命、架构、技术栈、代码与 Agent 行为、多租户、DevOS 特殊规则、可观测性、安全与版本治理。  
**执行要求（PDF）：** 所有 AI Agent 在生成代码、决策、改系统前 **必须先读本文**；违反须 **拒绝或上报人工审批**。

文中与 [`2026-03-21-electroos-devos-constitution-brainstorm.md`](./2026-03-21-electroos-devos-constitution-brainstorm.md)（十条坑/MUST）、[`2026-03-21-electroos-engineering-checklist-brainstorm.md`](./2026-03-21-electroos-engineering-checklist-brainstorm.md)（清单）**同一脉络**；本文件对齐 **正式 PDF 章节编号与措辞**。

## Why This Approach

成文的 Constitution 是 **Guard / CI / Agent system prompt** 的 **正本来源**；与 Master Blueprint 中的「十章摘要」一致，但 **PDF 更细**（模块目录、错误类型、模型表、指标名、变更流程）。

## Preamble（序言）

- 两层系统 **最高法则**；**ElectroOS** = 运营电商；**DevOS** = 维护 ElectroOS。  
- 关系：`DevOS builds & maintains → ElectroOS`；`ElectroOS → reports → DevOS`。

## 章节约览（与 PDF 对齐）

| 章 | 核心内容 |
|----|----------|
| **1 使命** | ElectroOS：多平台多租户全自动化运营；DevOS：自主开发/维护/升级；人类战略、AI 执行 |
| **2 架构** | 模块化、禁跨模块直 DB；**API First**（REST+OpenAPI，`/api/v1`、旧版 ≥12 月）；**PlatformHarness**（示例接口）；事件列表；**数据所有权**（每服务自有 schema，仅 API/Event） |
| **3 技术栈** | Node+TS+Fastify；Next+React+Tailwind；PG+Redis；**Drizzle**（禁 Prisma）；**BullMQ**；Docker+K8s；GitHub Actions；Prometheus+Grafana+OTel；**模型分工表**（Haiku/Sonnet/Opus）；**编排：仅 Paperclip**（PDF 写 `fork: electroos/paperclip`）；禁 LangChain/CrewAI/AutoGen **作为主编排**；Agent 内可用 LangChain 工具能力 |
| **4 代码** | 命名（camelCase/PascalCase/kebab-case）；**标准目录** controller/service/repository/types/schema/test；**AgentError** 分类：budget_exceeded、approval_required、harness_error、rate_limited |
| **5 Agent 行为** | **Pre-flight**：goal_context、budget、pending approval、读 Constitution；**禁止**：直 DB、绕 Harness、删生产数据、**调价 >15% 未批**、**广告日预算变动 >30% 未批**、Agent **不可改 Constitution**、新建 Agent 角色需 **CTO+人工**；**必须**：写 Paperclip Ticket、超预算停、失败结构化报告、RLS、提交带测试；**门控表**：调价>15%、广告日预算>$500、上架、生产部署、新 Harness 方法、DB schema 变更 |
| **6 多租户** | `tenant_id` + RLS；租户可覆盖：价格审批阈值 **5–30%**（默认 15%）、月预算、客服语言、凭证加密；预算 **per-tenant** |
| **7 DevOS** | Ticket→PM→Arch→实现→QA→PR→可选人工 CR→**人工批部署**→监控；**禁止**：直改生产 DB、绕 CI/CD、DevOS 改 Constitution、覆盖率 <80%、未经评审的新核心依赖；**Harness：48h SLA**、向后兼容、集成测试 |
| **8 可观测** | ElectroOS/DevOS 指标清单；**P0** harness 错误率 **>5%** 等；P1/P2 规则 |
| **9 安全** | JWT；RBAC；AES-256；Secrets Manager；PR **npm audit** |
| **10 版本** | v1.0；**仅人工可改 Constitution**；**每季度评审**；变更记录 **`/docs/constitution-changelog.md`** |

## 与 Master Blueprint / 既有决议的对照

| 点 | PDF Constitution | 本仓库已决议 |
|----|------------------|--------------|
| **仓库** | Ch3.3 写 Paperclip `fork: electroos/paperclip` | [**独立 Monorepo B**](./2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md)：Paperclip **依赖或并排**，非必须 fork 进业务仓主路径 |
| **门控** | 调价>15%、广告>$500、上架、部署等 | 与 [Master Blueprint PDF](./2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md) **一致** |
| **自动调权（关键词 weight）** | 未单独成章 | [Tenant Override](./2026-03-21-electroos-tenant-override-brainstorm.md)：**自动生效+审计+回滚**，与高风险门控并行 |

**Recommendation：** 以 **PDF 为 Agent/Guard 正本**；**Paperclip 集成**在 plan 中写一句：**「编排仅 Paperclip，接入方式遵循 Master 仓库策略 B」**，避免与 Ch3.3 字面 fork 冲突。

## Approaches Considered（正本存放）

| 方案 | 描述 | 适用 |
|------|------|------|
| **A. `/docs/system-constitution.md` 从 PDF 汇编** | 与 PDF §08/Master 快速启动一致 | **推荐**：单文件给 Agent 读 |
| **B. 仅保留本 brainstorm** | 摘要代替全文 | 不够，Agent 需完整条款 |
| **C. PDF 二进制入 `docs/assets/`** | 真源 | 便于 diff 困难；可 **附件** + Markdown 正本 |

## Key Decisions（采纳 PDF）

- **v1.0** 为当前最高法则；修改 **仅人工**；**每季度评审**；changelog 路径按 PDF。  
- **Harness 不可绕过、Drizzle、Paperclip 唯一编排、Pre-flight、门控、RLS、DevOS 纪律、48h Harness SLA、覆盖率 ≥80%** 为 **硬约束**。  
- **禁止主编排用 LangChain/CrewAI/AutoGen** 与允许 **Agent 内 LangChain 工具** 的边界须写进 Guard 规则说明。

## Open Questions

1. **ADR 文件：** 是否单独新增 `docs/adr/0001-paperclip-integration.md` 指向 **独立 Monorepo + Paperclip 依赖/并排**（可选，便于审计）。

## Resolved Questions

- PDF **9 页全文**已提取并映射至本摘要；本地路径见用户 workspace（`source_pdf`）。  
- **正本落地（已执行）：** 仓库内已新增 **[`../system-constitution.md`](../system-constitution.md)**（v1.0）与 **[`../constitution-changelog.md`](../constitution-changelog.md)** 首条；Ch3.3 已写入 **Paperclip 唯一编排 + Monorepo/ADR 对齐说明**，缓解与 **仓库策略 B** 的字面冲突。

## Next Steps

→ **`/workflows:plan`**：**Guard 规则与章节映射表**；可选 **ADR**；Agent system prompt 统一加入：`Before any action, read /docs/system-constitution.md`（路径相对仓库根）。
