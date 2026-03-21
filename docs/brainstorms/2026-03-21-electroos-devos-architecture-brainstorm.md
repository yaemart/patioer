---
date: 2026-03-21
topic: electroos-devos-architecture
---

# ElectroOS / DevOS 双层架构与 DevOS 闭环 — 头脑风暴

## What We're Building

定义一套**双层 AI 系统**：**ElectroOS** 面向租户运营电商业务（选品、定价、广告、库存、客服、分析等），**DevOS** 面向内部工程能力，自主完成从 Ticket 到设计、实现、测试、部署前审批、上线与监控的闭环。两层通过 **Ticket / Bug / 需求上报** 衔接：ElectroOS 发现问题，DevOS 演进系统；生产部署保留**人工审批**作为硬闸门。

配套约定包括：**API First（REST + OpenAPI，长期版本化）**、**PlatformHarness 抽象**（禁止 Agent 直连各电商平台 SDK）、**事件驱动**（跨域解耦与审计）、**多租户数据所有权**（服务自有 schema、RLS + `tenant_id`）、以及 **Phase 3 起的 DataOS**（事件湖、特征库、决策记忆）。编排层明确采用 **Paperclip** 作为唯一 Agent 编排框架。

本头脑风暴文档回答 **要构建什么能力与边界**，不展开具体文件与实现步骤（留给 `/workflows:plan`）。

## Why This Approach

在「大而全一次到位」与「分阶段落地」之间，优先选择与 Phase 1–4 里程碑一致的**渐进式平台化**：先打通租户模型与 Harness 契约，再叠事件与 DataOS，最后上 DevOS 九阶段自治闭环与全套 Agent。这与 YAGNI 一致：未出现规模与合规压力前，不默认引入最重组件。

## Approaches Considered

### Approach A：单 Monorepo + 逻辑双平面（推荐）

在同一仓库内用包边界划分 `electroos-*` 与 `devos-*` 服务，共享 `platform-harness`、共享类型与 CI；生产上可为两套 Helm/环境，但代码与契约统一演进。

**Pros：** 契约同步成本低；Harness 与 API 版本可统一治理；本地开发一条命令起多服务。  
**Cons：** 仓库变大；权限与发布节奏需纪律（避免 Dev 误触 Prod 配置）。  
**Best when：** 团队规模中小、希望快速迭代且强依赖统一类型与 OpenAPI。

### Approach B：双仓库 + 契约包

ElectroOS 与 DevOS 分仓，通过独立发布的 `@electroos/contracts` npm 包同步 OpenAPI / 类型。

**Pros：** 访问隔离清晰；对外开源 ElectroOS 时可脱敏 DevOS。  
**Cons：** 版本漂移风险；契约变更流程更重。  
**Best when：** 组织上两套团队完全独立或 DevOS 必须物理隔离。

### Approach C：Paperclip 仅作「外层」，业务运行时自建

编排全部走 Paperclip，但任务执行、心跳与预算在自研 `task-graph` 中二次实现。

**Pros：** 最大定制自由。  
**Cons：** 与 Paperclip 目标能力重复，长期维护成本高，违背「唯一编排框架」的简洁性。  
**Best when：** 仅当 Paperclip 无法满足关键不变量时再评估；**默认不推荐**。

**Recommendation：** 采用 **Approach A**，在 CI 与环境维度区分 ElectroOS 与 DevOS 的部署与密钥；若未来开源或组织拆分，再将共享契约抽成 **Approach B** 的包而不改业务语义。

## Key Decisions

| 决策 | 内容 | 理由 |
|------|------|------|
| 双层职责 | ElectroOS 执行业务；DevOS 维护与演进；上报关系单向经 Ticket | 职责清晰，避免在生产路径混入工程自动化 |
| 集成边界 | 仅经 PlatformHarness + API + 事件 | 可替换平台实现、可测试、可审计 |
| 数据面 | 服务级 schema + RLS；跨服务不经 DB 直连 | 与「模块不跨库访问」一致 |
| 编排 | Paperclip 唯一编排 | 减少双轨运维与概念重复 |
| 部署闸门 | 仅生产部署人工审批 | 平衡自治与风险；其余阶段自动化 |
| DataOS 节奏 | Phase 3 再引入 ClickHouse / pgvector 等重件 | Phase 1–2 用 Postgres + Redis 即可验证闭环 |
| DevOS 闭环 | 九阶段作为目标态；MVP 可先 5 阶段（Ticket→Spec→实现→测试→待审批发布） | 降低首期交付风险 |

## Data & Architecture Snapshot（WHAT 层）

