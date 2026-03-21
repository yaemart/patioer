---
date: 2026-03-21
topic: electroos-tenant-override
related:
  - docs/brainstorms/2026-03-21-electroos-ontology-global-tenant-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-global-product-ontology-brainstorm.md
---

# Tenant Override：差异化、变现与壁垒（工程语义）

## What We're Building

把 **Tenant Override** 定义为：在 **系统默认知识（Global）** 之上，允许每个租户拥有 **商业偏好与可学习经验**，使同一 `concept` 在不同租户下可有 **不同关键词、模板权重与投放策略**。这是 SaaS **差异化定价**与 **数据壁垒** 的机制层，而非单纯「多语言」。

配套包括：**可空 `tenant_id` 的数据行**、**统一解析顺序（租户优先 → 系统默认）**、**三种变更语义（补充 / 替换 / 调权）**、**Agent 侧消费方式**，以及与 **DataOS** 的 **转化→权重** 闭环（及可选：版本、审批、AI 建议）。

文中 SQL/伪查询为**示意**；落库字段与引擎实现见 `/workflows:plan`。

## Why This Approach

| 若无 Override | 后果 |
|---------------|------|
| 全用系统词 | Listing/广告同质化，**无竞争力** |
| 好词无法沉淀 | 优秀卖家经验**无法资产化** |
| 无法卖「增长」 | 只能卖工具，**ARR 上限低** |

**一句话：** **Global = 让系统可用；Tenant Override = 让系统赚钱。**

## 数据与查询原则

- **凡可优化对象**（关键词、模板、映射权重等）在表级支持 **`tenant_id NULLABLE`**：`NULL` = 系统默认。  
- **解析查询（概念）：** 同一 `concept` + `market`（+ `platform` 等维度）下，取 **`tenant_id = 当前租户 OR NULL`** 的行，**优先采用租户行**；再用 **`weight`**（等）排序决定 primary / secondary / long-tail。  
- **辅助元数据（建议）：** `source`（`system` / `tenant` / `ai`）、可选 **`version` / `is_active`** 支持回滚与实验。

**关键词表示意字段（与讨论一致）：** `concept_id`、`keyword`、`market`、`platform`、`tenant_id`（NULL=系统默认）、`weight`、`source`、`created_at` 等；具体约束与索引在 plan 中定稿。

**示意查询（统一入口，避免各 Agent 手写不同逻辑）：**

```sql
SELECT *
FROM concept_keywords
WHERE concept_id = $1
  AND market = $2
  AND platform = $3
  AND (tenant_id = $tenant_id OR tenant_id IS NULL)
ORDER BY tenant_id DESC NULLS LAST, weight DESC;
```

含义：**① 同时取租户行与系统默认行 → ② 解析时租户覆盖优先 → ③ 同侧用 `weight` 定 primary/secondary/长尾**（`ORDER BY` 在 PG 中对 NULL 的排序必须用 **`NULLS LAST/FIRST` 显式约定**，必要时在应用层合并两行集合后再排序）。

> 注意：若 **Replace** 要求「忽略系统 primary」，不能只依赖排序，需 **`override_kind` 或独立规则**（见 Open Questions）。

## Override 三种语义（必须产品化）

| 类型 | 含义 | 典型表现 |
|------|------|----------|
| **Add（补充）** | 不删除系统词，**新增**租户专属词 | 系统有 `coffee grinder`，租户加 `espresso grinder pro` |
| **Replace（替换）** | 指定语境下 **primary 不再用系统主词** | 主词改为 `premium espresso grinder` |
| **Reweight（调权）** | 同一批词 **相对权重变化** | 系统 `coffee grinder weight=1`，租户改为 `0.3` / 另一词 `1.5` |

**实现策略（待 plan 定稿）：** 可用 **`override_kind`** 或 **「仅租户行参与 primary 竞选」** 等规则区分 Replace/Add；避免仅靠口头约定。

## Agent 消费方式（WHAT）

