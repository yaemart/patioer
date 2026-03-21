---
date: 2026-03-21
topic: electroos-global-product-ontology
related:
  - docs/brainstorms/2026-03-21-electroos-data-system-structure-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-build-roadmap-cursor-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-ontology-global-tenant-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-tenant-override-brainstorm.md
---

# DataOS 核心：全球商品语义（Ontology × 市场 × 平台）

## What We're Building

定义 **多平台 × 多市场 × 多语义** 下的**商品认知统一层**：不是「多语言翻译」，而是 **semantic alignment（语义对齐）**。在 DataOS 中落地 **三层数据模型** — **Global Product Ontology（世界模型）**、**Market Semantic Layer（市场表达）**、**Platform Mapping Layer（平台类目/字段/模板映射）**，并驱动 **归一化商品（`products_normalized`）**、**Query → Concept**、以及 Agent 在 **concept + market + segment** 维度上决策（定价/广告/内容），而非裸关键词。

文中 JSON/SQL 为**示意**；字段级 DDL 与管线实现归属 `/workflows:plan`。

**Global vs 租户：** `concepts` 为**全局系统资产**；`concept_keywords` / `platform_mappings` 使用 **`tenant_id` 可空** 实现「系统默认 + 租户覆盖」，详见 [`2026-03-21-electroos-ontology-global-tenant-brainstorm.md`](./2026-03-21-electroos-ontology-global-tenant-brainstorm.md)。**Override 类型、查询与变现语义**见 [`2026-03-21-electroos-tenant-override-brainstorm.md`](./2026-03-21-electroos-tenant-override-brainstorm.md)。

## Why This Approach

若缺少统一语义锚点，推荐、广告、定价会在不同平台/国家「各说各话」，后期无法收敛指标与学习信号。YAGNI：**Phase 1 仅核心 `concept` + 单市场关键词**；embedding 与全自动 concept 匹配后移，避免一上来建完整知识图谱工程。

## 三层模型（必须同时概念成立，分期填充）

| 层 | 解决的问题 | 内容要点 |
|----|------------|----------|
| **L1 Ontology** | 「世界上有什么」 | `concept_id`、类型、属性 schema、`relations`；**与平台/国家解耦** |
| **L2 Market Semantic** | 「某市场怎么说」 | `market` + `language` + 主/长尾关键词、可选搜索量与转化 |
| **L3 Platform Mapping** | 「某平台怎么挂类目/字段」 | 类目 ID、属性 rename、标题模板、内容标签（如 TikTok） |

**归一化管线（概念）：** 各平台 raw 商品 → **规则 + LLM** → 匹配 `concept_id` → 属性映射 → 写入 `products_normalized`；搜索查询经 **embedding / 词典** → `concept` + 市场主词。

## 核心表（WHAT 层示意）

| 表 | 作用 |
|----|------|
| `concepts` | 全局概念锚点 |
| `concept_keywords` | concept × market × keyword（含 `is_primary` 等） |
| `platform_mappings` | concept × platform 的类目与属性/模板映射 |
| `products_normalized` | tenant 维度下平台商品归一化视图（`raw_data` / `normalized_data`） |

**租户：** `products_normalized` 等需 **`tenant_id`**，与 RLS 策略一致（见《数据结构》文档）。

## Agent 决策升级（原则）

- **旧：** 只看关键词。  
- **新：** **concept + Feature Store + Decision Memory + market/segment**。  
- **Listing 生成：** `concept` → L2 关键词 → L3 模板 → 多平台多市场文案/标签草稿（受审批与品牌约束）。

## 落地优先级（与 Phase 对齐）

| Phase | 范围 |
|-------|------|
| **1** | `concepts`（如 ~100 核心品类）+ 简 keyword（如 US）+ 最小归一化路径 |
| **2** | 多市场关键词（UK/DE 等）+ Amazon/Shopify 映射 |
| **3** | embedding + 相似度、自动 concept 匹配 |
| **4** | 与完整 DataOS（Feature/Memory/优化闭环）联动、关键词自动优化 |

## Approaches Considered

| 方案 | 描述 | Pros | Cons | 适用 |
|------|------|------|------|------|
| **A. 自建 Ontology + 映射**（推荐主线） | 完全掌控 concept 与映射版本 | 护城河、可演进到 Graph | 人工冷启动成本 | 长期产品 |
| **B. 外接标准类目（如 GS1/平台 taxonomy）** | 部分 concept 对齐外部 ID | 省部分设计 | 覆盖不全、版本锁死 | 作辅助对齐源 |
| **C. 纯 LLM 即时归类** | 无持久 ontology | 快 | 不稳定、难审计 | 仅作管线中一步，**不能**替代 L1–L3 |

**Recommendation：** **A 为主**，B 作可选 **xref**；C 用于 **suggest**，结果必须写入可审计表。

## Key Decisions

- 护城河定义为 **Global Commerce Knowledge Graph（语义网络）**，而非单点 Agent/UI。  
- **语义三层** 为 DataOS 与 ElectroOS 的**硬依赖**；Harness 之上业务 Agent 以 **concept 上下文** 消费特征与策略。  
- **分期**：先小品类闭环验证，再扩市场与 embedding 自动化。  
- **所有权模型**：**Global Brain + Tenant Override**（非全共享、非全隔离）；Phase 1 即落 ontology **骨架**。

## Open Questions

1. **concept_id 命名空间：** 全局唯一字符串（如 `coffee_grinder`）是否与 **租户自定义品类** 二段式（`global:` / `tenant:`）？  
2. **100 类目清单：** 由产品/运营定稿，还是允许 DevOS 从销售数据迭代建议？  
3. **品牌与合规：** 自动 Listing 是否必须经 **人工或 Approval Gate** 才允许发布？  
4. **与 Feature Store 行级关系：** `product_features` 是否增加 **`concept_id`** 作为一等键？

## Resolved Questions

（暂无。）

## Next Steps

→ `/workflows:plan`：Phase 1 导入 **concept 种子**、最小 `concept_keywords`、单平台 `platform_mappings`、归一化 Job 接口与验收用例（含「UK: coffee mill → coffee_grinder」）。
