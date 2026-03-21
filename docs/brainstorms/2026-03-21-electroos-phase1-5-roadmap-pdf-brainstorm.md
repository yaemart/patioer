---
date: 2026-03-21
topic: electroos-phase1-5-roadmap-pdf
sources:
  - phase1-electroos (15p)
  - phase2-electroos (17p)
  - phase3-electroos (19p)
  - phase4-electroos (16p)
  - phase5-electroos (18p)
related:
  - docs/system-constitution.md
  - docs/brainstorms/2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-data-system-structure-brainstorm.md
---

# ElectroOS 五阶段路线图（Phase 1–5 PDF 合并摘要）

## What We're Building

将 **五份独立 PDF**（Phase 1–5）合并为 **单一 WHAT 层路线图**：每阶段的**周期、目标范围、不做的事、关键交付、验收项数量、与 System Constitution v1.0 的关系**。供 OKR、排期与 `/workflows:plan` 拆解使用；**实现细节与代码路径以各 PDF 为准**，本文件不复制大段 DDL/代码。

**总跨度（PDF）：** 约 **Month 1–15**，分 **5 个 Phase**，累计验收项 **15 + 20 + 21 + 25 + 22 = 103** 条（按 PDF 清单计数）。

## Why This Approach

分 PDF 管理便于**分阶段融资/招采/验收**；合并摘要避免「只读 Phase 3 漏掉 Phase 1 门禁」的断层。与 [`system-constitution.md`](../system-constitution.md)、[`2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md`](./2026-03-21-electroos-devos-master-blueprint-pdf-brainstorm.md) **同一宪法与蓝图语境**。

## 五阶段一览

| Phase | 周期（PDF） | 核心一句话 | ElectroOS Agents（累计） | 其他层 |
|-------|-------------|------------|---------------------------|--------|
| **1** | M1–2 · 8w | Shopify + 多租户 + Harness + **3 Agent**，验证心跳/预算/门控 | 3（Scout / Price / Support） | 无 DevOS / 无 DataOS |
| **2** | M3–5 · 12w | Amazon/TikTok/Shopee Harness + Market 层 + **Ads + Inventory** + **DevOS 基础**（独立实例、SRE、Ticket 协议） | **5** | DevOS 雏形；仍无 DataOS |
| **3** | M6–8 · 12w | **DataOS**：ClickHouse Event Lake、Feature Store、Decision Memory、3×DataOS Agent；**Content + Market Intel**；Agent「会学习」 | **5 + 2** 运营侧共 7；加 DataOS 侧 | DataOS 独立实例（PDF 端口 **3300**） |
| **4** | M9–12 · 16w | **9** 个 ElectroOS Agent（+CEO/+Finance）、**12** 个 DevOS Agent、**Autonomous Dev Loop** 首跑通；B2B Harness；合规自动化；ClipMart 模板；**50 租户压测** | **9** | DevOS 全编排队；三层控制台 |
| **5** | M13–15 · 12w | **SaaS 商业化**：Stripe、自助 Onboarding &lt;30min、ClipMart 市场、CS Agent、增长与 SLA | 9 + **平台级 CS Agent** 等 | 计费/运营飞轮 |

**实例端口（PDF 约定）：** ElectroOS **3100**、DevOS **3200**、DataOS **3300**（与独立部署叙事一致）。

## 各阶段：范围与「不做」

### Phase 1

- **做：** Fork Paperclip→electroos（PDF）、`tenants`+RLS、`PlatformHarness`（Shopify）、Webhook、Product Scout / Price Sentinel / Support Relay、门控与预算、**15 项验收**。  
- **不做：** 其他平台、DevOS、DataOS、付费用户。  
- **关键数字：** 月 Agent 预算示例 **$160**、审批 **15%**（与 Constitution 一致）。

### Phase 2

