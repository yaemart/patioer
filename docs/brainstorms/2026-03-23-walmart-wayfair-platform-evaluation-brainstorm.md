---
date: 2026-03-23
topic: walmart-wayfair-platform-evaluation
version: "3.0"
revision_note: "v3.0 — 按 System Constitution 重构文档结构，删除已失效的 Wayfair GraphQL / poller 假设"
related:
  - docs/system-constitution.md
  - docs/governance-gates.md
  - docs/architecture/harness-and-market.md
  - docs/plans/phase2-plan.md
  - docs/plans/phase3-plan.md
  - docs/plans/phase4-plan.md
  - docs/plans/phase5-plan.md
  - docs/adr/0003-phase3-dataos-stack.md
  - docs/adr/0004-phase4-autonomous-loop.md
---

# Walmart + Wayfair 平台集成评估（宪法对齐版）

## What We're Building

本文件不是实现计划，而是对“新增 Walmart 与 Wayfair 平台”的**宪法对齐评估**。目标是在不违反 `docs/system-constitution.md` 的前提下，判断两个平台应走哪条架构路径、哪些能力必须纳入、哪些假设必须删除。

本次评估以 **Phase 1–5 已交付的实际代码** 为准，而不是仅以早期四平台阶段的认知为准。

## Constitution First

以下条款是本评估的硬约束，后续任何 plan 都必须继承：

1. **Harness 抽象不可绕过**  
   按宪法 Chapter 2.3，Agent 只能经 `TenantHarness` / `PlatformHarness` 与平台交互，不能直连平台 SDK 或私有 API。

2. **内部接口保持 API First**  
   按宪法 Chapter 2.2，系统内部新增能力应优先落在 REST + OpenAPI 的服务接口上。即使外部平台本身使用 GraphQL、EDI 或 HMAC，这些协议差异也必须被封装在 Harness 或适配层内，不能泄露到 Agent 层。

3. **审批门控不可弱化**  
   按宪法 Chapter 5 和 `docs/governance-gates.md`，调价、广告预算、库存调整等高风险写操作只能走审批流。新增平台不能绕开现有 `approval.execute` 单一路径。

4. **新增 Harness 接口 / Schema 变更需审批**  
   按宪法 Chapter 5.4，若 Walmart/Wayfair 需要新增 Harness 方法，或新增数据库表 / 变更 schema，必须先经过对应审批链路，而不是在评估文档中默认放行。

5. **多租户隔离必须保持**  
   按宪法 Chapter 6，任何新增核心表必须具备 `tenant_id` 和 RLS；任何跨租户访问都不允许成为平台接入的副作用。

6. **Harness 向后兼容与测试覆盖率**  
   按宪法 Chapter 7，Harness 变更必须保持向后兼容，覆盖率不能低于 80%，且每个 Harness 方法都应有测试。

7. **安全与凭证管理**  
   按宪法 Chapter 9，平台凭证必须继续使用 AES-256 加密存储，不能把密钥写入代码，也不能让 Agent 以明文形式传播凭证。

8. **可观测性必须可延续**  
   按宪法 Chapter 8，新增平台必须纳入 `harness.api.error_rate` 等监控语义，不能成为控制台与指标体系中的盲区。

## Current Reality

基于当前仓库代码，系统现状如下：

- Marketplace 主路径当前支持 `shopify`、`amazon`、`tiktok`、`shopee`。
- `Platform` 类型额外还包含 `b2b`，且已有 `b2b.harness.ts`。
- Agent 已不止早期 5 个，而是 10 个；其中 `finance-agent`、`content-writer`、`market-intel` 会受新平台事件与特征数据影响。
- Phase 3–5 已经引入 DataOS、Billing、Onboarding Wizard、Console API、治理设置与 B2B 路径，因此新平台评估不能只停留在 OAuth + webhook 层。

## Evaluation Outcome

### Walmart

Walmart 与现有 Marketplace 路径一致性最高，符合“新建 Marketplace Harness”的方向：

- 新平台类型进入 Marketplace 主路径
- 通过 Harness 封装认证、订单、库存、价格、Webhook
- 进入 `SUPPORTED_PLATFORMS`、`createHarness`、凭证解析、控制台与监控体系

这条路径**符合宪法**，前提是：

- 不新增未审批的 Harness 接口
- 继续复用现有审批写路径
- 不因 Walmart 接入而破坏现有 REST + OpenAPI 内部边界

