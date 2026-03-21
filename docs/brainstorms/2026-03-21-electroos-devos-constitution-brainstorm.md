---
date: 2026-03-21
topic: electroos-devos-constitution
related: docs/brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md
---

# ElectroOS + DevOS：系统宪法与反模式（防失控）

## What We're Building

把「AI 原生操作系统级工程」里**最容易失控**的风险，提炼成**可执行的不变量（invariants）**与**反模式清单**，作为产品、架构、DevOS 与 Code Review 的**共同底线**。本文不写实现细节，只定义 **WHAT 必须成立**，以便规划与实现阶段可对照验收。

**核心命题：** 真正难的不是写代码，而是**避免系统在复杂性中失控**；因此**不能依赖 Agent 自觉**，必须依赖**结构化约束**（Harness、API、Event、Budget、Approval、RLS、CI/CD）。

## Why This Approach

单独成文的原因：架构文档描述能力与模块；**宪法文档描述不可违背的规则**。两者分离后，评审时可问：「这条 PR 是否违反宪法某条？」降低口头文化漂移。

## Meta Principle（隐形宪法）

> **所有复杂性必须被「结构化约束」，不能依赖 Agent 自觉。**

映射到约束面：

| 约束面 | 作用 |
|--------|------|
| Harness | 约束一切「外部世界」交互 |
| API | 约束模块边界 |
| Event | 约束数据流与可观测性 |
| Budget | 约束成本 |
| Approval | 约束风险 |
| RLS / tenant | 约束数据隔离 |
| CI/CD | 约束 DevOS 与变更纪律 |

## The Ten Pitfalls → MUST Rules

### 1. 绕过 Harness

- **反模式：** Agent 或 Service 直连 Shopify/Amazon SDK；为快绕过抽象层。  
- **后果：** 多平台无法扩展、DevOS 难维护、故障难定位。  
- **MUST：** 所有外部交互仅经 `PlatformHarness`（及其实现）；**「外部世界交互 = 只走 Harness」**。

### 2. 跨 Service 读数据库

- **反模式：** 定价服务查商品表；分析 JOIN 订单表；DevOS debug 直连业务库。  
- **后果：** 边界腐烂、schema 变更连锁爆炸。  
- **MUST：** 服务间仅 **API 或 Event**，**禁止跨库读取**。

### 3. Agent「无状态」退化

- **反模式：** 每次决策纯 LLM，无特征与记忆。  
- **后果：** 重复错误、策略随机、ROI 不可控。  
- **MUST：** 决策输入 = **features + decision memory（+ 上下文）**；Agent = 执行 + 记忆 + 学习，而非 Chat 调用器。

### 4. 事件记录不全

- **反模式：** 只记成功、忽略失败与中间态、payload 残缺。  
- **后果：** DataOS 废用、无法复盘与学习。  
- **MUST：** **「未记录的行为 = 未发生」**；关键行为进 Event Lake，含 context / action / outcome（outcome 可延迟回写）。

### 5. 无 Budget / Approval Gate

- **反模式：** LLM 无限调用、调价/广告无上限。  
- **后果：** 成本与风险失控。  
- **MUST：** 高风险与付费路径 **pre-flight**：budget + approval；**Agent = 受监管员工**。

### 6. DevOS 绕过纪律改生产

- **反模式：** 手改 DB、跳过 CI/CD、hotfix 直登生产。  
- **后果：** 不可回滚、数据污染、行为与 schema 不一致。  
- **MUST：** DevOS 变更同样 **PR → 测试 → CI/CD →（生产）审批**；**DevOS 也被系统约束**。

### 7. 测试不足（尤其 AI 路径）

- **反模式：** 认为 Agent 聪明可不测；只测 happy path。  
- **后果：** 部署即随机行为。  
- **MUST：** 优先 **Harness、定价逻辑、事件写入、Agent 错误处理**；用**确定性护栏**约束非确定性模型。

### 8. 多租户隔离松懈

- **反模式：** 漏 `tenant_id`、未启用 RLS、Agent 跨租户读。  
- **后果：** 法律与商业级风险。  
- **MUST：** **tenant_id + RLS + API 层隔离**；多租户 **零容错**。

### 9. 把 DevOS 当工具链而非系统

- **反模式：** DevOS = CI 脚本或 coding helper。  
- **后果：** 规模化卡死。  
- **MUST：** DevOS = **自治软件工程组织**（任务图、架构决策、实现、测试、部署、监控、自我修复的闭环能力）。

### 10. （汇总）与 Meta 对齐

上述条目均是「隐形宪法」在各领域的投影；评审时逐项对照即可。

## Top 5 记忆优先级（最小集合）

若只保留五条：**① 不绕过 Harness ② 不跨 Service 读 DB ③ 行为全量进 Event ④ Budget + Approval ⑤ DevOS 不绕过 CI/CD**。

## Key Decisions

- 将「宪法」与架构能力文档**分文件**维护，评审职责清晰。  
- **自动化优先**：`constitution-guard`（见架构文档模块名）应对齐本文件条目做可编程检查（具体规则进规划阶段）。  
- **失败与中间态**与成功一样必须进入事件与可观测链路，否则 DataOS 与 SRE 闭环不成立。

## Open Questions

1. **宪法如何进 CI？** 哪些规则适合静态分析（如禁止 `shopify` 直连 import），哪些适合集成测试？  
2. **Approval 分级：** 是否与「架构 brainstorm」中的「定价/广告策略变更」二次审批合并讨论？  
3. **Event schema 版本化：** 全量记录与 schema 演进并存时，如何避免 Event Lake 解析地狱？

## Resolved Questions

（暂无。）

## Related

- **System Constitution v1.0（正式 PDF 九章摘要）：** [`2026-03-21-electroos-system-constitution-pdf-brainstorm.md`](./2026-03-21-electroos-system-constitution-pdf-brainstorm.md) — Agent/Guard 正本来源。
- **工程师执行清单（PR / 发布前勾选）：** [`2026-03-21-electroos-engineering-checklist-brainstorm.md`](./2026-03-21-electroos-engineering-checklist-brainstorm.md)
- **Constitution Guard + 自我修复闭环（DevOS 核心）：** [`2026-03-21-electroos-constitution-guard-brainstorm.md`](./2026-03-21-electroos-constitution-guard-brainstorm.md)

## Next Steps

→ 与 `2026-03-21-electroos-devos-architecture-brainstorm.md` 一起作为 `/workflows:plan` 输入：规划阶段需产出 **验收清单**（每条 MUST 对应测试或门禁）；**具体勾选项**以工程清单文档为准。
