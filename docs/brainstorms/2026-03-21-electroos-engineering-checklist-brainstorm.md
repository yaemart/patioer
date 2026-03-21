---
date: 2026-03-21
topic: electroos-engineering-checklist
related:
  - docs/brainstorms/2026-03-21-electroos-devos-architecture-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-devos-constitution-brainstorm.md
  - docs/brainstorms/2026-03-21-electroos-constitution-guard-brainstorm.md
---

# ElectroOS 开发 Checklist（工程师版）

## What We're Building

一份**工程执行清单**：每个 **PR**、每个 **Agent 任务**、每次**发布前**必须逐项勾选；**任一条不满足 → 不允许合入 / 不允许部署**。  
定位：**可直接给 DevOS Agent 与人类工程师使用**，与《架构 brainstorm》《宪法 brainstorm》配套——前者定义能力与原则，本清单定义**验收动作**。

**推荐落地方式（择一或组合）：** DevOS Agent 自动 PR 检查；GitHub PR Template 人工自检；CI Gate 强阻塞部署。

## Why This Approach

Checklist 把抽象规则变成**可执行的布尔条件**，减少「觉得合规」实际漏项；与自动化结合后，等价于把宪法**编译进流程**。YAGNI：**未上线的模块可标 N/A**，但须在 PR 说明原因，避免清单形同虚设。

## Key Decisions

| 决策 | 说明 |
|------|------|
| 合入/部署硬门槛 | 清单未过 → 不合入、不部署（与宪法一致） |
| 分域组织 | 架构合规 → 模块实现 → Agent → 治理 → DataOS → 测试 → DevOS → 安全 → 租户 → 可观测 → 反模式 |
| Phase 切分 | DataOS 章节标注 Phase 3+，避免早期团队被未完成能力阻塞（但须显式声明豁免） |
| 数值阈值 | 文中 15%、$500 等为**示例默认**；最终以租户策略与环境配置为准（见 Open Questions） |

---

## 一、架构合规（Architecture Compliance）

### 模块边界

- [ ] 没有跨模块直接访问数据库
- [ ] 所有跨模块调用通过 **API 或 Event**
- [ ] 没有「隐式耦合」（共享 utils 操作他人数据）

### Harness 规则（最高优先级）

- [ ] 所有平台操作只通过 `PlatformHarness`
- [ ] 没有直接调用 Shopify / Amazon / TikTok SDK
- [ ] Harness 方法有类型定义 + 错误处理

### API First

- [ ] API 已定义 OpenAPI Schema
- [ ] 路由使用 `/api/v1/...`
- [ ] 向后兼容（未删除旧字段）

---

## 二、模块实现规范（Module Implementation）

### 标准目录结构

- [ ] 存在 controller / service / repository / schema / types / test
- [ ] 文件命名符合 kebab-case

### 类型与验证

- [ ] 所有输入经过 Zod 校验
- [ ] 所有输出有 TypeScript 类型定义
- [ ] 无 `any` 滥用

### 错误处理（必须结构化）

- [ ] 使用标准 `AgentError` 类型
- [ ] 区分：`budget_exceeded` / `approval_required` / `harness_error` / `rate_limited`
- [ ] 没有裸 `throw new Error()`

---

## 三、Agent 行为规范（Agent Compliance）

### Pre-flight 检查（必须）

- [ ] 已读取 goal_context
- [ ] 已检查 budget
- [ ] 已检查 approval 状态
- [ ] 已读取相关 Constitution 规则

### 执行约束

- [ ] 没有直接访问数据库
- [ ] 没有绕过 Harness
- [ ] 没有跨租户访问数据

### 审计与日志（强制）

- [ ] 所有操作写入 Paperclip Ticket
- [ ] 关键步骤写 Event（DataOS）
- [ ] 失败生成结构化报告

---

## 四、风险与治理（Governance）

### 调价 / 广告 / 高风险操作

- [ ] \>15% 调价已触发审批（或符合租户策略）
- [ ] 广告预算 \>$500 已审批（或符合租户策略）
- [ ] 商品上架已人工确认（若业务要求）

### Budget 控制

- [ ] Agent 有预算限制
- [ ] 超预算会自动停止
- [ ] 有 budget usage 记录

---

## 五、DataOS 集成（Phase 3+ 必须）

### Feature Store

- [ ] Agent 读取 Feature Store 数据（非实时 API 拼接）
- [ ] 使用 Redis cache（TTL 15min）

