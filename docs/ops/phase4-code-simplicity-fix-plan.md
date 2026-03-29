# Phase 4（Sprint 7–14）代码简化修复计划

**制定日期：** 2026-03-28  
**范围：** `Phase 4` 全量代码（S7–S14）  
**输入依据：**
- `docs/ops/phase4-code-quality-report.md`
- `docs/ops/phase4-code-constitution-blueprint-alignment.md`
- 本轮 `code-simplicity-reviewer` 复审发现（DevOS / Runtime / API / scripts）

---

## 0. 目标

本计划的目标不是“重写 Phase 4”，而是把已经可用的代码收敛成更适合进入 `Phase 5` 的形态：

1. 消除**影子实现**
2. 消除**多真相源**
3. 收缩**占位接口 / 假抽象**
4. 减少**中心化高耦合类型文件**
5. 让测试和脚本依赖于**更小、更稳定**的运行时表面

---

## 1. 修复原则

### 1.1 总原则

- **先删抽象，再加抽象**
- **先收敛真相源，再收敛类型**
- **先修高杠杆复杂度，再修低价值表面**
- **每个批次都必须独立回归，不做一次性大爆破**

### 1.2 取舍原则

- 如果一个抽象**只有测试在用**，优先降级为测试夹具，而不是维持成公共 API
- 如果一个字段/接口**没有真实数据源**，优先删除占位，而不是保留未来想象空间
- 如果一个配置在代码和脚本里**各有一份**，必须收敛到唯一来源
- 如果一个 helper 只有“一层 object spread”，优先内联

### 1.3 批次验收门槛

每个批次完成后，必须至少通过：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- 相关定向测试

---

## 2. 问题分组

### Group A · 高优先级结构复杂度

| ID | 问题 | 影响 |
|----|------|------|
| A1 | `LoopRunner` 是 `AutonomousDevLoop` 的影子实现 | 双份心智模型，改动成本高 |
| A2 | `AutonomousLoop` 同时存在异常契约和 summary 契约 | 调用侧语义混乱 |
| A3 | `HeartbeatRunner` / `ELECTROOS_FULL_SEED` / agent 清单多真相源 | 新增 agent 容易漂移 |
| A4 | `console.ts` API 面过宽，部分字段无真实后端来源 | API / 测试 / 文档维护面过大 |

### Group B · 中优先级耦合和重复建模

| ID | 问题 | 影响 |
|----|------|------|
| B1 | `packages/agent-runtime/src/types.ts` 变成中心化类型总线 | 无关模块高耦合 |
| B2 | DevOS 12-agent 定义散落在 seed / org chart / prompts / ids | 修改 agent 时多处同步 |
| B3 | `AgentContext` 可选能力与默认实现并存 | 类型与运行时语义重复 |
| B4 | stress / verify / seed 脚本存在配置和运行时双重建模 | 容易与真实 infra 漂移 |

### Group C · 低优先级占位和半使用抽象

| ID | 问题 | 影响 |
|----|------|------|
| C1 | CEO / Finance 存在占位字段 | DTO 看起来比真实能力更宽 |
| C2 | `runMultiMarketCompliance()` 未被真实复用 | 合规流程两套表达 |
| C3 | B2B builder / 类型 / helper 有部分仅测试消费 | API 面略厚 |
| C4 | `task-graph.ts` / `ticket-protocol.ts` / `harness-agent-port.ts` 公共面偏大 | 兼容负担放大 |
| C5 | stress / DR 用例各自手写大段 mock | 接口变更时维护面大 |
| C6 | ClickHouse / budget / import 脚本为“验收模拟器”但结构过重 | 容易误导真实能力边界 |

---

## 3. 完整修复路线图

## Wave 1 · 收敛 Loop 核心语义

**目标：** 先把 DevOS Loop 的“第二套实现”和“失败语义混乱”问题清掉。  
**优先级：** 最高  
**建议周期：** 2–3 天

### PR-1A · `LoopRunner` 降级为测试夹具

**涉及文件：**
- `packages/devos-bridge/src/loop-runner.ts`
- `packages/devos-bridge/src/loop-runner.test.ts`
- 关联测试夹具文件

**动作：**
- 删除内置的 PM / Architect / Security / Deploy 伪业务实现
- 只保留“固定 rehearsal 编排 + 可注入 stub 输出”
- 明确其定位为 test fixture，不再作为公共业务编排层