- **ElectroOS 核心模块（示意）：** platform-harness、agent-runtime、tenant-service、product / pricing / order / customer、analytics-service。  
- **DevOS 核心模块（示意）：** code-agent-runtime、task-graph、ci-cd-pipeline、monitoring、constitution-guard。  
- **事件：** 覆盖商品、订单、价格、Agent 心跳与预算、租户生命周期、DevOS 部署请求与审批等，命名空间建议加前缀（如 `electroos.*` / `devos.*`）以免混淆。  
- **Phase 1 多租户：** `tenants` 与既有 `companies` / `agents` / `tasks` 等表扩展 `tenant_id` + RLS 策略（示例 SQL 作为方向性约束，落地时需与现有 Paperclip/ElectroOS 表名对齐）。  
- **Phase 3 DataOS：** Event Lake（ClickHouse）、Feature Store（Redis + PG）、Decision Memory（PG + pgvector）；**可延后**至确有高频写入与检索需求。

## Open Questions

1. **ElectroOS 与 Paperclip 域模型是否合并？** 例如：`companies` 是否即租户边界，还是需要 `tenants` 与「Paperclip company」二选一或映射层？  
2. **DevOS 的 Ticket 存储位置：** 完全落在 DevOS 自有 DB，还是复用 Paperclip 的 issue/ticket 模型并扩展 `kind=devos`？  
3. **人工审批的粒度：** 仅生产发布一次审批，还是含「影响定价/广告的策略变更」二次审批？  
4. **ClickHouse 引入阈值：** 以日事件量、查询 SLA 还是成本为硬指标？  
5. **48h Harness SLA：** 是否区分 P0（全平台断连）与 P1（单平台适配），以免队列被低优任务占满？

## Resolved Questions

（暂无；待与产品/安全对齐后回填。）

## Related

- **系统宪法与反模式（防复杂性失控）：** [`2026-03-21-electroos-devos-constitution-brainstorm.md`](./2026-03-21-electroos-devos-constitution-brainstorm.md) — Harness / API-Event / DataOS 事件纪律 / Budget-Approval / DevOS 纪律 / 多租户 / 测试优先级等 **MUST** 条款。
- **工程师执行清单（PR / Agent / 发布前）：** [`2026-03-21-electroos-engineering-checklist-brainstorm.md`](./2026-03-21-electroos-engineering-checklist-brainstorm.md) — 可勾选验收项与三种落地方式（DevOS Agent / PR Template / CI Gate）。
- **Constitution Guard + 自我修复闭环：** [`2026-03-21-electroos-constitution-guard-brainstorm.md`](./2026-03-21-electroos-constitution-guard-brainstorm.md) — PR/Runtime/Deploy 三闸门与 DevOS Ticket 闭环。
- **落地构建顺序 + Cursor 执行包：** [`2026-03-21-electroos-build-roadmap-cursor-brainstorm.md`](./2026-03-21-electroos-build-roadmap-cursor-brainstorm.md) — ElectroOS→DataOS→DevOS、Paperclip 定位、首周目标与 Prompt 草稿。
- **数据结构 + 系统结构 + 数据流（含 Mermaid）：** [`2026-03-21-electroos-data-system-structure-brainstorm.md`](./2026-03-21-electroos-data-system-structure-brainstorm.md) — 三层闭环、存储分工、Agent 流与 PG/CH 分期。
- **全球商品语义（Ontology × 市场 × 平台）：** [`2026-03-21-electroos-global-product-ontology-brainstorm.md`](./2026-03-21-electroos-global-product-ontology-brainstorm.md) — 语义对齐、归一化管线、分期落地。
- **Master Blueprint（PDF 摘要 · 21 Agents / 门控 / Phase 1–4）：** [`2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md`](./2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md)
- **System Constitution v1.0（PDF 九章 · 技术栈/Agent/门控）：** [`2026-03-21-electroos-system-constitution-pdf-brainstorm.md`](./2026-03-21-electroos-system-constitution-pdf-brainstorm.md)
- **Phase 1–5 路线图（五份 PDF 合并摘要 · 验收项 103）：** [`2026-03-21-electroos-phase1-5-roadmap-pdf-brainstorm.md`](./2026-03-21-electroos-phase1-5-roadmap-pdf-brainstorm.md)
- **Global Brain + Tenant Override：** [`2026-03-21-electroos-ontology-global-tenant-brainstorm.md`](./2026-03-21-electroos-ontology-global-tenant-brainstorm.md) — `tenant_id` 可空、解析优先级、DataOS/ElectroOS/DevOS 分工、Phase 1 骨架必选。
- **Tenant Override 详解（Add/Replace/Reweight、变现）：** [`2026-03-21-electroos-tenant-override-brainstorm.md`](./2026-03-21-electroos-tenant-override-brainstorm.md)
- **Phase 1 实施计划：** [`phase1-plan.md`](../plans/phase1-plan.md) — 8 周四 Sprint、15 项验收、目录结构与数据模型
- **ADR-0001 · Paperclip 集成策略：** [`0001-paperclip-integration.md`](../adr/0001-paperclip-integration.md)

## Next Steps

→ 逐项确认 **Open Questions** 后，使用 `/workflows:plan` 拆解 Phase 1 交付范围与依赖顺序（Harness 接口、租户 RLS、最小 DevOS 闭环、Paperclip 集成点）；规划时**同步引用宪法文档**作为验收与门禁输入。