### Decision Memory

- [ ] 执行前调用 recall()
- [ ] 执行后调用 record()
- [ ] 有 outcome 回写机制（异步）

### Event Lake

- [ ] 所有关键行为写入 ClickHouse（或当期 Event Lake 实现）
- [ ] payload 完整（context + action + metadata）
- [ ] 没有「只记录成功」的情况

---

## 六、测试（Testing）

### 单元测试

- [ ] Service 层有测试
- [ ] Repository 层有测试

### 集成测试（关键）

- [ ] Harness 有集成测试（必须）
- [ ] API 有端到端测试

### 覆盖率

- [ ] ≥ 80%（或团队约定阈值，须在仓库文档写明）
- [ ] CI 自动检查

---

## 七、DevOS 流程（CI/CD）

### PR 规范

- [ ] 有清晰描述（What / Why）
- [ ] 关联 Ticket
- [ ] 包含测试

### 自动化检查

- [ ] lint 通过
- [ ] test 通过
- [ ] npm audit 通过（或等价供应链扫描）

### 部署流程

- [ ] 未绕过 CI/CD
- [ ] 已人工审批（生产环境）
- [ ] 有回滚方案

---

## 八、安全（Security）

- [ ] API 使用 JWT 鉴权（或等效方案，与全局 Auth 设计一致）
- [ ] 权限符合 RBAC（admin / seller / agent / readonly）
- [ ] 敏感数据已加密（AES-256 或 KMS）
- [ ] 无明文 API key
- [ ] secrets 存储在 Secrets Manager

---

## 九、多租户（Multi-tenant）

- [ ] 所有核心表包含 `tenant_id`
- [ ] 已启用 PostgreSQL RLS
- [ ] 查询自动带 tenant 上下文
- [ ] 无跨租户数据泄露风险

---

## 十、可观测性（Observability）

### Metrics

- [ ] 已上报：`agent.heartbeat`、`budget.utilization`、`harness.error_rate`

### Logging

- [ ] 结构化日志（JSON）
- [ ] 可关联 tenant_id / agent_id

### Alert

- [ ] P0 / P1 / P2 告警已配置

---

## 十一、反模式检查（Anti-Patterns）

**出现任意一项 → ❌ 拒绝合入**

- [ ] 直接调用平台 SDK
- [ ] 跨服务读数据库
- [ ] Agent 无预算控制
- [ ] 没有 Event 记录
- [ ] 没有测试
- [ ] DevOS 绕过 CI/CD
- [ ] 硬编码 tenant_id
- [ ] 使用 any 替代类型

---

## 工程师心智模型（必须理解）

**不是在构建：** 单一 SaaS、一组 API、一堆 Agent。  
**是在构建：** **可自我进化的软件组织** — ElectroOS = 业务执行；DevOS = 工程与演进；DataOS = 记忆与经验。

---

## Approaches（落地方式）

| 方式 | 描述 | Pros | Cons | 适用 |
|------|------|------|------|------|
| **A. DevOS Agent 接 PR** | PR 打开即自动跑清单规则 | 省人力、可解释拒绝原因 | 需建设 Agent 与权限 | **推荐长期** |
| **B. GitHub PR Template** | 模板嵌 checklist | 零开发、立即可用 | 依赖自觉 | 早期 / 补充 |
| **C. CI Gate** | 测试/lint/覆盖率/自定义脚本阻塞 | 最强约束 | 维护成本 | 与 A/B 叠加 |

**Recommendation：** **B 立即** + **C 尽快** + **A 作为 DevOS 能力逐步增强**。

---

## Open Questions

1. **阈值产品化：** 15% / $500 / 上架确认等是否全部**租户可配**，还是全局默认 + 租户覆盖？  
2. **JWT：** 若实际采用 session/cookie + BFF，是否统一改为「与 OpenAPI 文档一致的鉴权段落」而非硬编码 JWT？  
3. **覆盖率 80%：** 是否按**包**分级（如 Harness 100%、脚本 60%）？  
4. **Constitution Guard Agent：** 详见 [`2026-03-21-electroos-constitution-guard-brainstorm.md`](./2026-03-21-electroos-constitution-guard-brainstorm.md)；规划中拆 MVP 与 Phase 2。

## Resolved Questions

（暂无。）

## Next Steps

→ 将本清单与《宪法》一并作为 `/workflows:plan` 输入；规划中拆分 **P0 自动化规则**（可 CI）与 **P1 人工/Agent 规则**。