**预期收益：**
- 消除 `AutonomousDevLoop` 之外的影子实现
- 减少后续 Loop 语义变更的双份维护

**风险：**
- `loop-runner.test.ts` 可能较大，需要同步改断言方式

**验收：**
- `loop-runner.ts` 体量显著下降
- `loop-runner.test.ts` 全绿
- 没有与 `AutonomousDevLoop` 重复的阶段业务规则

### PR-1B · 统一 `AutonomousLoop` 失败契约

**涉及文件：**
- `packages/devos-bridge/src/autonomous-loop.ts`
- `packages/devos-bridge/src/loop-error.ts`
- `packages/devos-bridge/src/loop-context.ts`
- 相关测试

**动作：**
- 二选一：
  - 路线 A：对外统一返回 `LoopRunSummary`
  - 路线 B：对外统一抛 `LoopError`
- 拆分错误码，禁止复用 `deployment_failed` 表达非部署失败
- 统一测试断言模型

**建议选择：**
- **路线 A：summary-first**

原因：
- 当前测试和证据归档已经以 summary 为主
- 更适合审计、验收、文档输出

**验收：**
- 失败模型只有一套主契约
- `LoopError` 不再扮演“半公开、半内部”角色

### PR-1C · Stage log 改为 attempt-aware

**涉及文件：**
- `packages/devos-bridge/src/loop-context.ts`
- `packages/devos-bridge/src/autonomous-loop.ts`
- 相关测试

**动作：**
- 把单个 `StageLog` 改成追加数组，显式记录 `attempt`
- 或保留单条 stage log，但加 `attempts` 统计字段

**建议选择：**
- **保留单条 stage log + `attempts` 统计字段**

原因：
- 更小改动
- 满足当前审计需求
- 避免把 summary 升级成完整事件仓库

**验收：**
- summary 与事件流不再相互矛盾

---

## Wave 2 · 收敛 ElectroOS 运行时和静态定义

**目标：** 消灭 agent 运行入口、seed、默认 heartbeat 输入的多真相源。  
**优先级：** 高  
**建议周期：** 2–3 天

### PR-2A · 建立 ElectroOS canonical agent registry

**涉及文件：**
- `packages/agent-runtime/src/heartbeat-runner.ts`
- `packages/agent-runtime/src/electroos-seed.ts`
- `packages/agent-runtime/src/types.ts`
- 相关测试

**动作：**
- 建立单一 registry：
  - `agentId`
  - runner
  - heartbeat 默认输入
  - seed 元数据（预算、schedule、model）
- 从该 registry 派生 `ELECTROOS_AGENT_IDS`
- 去掉 `executeAgent()` 大 `switch`

**验收：**
- 新增 agent 时只改一个主定义
- `heartbeat-runner.ts` 不再维护硬编码分发表

### PR-2B · 拆分 `agent-runtime/types.ts`

**涉及文件：**
- `packages/agent-runtime/src/types.ts`
- 新增若干领域类型文件
- 所有引用侧

**建议拆分：**
- `ports.ts`
- `context-types.ts`
- `finance.types.ts`
- `ceo.types.ts`
- `compliance.types.ts`
- `support.types.ts`

**动作：**
- 只保留真正跨模块共享的端口类型在公共层
- agent 专属 DTO 下沉到各自领域文件

**验收：**
- `types.ts` 体量显著下降
- 单 agent 改动不再触发大范围类型跳转

### PR-2C · `AgentContext` 非可选化

**涉及文件：**
- `packages/agent-runtime/src/context.ts`
- `packages/agent-runtime/src/types.ts`
- `packages/agent-runtime/src/agents/ceo-agent.agent.ts`
- `packages/agent-runtime/src/agents/support-relay.agent.ts`

**动作：**
- 把已有默认实现的方法改成非可选
- 删除调用侧防御性分支
- `createAgentContext()` 统一提供 no-op / empty 默认实现

**验收：**
- agent 侧不再写 `ctx.xxx ? ... : ...`
- 类型和运行时保持一致

---

## Wave 3 · 收敛 Console/API 和脚本双重建模

**目标：** 把“占位 API”和“脚本里重复配置”的复杂度收回来。  
**优先级：** 高  
**建议周期：** 2–3 天