- **做：** Amazon SP-API（**提前 2–4 周申请**）、TikTok、Shopee、**Market Harness**（货币/税/合规）、**Ads Optimizer + Inventory Guard**、**DevOS** 独立 DB/端口、SRE、ElectroOS→DevOS **Ticket 协议**、Tenant Onboarding &lt;30min、**20 项验收**。  
- **不做：** DataOS、完整 Dev Loop、B2B、付费上线。

### Phase 3

- **做：** ClickHouse + pgvector + Redis、Ingestion/Feature/Insight Agent、Price Sentinel 接 Feature+Memory、Content Writer + Market Intel、**DataOS 故障时 ElectroOS 降级无记忆**、租户隔离测试、**21 项验收**。  
- **不做：** 强化学习训练、**跨租户共享学习（PDF 明确 Phase 4 再做）**、DataOS 对外公共 API。

### Phase 4

- **做：** DevOS **12 Agent 全齐**、**Autonomous Dev Loop**（**唯一人工节点 = 生产部署审批**）、Harness Agent 48h、CEO+Finance、B2B Harness、合规流水线、ClipMart 控制台、**25 项验收**（含 50 租户并发、单层容灾）。  
- **不做：** Phase 5 **SaaS 计费商业化**；**非**「零人工审批」（部署仍人批）。

### Phase 5

- **做：** **Starter/Growth/Scale** 三档、Stripe 订阅+用量、Onboarding 7 步、ClipMart 表结构与官方模板、Customer Success Agent、推荐码与扩容策略、SLA、**22 项验收**；目标 **20 付费租户**、MRR 等指标（见 PDF）。  
- **不做：** **Phase 6** 内容（PDF 文末提及私有部署/完全自治验收等，**本仓库未附 Phase 6 PDF**）。

## 与仓库策略 B（独立 Monorepo）的对齐

| PDF 习惯表述 | 当前决议 |
|--------------|----------|
| Phase 1「Fork Paperclip 并只在 `packages/server` 叠加目录」 | 工程上可映射为：**独立 `electroos` Monorepo + Paperclip 依赖或 git submodule/并排服务**，**不**强制在 fork 内改 Paperclip 核心文件；验收标准（Harness/Agent/RLS）不变。 |
| `git clone paperclip.git electroos` | **逻辑等价**：业务仓名仍可叫 `electroos`，上游同步策略用 **ADR** 说明。 |

## Key Decisions（采纳 PDF 体系）

- **阶段门禁：** 每 Phase **验收清单全过**再进入下一阶段（PDF 反复强调）。  
- **Harness 为扩展点**；新平台只增实现，**Agent 逻辑尽量零改**（Phase 1–2 文档核心论点）。  
- **三层实例与数据隔离**：ElectroOS / DevOS / DataOS **分库分端口**，Ticket 与监控协议化。  
- **Phase 5** 将 **套餐、Agent 预算、DataOS 是否包含** 与 **Starter/Growth/Scale** 绑定，与 [Tenant Override](2026-03-21-electroos-tenant-override-brainstorm.md) 商业化叙事衔接。

## Open Questions

1. **Phase 1 实施模板：** 是否在 plan 中二选一写清 — **严格按 PDF 在 fork 内叠加** vs **独立仓 + 引用上游 paperclip 包**（推荐与 **B** 一致）？  
2. **Phase 3「跨租户学习」延后到 Phase 4**：与 DataOS [Global+Tenant](2026-03-21-electroos-ontology-global-tenant-brainstorm.md) 的「聚合反哺 Global」是否需**额外 ADR** 避免歧义？  
3. **Phase 6：** 仅 PDF 文字提及，是否后续单独提供 **phase6 PDF** 再开 brainstorm？

## Resolved Questions

- 五份 PDF 全文已读并浓缩于上表；**验收项总数**以各 PDF 末节清单为准（实现时建议拆成可勾选 CI/人工清单）。

## Next Steps

→ **`/workflows:plan`**：按 **Phase 1 → 2 → …** 拆 Epic；首 Sprint 对齐 **Phase 1 的 Week 1–2**（多租户 + Harness 骨架 + 目录边界）；**Constitution / ADR** 与 PDF 并行存档。