### Wayfair

经前序调查，Wayfair 在本项目里不应继续按“新建 Marketplace Harness + GraphQL + poller”处理，而应**对齐现有 B2B 路径**：

- 复用 `b2b.harness.ts`
- 复用 EDI 850 / 阶梯价 / Backend Adapter 机制
- 保持与 Marketplace 平台分离的 tenant / 计数 / 接入模型

这比原设想更符合宪法，原因是：

- 它避免为了单个平台引入一套新的 Agent 访问抽象
- 它保持了现有模块边界，而不是把 B2B 采购语义硬塞进 Marketplace 主路径
- 它遵守了“优先复用已存在抽象，而不是无理由新增核心接口”的演进原则

## Why This Approach

原文档里最大的宪法偏差，不是方向错，而是**混淆了三类东西**：

1. **宪法硬约束**
2. **当前代码现实**
3. **可以讨论的实现假设**

比如：

- 把 Wayfair GraphQL / poller 当成既定路线，这是未经最终确认的实现假设
- 把某些 DataOS / CompliancePipeline 要求直接写成“宪法新增硬约束”，表述过度
- 把一些文件改动写得过细，却没有先说明是否触发了“新增 Harness 接口 / Schema 变更审批”

本次重写后的原则是：

- **先讲宪法边界**
- 再讲现状
- 最后给出平台归属判断与最小必要工作面

## Constitution-Aligned Decisions

- **Walmart 走 Marketplace Harness 路径**：这是新增 Marketplace 平台，不改变 B2B 语义边界。
- **Wayfair 走 B2B 路径**：复用现有 `b2b.harness.ts`，不再假设新建 `wayfair.harness.ts`。
- **Marketplace 与 B2B 分开计数**：这符合当前系统里 B2B 独立通道的现实，也避免把两种不同商业模型混为同一套餐约束。
- **内部接口仍保持 REST + OpenAPI**：即使 Walmart 或 Wayfair 外部协议不同，内部都不直接暴露这些差异给 Agent。
- **新增表不是默认前提**：若后续确实需要新表，必须满足 `tenant_id + RLS + migration 审批`；在此之前不先设计表。
- **不默认扩展 Harness 接口**：能用现有 `TenantHarness` / B2B 抽象解决，就不新增平台专属核心接口。

## Required Workstreams

以下是与宪法一致、且在 plan 阶段必须被明确的工作面：

### 1. Harness And Credential Path

- Walmart：进入 Marketplace 主路径
- Wayfair：进入 B2B 路径，而非 Marketplace 主路径
- 两条路径都必须继续使用加密凭证与现有 Harness 构造模式

### 2. Governance And Safety

- 现有审批门控对新平台继续生效
- 如需新增 Harness 方法，必须显式记录“需 CTO Agent + 人工审批”
- 如需新增 schema，必须显式记录“需架构 Agent + 人工审批”

### 3. Data And Observability

- Walmart / Wayfair 产生的订单、价格或其他关键事件，应能进入现有事件与监控语义
- DataOS 失败时必须降级，不阻塞主链路
- 新平台必须进入现有错误率与控制台可见性体系

### 4. SaaS Surface

- Billing：Marketplace 与 B2B 分开计数
- Onboarding：只加入与实际接入路径一致的步骤，不虚构不存在的 OAuth 流程
- Console / Settings：只在现有模型下增量扩展，不制造第三套平台管理语义

## What Was Removed

以下内容已从“默认正确”降级为“明确删除或不再成立”：

- Wayfair 新建 GraphQL Marketplace Harness
- Wayfair 轮询 / poller 作为主路径
- Wayfair 进入 `SUPPORTED_PLATFORMS`
- “先加新表再说”的默认倾向
- 把实现层约束直接表述成宪法条款

## Open Questions

当前已无阻塞性开放问题，但进入 `/workflows:plan` 前建议把以下两点写成显式假设：

1. Walmart 是否需要在第一阶段就支持广告相关能力，还是仅保留后续扩展位。
2. Wayfair 的 B2B 接入是只做单一 EDI 采购链路，还是需要兼容多个 Partner/EDI 变体。

## Next Steps

→ 进入 `/workflows:plan` 时，应以本文件为“约束输入”，先验证是否触发 Harness 接口审批或 Schema 审批，再拆实施任务。