### PR-3A · 收缩 `console.ts` 到最小可信接口

**涉及文件：**
- `apps/api/src/routes/console.ts`
- `apps/api/src/routes/console.test.ts`

**动作：**
- 盘点所有返回字段：
  - 真实来源字段
  - placeholder 字段
  - synthetic 字段
- 优先保留最小可信 `/overview`
- 对无真实来源的字段做三选一：
  - 删除
  - 标成 `null`
  - 从 overview 中移除，只留内部实现说明

**建议：**
- 不一次删掉全部子路由
- 先抽一个共享 `buildConsoleOverview()` 查询层
- 然后让各子路由尽量复用

**验收：**
- Console 返回字段与真实数据源一致
- 路由间重复聚合逻辑下降

### PR-3B · 收敛 stress seed / verify 的双重建模

**涉及文件：**
- `scripts/stress-seed-50-tenants.ts`
- `scripts/stress-verify-results.ts`
- `docker/pgbouncer/pgbouncer.ini`
- `docker-compose.stress.yml`
- 相关测试

**动作：**
- 去掉脚本里手写的 agent 支持矩阵
- 让验证逻辑直接消费真实配置或共享常量
- 把连接池和预算的“复制配置”改成“读取配置”

**验收：**
- 脚本不再保存独立 infra 常量副本
- 配置漂移风险明显下降

### PR-3C · 统一 `clipmart-import` 模板 schema

**涉及文件：**
- `scripts/clipmart-import.ts`
- `scripts/clipmart-import.test.ts`
- `harness-config/clipmart-template.json`

**动作：**
- 统一到 modern schema
- legacy 兼容逻辑迁出主路径
- 如果需要保留，改成一次性迁移脚本

**验收：**
- 主导入路径只支持一种模板格式
- 测试面减半

---

## Wave 4 · 清理 DTO、薄 helper 和测试表面

**目标：** 做最后一轮“瘦身”，减少 Phase 5 的认知噪音。  
**优先级：** 中  
**建议周期：** 2 天

### PR-4A · 清理 CEO / Finance 占位字段

**涉及文件：**
- `packages/agent-runtime/src/agents/ceo-agent.agent.ts`
- `packages/agent-runtime/src/agents/finance-agent.agent.ts`
- 相关类型和测试

**动作：**
- 删除无真实来源的 `pendingApprovals`
- 删除暂时不会产出的 `cogs` / `other` / `totalCogs`

**验收：**
- DTO 与真实能力对齐

### PR-4B · 清理 compliance / b2b 半使用抽象

**涉及文件：**
- `packages/agent-runtime/src/compliance/compliance-pipeline.ts`
- `packages/agent-runtime/src/agents/product-scout.agent.ts`
- `packages/agent-runtime/src/b2b-agent-config.ts`
- `packages/harness/src/b2b.types.ts`
- `packages/harness/src/b2b.harness.ts`

**动作：**
- `runMultiMarketCompliance()` 要么删除，要么被真实复用
- 薄 builder 没有价值就内联
- 仅测试消费的 helper / 类型收缩到更窄范围

**验收：**
- 合规流程只有一种主表达方式
- B2B 表面更贴近当前闭环

### PR-4C · 收缩 DevOS 公共 API 面

**涉及文件：**
- `packages/devos-bridge/src/task-graph.ts`
- `packages/devos-bridge/src/ticket-protocol.ts`
- `packages/devos-bridge/src/harness-agent-port.ts`

**动作：**
- 非生产使用 helper 改回内部函数
- `ticket-protocol` 改成单一字面量源派生校验
- `harness-agent-port` 从公共抽象降级为测试夹具

**验收：**
- 公开导出数下降
- 对外兼容表面更小

### PR-4D · 统一 stress / DR 测试 helper

**涉及文件：**
- `scripts/stress-50-tenant-heartbeat.ts`
- `scripts/disaster-recovery.test.ts`
- 复用现有 `test-helpers`

**动作：**
- 提供共享的 heartbeat context factory
- 删除重复的大而全 mock

**验收：**
- mock 体量下降
- 运行时接口变更时修改点减少

---

## 4. 按周实施路线图

> 如果按 2 周推进，建议这样拆。

### Week 1

**主题：Loop + Runtime 主体收敛**