- **Keyword / SEO Agent：** 拉取解析后的词表 → 高 weight → primary，中→ secondary，低→长尾。  
- **Listing Agent：** `title_template` / 属性模板 **租户行优先**，否则系统默认。  
- **Ads Agent：** 优先投放 **租户高转化 / 高 weight** 词（与审批、预算门控配合）。

## 实战对照（同一 concept）

**设定：** `concept = coffee_grinder`，`market = US`。

| 来源 | Primary | Secondary / 长尾（示例） |
|------|---------|-------------------------|
| **系统默认** | coffee grinder | burr grinder、espresso grinder |
| **租户 A（高端）** | premium espresso grinder | barista grinder、precision burr grinder |
| **租户 B（低价爆款）** | cheap coffee grinder | budget burr grinder、affordable grinder |

→ 同一语义锚点，**定位与 GMV 结构可完全不同**；Override 是差异化与溢价的载体。

## Tenant Override + DataOS（进化）

数据流（概念）：租户使用关键词 → **产生转化/GMV 信号** → 写入 DataOS → **更新 weight 或生成新 tenant 行** → 下次排序变化。可选 **自动 Override（AI 建议）** → **审批后生效**（高价值租户或高风险类目）。

## 高级机制（可选）

- **AI 生成 Override：** 表现更好的词 → 写入候选 tenant 行（`source=ai`）+ 审批。  
- **版本与回滚：** `version` + `is_active`。  
- **审批：** 与 Constitution / 租户套餐绑定（例如 Enterprise 才自动调权）。

## Approaches Considered

| 方案 | 描述 | Pros | Cons |
|------|------|------|------|
| **A. 单表 NULLABLE + weight** | 系统行 + 租户行共存 | 简单、易查 | Replace 语义要规则清晰 |
| **B. 基表 + `tenant_overrides` 影子表** | 默认与覆盖分表 | 边界清晰 | Join 与迁移复杂 |
| **C. 每租户全量复制** | 每租户一套完整词表 | 替换语义直观 | 存储与同步成本高 |

**Recommendation：** **A 起步**；若 Replace/实验爆炸，再 **引入 B 或 `override_kind`**。

## Key Decisions

- Override 是 **商业化与壁垒** 的核心机制，与 Global Ontology **同属 DataOS 资产模型**。  
- **解析顺序固定**：租户 > 系统；**weight** 驱动排序与投放优先级。  
- **三种语义**（Add/Replace/Reweight）必须在产品与 schema 上有 **可测试的定义**，不能仅存于文档叙述。  
- **自动调权默认：自动生效 + 强审计 + 可回滚**；与「超阈审批」「生产部署人工审批」并行不悖（见 Resolved Questions）。

## Open Questions

1. **`override_kind`（或等价）是否 Phase 1 就引入？** 还是先仅 Add + Reweight，Replace 用运营手册？  
2. **与套餐：** Override 行数/自动 AI 条数是否作为 **计费维度**？

## Resolved Questions

- **Override 为租户增强必经路径**（与《Global Brain + Tenant》一致）。  
- **自动调权（转化 → `weight`）默认策略（已拍板）：** **A — 自动生效**，配套 **强审计（不可变日志）+ 可回滚**。  
  - **与体系其它闸门的关系：** 高频、低于风险阈值的策略调整（含关键词权重等）可走自动化闭环；**超阈值**的定价/广告等仍按 Phase 1–2 叙事走 **审批门控**；**生产部署**在 Phase 4 仍保留 **唯一人工审批节点**（与 DevOS 文档一致）。DataOS 记录转化率与效果，支撑自动调权与 Decision Memory，不等于取消高风险审批。

## Next Steps

→ `/workflows:plan`：**Override 解析服务**验收用例（系统-only、租户-only、混合、Replace 场景）；**权重自动学习**须含 **审计事件、版本/回滚路径、幂等**；**审批状态机**仅用于超阈/高风险或与租户套餐约定的场景，不与「调权默认自动」矛盾。
