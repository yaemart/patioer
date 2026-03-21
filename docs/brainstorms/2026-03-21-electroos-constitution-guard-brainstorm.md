---
date: 2026-03-21
topic: electroos-constitution-guard-self-healing
related:
  - docs/brainstorms/2026-03-21-electroos-devos-constitution-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-engineering-checklist-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md
---

# Constitution Guard Agent + DevOS 自我修复闭环

## What We're Building

**Constitution Guard** 是 DevOS 的**核心组件**：不是 ESLint 替代品，而是 **AI + 规则引擎 + CI/运行时/部署闸门** 的组合体，对照《系统宪法》与《工程师清单》自动审查 **代码（PR）**、**Agent 行为（运行时）**、**架构演进意图**，并对 **部署** 拥有**否决权**（`block_on_violation = true`，禁止长期 `warn_only`）。

**自我修复闭环（Self-Healing Loop）** 描述 Guard 与 DevOS 的衔接：Guard **发现问题** → **结构化 Ticket** → **Task Graph 分解** → 多 Agent 实现 → **PR + CI** → **Guard 再审** → 部署与 SRE 验证；失败时有限重试并升级人工。高级阶段与 **DataOS** 联动：违规记录进 Event Lake、规则与修复模式可演进（建议新规则，需治理流程批准）。

本文定义 **WHAT** 与权力边界；具体实现（AST 工具选型、Agent Hook 挂载点）留给 `/workflows:plan`。

## Why This Approach

没有 Guard，3–6 个月内典型退化路径是：绕 Harness、跨库、测试缩水、Agent 失控。把原则**编译成可执行闸门**，才能让「可自我进化的软件组织」长期成立。YAGNI：**L1 硬规则优先自动化**；L3 语义规则按需上线，避免一上来全 LLM 审查拖垮延迟与成本。

## 核心架构（概念）

```
Constitution（规则源）
        ↓
Constitution Guard Agent
        ↓
   PR Guard | Runtime Guard | Deploy Guard
```

- **PR Guard：** 合入前拦截（禁止直连 SDK、跨模块 SQL、`tenant_id` 缺失、`any` 滥用、覆盖率等）。输出**结构化 violations JSON**；**CI Gate：未通过则 block merge**。
- **Runtime Guard：** 挂载 Agent Runtime（pre-flight / 执行中 / post-check）；违规抛 `constitution_violation` 类结构化错误。
- **Deploy Guard：** 最后一道：PR Guard 已通过、测试与覆盖率、供应链/迁移合规、**生产人工审批**等；不满足则 **block deploy**。

## 规则分层（L1 / L2 / L3）

| 层级 | 内容 | 手段 |
|------|------|------|
| **L1 硬规则** | 禁绕 Harness、禁跨 DB、必须 tenant、必须记 Event | AST / 静态分析 / 可配置 denylist |
| **L2 结构规则** | 目录/API/OpenAPI 规范 | AST + 轻量 AI |
| **L3 语义规则** | 业务与 Agent 行为是否合理 | LLM（高成本、低频次或抽样） |

可选 **Rule DSL（YAML）** 管理规则 ID、类型（static / ast / runtime）、消息与严重级别，便于版本化与审计。

## 与 DataOS 联动（高级）

Guard 不仅拦截，还可**学习**：从 Event Lake 拉违规分布、从 Decision Memory 拉历史修复效果 → **建议新规则**（需人审或变更流程），避免规则永远手写僵化。

## DevOS × Guard：自我修复闭环（六步）

1. **Trigger：** PR / Runtime / 监控（如 harness error rate、覆盖率漂移）发现违规。  
2. **Ticket Generator：** 输出**可执行** Ticket（title、type、priority、source=`constitution-guard`、context、goal、acceptance_criteria），而非一句话「修 bug」。  
3. **Task Graph：** PM/Architect 分解为结构化图（非扁平 list）。  
4. **Execution：** Backend / Harness / QA / Security 等 Agent 分工。  
5. **PR + Guard 再审：** Guard **唯一合规裁判**；不通过则 reject PR、reopen Ticket。  
6. **部署 + SRE 验证：** 指标回归；必要时回滚。

**关键机制：** Ticket 必须结构化；**Guard = 唯一裁判**（DevOS 写代码，Guard 定生死）；修复后全量测试 + Guard +（可选）模拟 Agent；**失败重试上限**（如 3 次）后升人工。

## 失败模式（必须预防）

| 问题 | 后果 |
|------|------|
| Ticket 只有描述无结构 | DevOS 无法稳定执行 |
| Guard 仅 warn | 架构逐渐腐烂 |
| 无 Runtime Guard | 运行时偷跑违规 |
| 无闭环再审 | 一次性修复、问题复现 |
| 规则进化无治理 | 误杀或规则爆炸 |

## Key Decisions

| 决策 | 内容 |
|------|------|
| 否决权 | Guard 对 merge/deploy **强制阻断**，非建议 |
| 三子系统 | PR + Runtime + Deploy **同时规划**；可分期上线，但架构上缺一不可 |
| 输出契约 | violations **统一 JSON schema**，便于 Ticket 生成与仪表盘 |
| 自我修复 | Guard → Ticket → DevOS → PR → **Guard 再审** 为闭环必要条件 |
| 进化 | 新规则/新模式 = **建议 + 审批**，避免无人值守自改生产规则 |

## Open Questions

1. **破窗机制：** 是否允许 break-glass（紧急绕过 Guard），由谁审批、是否强制事后 Ticket？  
2. **Guard 部署形态：** 与业务同集群还是独立控制面，以满足「裁判独立性」？  
3. **Runtime Guard 性能：** pre-flight 预算/审批检查是否必须 &lt;N ms SLA？  
4. **规则进化审批人：** 仅 CTO Agent、双签、还是人工？  
5. **CEO Agent / 自主战略**（用户文末「下一层」）：是否单独 brainstorm，避免与 Guard 范围混淆？

## Resolved Questions

（暂无。）

## Next Steps

→ 与《宪法》《工程师清单》一并进入 `/workflows:plan`：拆 **MVP（L1 + PR Guard + Deploy Gate）** 与 **Phase 2（Runtime + DSL + Ticket 闭环）**。

---

## 附录：与工程师心智模型对齐（摘自讨论）

- **Guard** ≈ 免疫系统（识别与阻断异常）  
- **DevOS** ≈ 修复与演进的执行组织  
- **DataOS** ≈ 记忆与学习反馈  

终局愿景：**有免疫系统的软件生命体**；**CEO Agent / 自主战略** 可作为后续独立主题，不在本文件展开需求细节。