1. PR-1A `LoopRunner` 降级为测试夹具
2. PR-1B `AutonomousLoop` 失败契约统一
3. PR-1C Stage log attempt 语义收敛
4. PR-2A ElectroOS canonical agent registry

**Week 1 结束目标：**
- Loop 只剩一套主语义
- ElectroOS 新增/修改 agent 不再三处同步

### Week 2

**主题：类型 / Console / 脚本 / 收尾瘦身**

1. PR-2B `agent-runtime/types.ts` 拆分
2. PR-2C `AgentContext` 非可选化
3. PR-3A `console.ts` 收敛
4. PR-3B stress seed / verify 去双重建模
5. PR-3C `clipmart-import` 统一 schema
6. PR-4A / 4B / 4C / 4D 收尾清理

**Week 2 结束目标：**
- API / scripts / DTO 明显瘦身
- Phase 5 可以在更小的稳定表面上继续开发

---

## 5. 按 PR 推荐拆分

| PR | 标题建议 | 规模 | 风险 | 依赖 |
|----|---------|------|------|------|
| PR-1A | simplify loop-runner into test fixture | M | 中 | 无 |
| PR-1B | unify autonomous loop failure contract | M | 中 | PR-1A 后更稳 |
| PR-1C | make loop stage logs attempt-aware | S | 低 | PR-1B |
| PR-2A | centralize electroos agent registry | M | 中 | 无 |
| PR-2B | split agent-runtime type hub by domain | M | 中 | PR-2A 后更稳 |
| PR-2C | make agent context capabilities non-optional | S-M | 低 | PR-2B |
| PR-3A | shrink console API to real-backed fields | M | 中 | 无 |
| PR-3B | remove duplicated stress config modeling | S-M | 低 | 无 |
| PR-3C | unify clipmart import schema | S-M | 中 | 无 |
| PR-4A | remove placeholder ceo and finance fields | S | 低 | PR-2B |
| PR-4B | simplify compliance and b2b abstractions | S-M | 中 | PR-2B |
| PR-4C | reduce devos public API surface | S-M | 中 | PR-1A / PR-1B |
| PR-4D | share heartbeat stress test helpers | S | 低 | PR-2C |

---

## 6. 建议执行顺序

### 必做（进入 Phase 5 前最值得修）

1. PR-1A
2. PR-1B
3. PR-2A
4. PR-3A
5. PR-2B

### 推荐做（能显著降低 Phase 5 演进摩擦）

6. PR-2C
7. PR-3B
8. PR-3C
9. PR-4A
10. PR-4B

### 可延后（若 Phase 5 首批需求更急）

11. PR-4C
12. PR-4D
13. PR-1C

---

## 7. 风险与回滚策略

### 风险 1 · 测试夹具收缩影响现有 rehearsal 断言

**应对：**
- 先保留旧测试输出结构
- 第二步再收缩断言

### 风险 2 · `console.ts` 收敛影响现有文档或前端草案

**应对：**
- 优先保持字段兼容，先把 placeholder 标为 `null`
- 第二阶段再删字段

### 风险 3 · 类型拆分导致大面积 import churn

**应对：**
- 单独一个 PR 做类型搬迁
- 只改 import，不混入行为改动

### 风险 4 · registry 重构影响 heartbeat 运行稳定性

**应对：**
- 保持 `heartbeat-runner.test.ts` 为核心守门测试
- 重构前后跑全仓回归

---

## 8. 完成定义（Definition of Done）

当以下条件全部满足时，可认为本计划完成：

- `LoopRunner` 不再承载影子业务实现
- `AutonomousLoop` 失败契约只剩一套主模型
- ElectroOS agent registry 收敛为唯一来源
- `console.ts` 主要返回字段有真实来源
- `agent-runtime/types.ts` 拆分完成
- stress / verify / import 脚本不再保存重复配置副本
- CEO / Finance / compliance / B2B 的占位和半使用抽象收敛完成
- 全仓 `lint / typecheck / test` 继续全绿

---

## 9. 建议下一步

如果立即开始实施，推荐从 **PR-1A + PR-1B** 起步，即：

1. 先简化 `LoopRunner`
2. 再统一 `AutonomousLoop` 失败契约

这是整个计划里**收益最高、对 Phase 5 演进成本影响最大**的一组改动。

---

*Phase 4 Code Simplicity Fix Plan · 2026-03-28*
