---
date: 2026-03-23
topic: walmart-wayfair-platform-evaluation
version: "1.0"
related:
  - docs/brainstorms/2026-03-21-electroos-system-constitution-pdf-brainstorm.md
  - docs/governance-gates.md
  - docs/architecture/harness-and-market.md
  - docs/plans/phase2-plan.md
---

# Walmart + Wayfair 平台集成方案评估

## 评估目的

基于 **System Constitution v1.0**、**Governance Gates**、**Phase 2 实施现状**及**已有四平台（Shopify / Amazon / TikTok / Shopee）的集成模式**，对上一轮提出的 Walmart + Wayfair 新增方案进行 **合规性、完整性、风险** 三维审视。

---

## 一、宪法合规性审计（Constitution Compliance）

### 1.1 硬约束逐项对照

| # | Constitution 硬约束 | 方案覆盖 | 评估 |
|---|---------------------|---------|------|
| C1 | Agent 绝不直调平台 SDK，必须经 `TenantHarness` | ✅ 方案在 Harness 层封装所有 API 调用 | **合规** |
| C2 | 所有核心表 `tenant_id` + RLS | ⚠️ 方案提到"不需要新 migration"，但未提及 `platform_poll_cursors` 的 RLS | **需补充**：若新增表必须包含 RLS policy |
| C3 | 价格变动 >15% 须人工审批 | ✅ 不影响——审批逻辑在 Agent 层，Harness 只是执行通道 | **合规** |
| C4 | 广告日预算 >$500 须审批 | ✅ 方案明确 AdsCapable 暂不实现；未来实现时审批逻辑在 Agent 层 | **合规** |
| C5 | 补货建议 ≥50 units 须审批 | ✅ InventoryCapable 走同一审批路径 | **合规** |
| C6 | 所有 Agent 操作写入不可变审计日志 | ✅ 不影响——`agent_events` 由 AgentContext 处理，与 Harness 无关 | **合规** |
| C7 | 测试覆盖率 ≥80% | ⚠️ 方案列出了测试文件但未明确覆盖率目标 | **需强化**：显式要求每个 Harness ≥80% 覆盖 |
| C8 | TypeScript strict mode | ✅ 隐含（Monorepo 统一 tsconfig.base.json） | **合规** |
| C9 | Drizzle ORM（禁 Prisma） | ✅ 无新 ORM 引入 | **合规** |
| C10 | 编排仅 Paperclip | ✅ 不涉及编排变更 | **合规** |
| C11 | Harness 48h SLA + 向后兼容 + 集成测试 | ⚠️ 方案未提及 SLA 和向后兼容承诺 | **需补充** |
| C12 | 禁止 Agent 改 Constitution | ✅ 不涉及 | **合规** |
| C13 | AES-256 凭证加密 | ✅ 方案使用现有 `encryptToken` / `CRED_ENCRYPTION_KEY` | **合规** |

### 1.2 宪法 Ch5 门控表对照

| 门控动作 | 方案处理 | 合规 |
|---------|---------|------|
| 调价 >15% | Harness 只暴露 `updatePrice`，门控在 Agent 层 | ✅ |
| 广告日预算 >$500 | Walmart/Wayfair 暂不实现 AdsCapable | ✅（N/A） |
| 新品上架 | Harness 不暴露上架接口（只有 getProducts/updatePrice） | ✅（N/A） |
| **新 Harness 方法** | Constitution Ch5 要求新 Harness 方法需 **CTO+人工审批** | ⚠️ **方案未提及**——如果 Walmart/Wayfair 需要 TenantHarness 接口以外的新方法，需走审批 |
| **DB schema 变更** | `platform_poll_cursors` 表需走 migration + 审批 | ⚠️ **方案未显式提及审批流程** |

### 1.3 合规总评

> **17 项硬约束中 13 项完全合规，4 项需补充**（RLS on 新表、覆盖率显式目标、Harness SLA 承诺、新方法/schema 变更审批流程）。核心架构路径正确。

---

## 二、架构完整性审计

### 2.1 与现有四平台模式的对齐度

| 集成点 | Shopify/Amazon/TikTok/Shopee 模式 | Walmart 方案 | Wayfair 方案 | 差异评估 |
|--------|----------------------------------|-------------|-------------|---------|
| **认证模型** | Authorization Code (Shopify/TikTok) 或 HMAC (Shopee) 或 LWA (Amazon) | Client Credentials | Client Credentials | ✅ 更简单，但需要新的 credential_type 值 |
| **Token 生命周期** | Shopify=永久，Amazon=refresh，TikTok/Shopee=access+refresh | 15分钟 access（需频繁刷新） | 有 expires_in | ⚠️ Walmart 的 15min 过期需在 Harness 内建自动刷新逻辑——**与 Amazon LWA 类似但更频繁** |
| **API 协议** | 全部 REST | REST | **GraphQL** | ⚠️ **重大差异**：首次引入 GraphQL 客户端，增加了复杂度和新依赖 |
| **Webhook** | 全部支持平台推送 | 支持（Event Notification API） | **不支持** → 轮询 | ⚠️ **重大差异**：引入轮询机制是新的运维模式 |
| **消息/客服** | Shopify=空数组，Amazon/TikTok/Shopee 有实现 | 不支持 | 不支持 | ✅ 与 Shopify 模式一致（返回空） |
| **Region 模型** | 各平台不同（global/na/eu/fe/SG/MY...） | us/ca/mx | us/eu | ✅ 一致模式 |

### 2.2 方案遗漏项（关键）

| # | 遗漏 | 严重性 | 说明 |
|---|------|--------|------|
| **M1** | **Harness 导出注册** | 🟡 中 | 方案未提 `packages/harness/src/index.ts` 的 barrel export 更新 |
| **M2** | **HTTP 客户端韧性规范** | 🟡 中 | 未提及 fetch 超时（15s）、重试策略（3-5次）、指数退避——Constitution 及现有模式要求 |
| **M3** | **TokenBucket 限流** | 🟡 中 | 方案提了 Walmart 20 req/s 但未提 Wayfair 的限流策略 |
| **M4** | **`Analytics.truncated` 标记** | 🟡 中 | `getAnalytics` 须正确标记 `truncated`（见 `harness-and-market.md`） |
| **M5** | **Market 层集成** | 🟡 中 | `packages/market` 已在 Phase 2 Sprint 3 交付（货币/税务/合规/MarketContext），方案未提及 Walmart (USD/CAD/MXN) 和 Wayfair (USD/GBP/EUR) 的 Market 规则适配 |
| **M6** | **`app.smoke.test.ts` 更新** | 🟢 低 | 现有四平台都有 smoke test 覆盖，新路由需加入 |
| **M7** | **`resolve-credential.ts` 的 `DEFAULT_CREDENTIAL_PLATFORM_ORDER` 更新** | 🟡 中 | 新平台需加入默认凭证解析顺序 |
| **M8** | **`agents-execute.ts` 的 `executeAgentByType` switch** | 🟢 低 | Agent 层面无需新分支——但 `buildExecutionContext` 中的平台校验需覆盖新平台 |
| **M9** | **Seed default agents** | 🟢 低 | `seed-default-agents.ts` 可能需更新，确认新平台的默认 agent 配置 |
| **M10** | **Prometheus 指标** | 🟡 中 | 方案未提 `plugins/metrics.ts` 的平台标签扩展——Constitution Ch8 要求可观测性 |

### 2.3 两条 Harness 获取路径的影响

根据 `docs/architecture/harness-and-market.md`，系统有**两条 Harness 路径**：

1. **DB 路径**（`createHarness` + `HarnessRegistry` class）→ HTTP execute 路由
2. **Env 路径**（`registerHarnessFactory` + module-level `getHarness`）→ 内部 job/脚本

方案只覆盖了 DB 路径（harness-factory.ts），**遗漏了 agent-bootstrap.ts 的 env 路径注册**——虽然 agent-bootstrap 当前只注册了 Amazon，但如需 Walmart/Wayfair 的 env 直连场景（如本地开发、MCP 工具），应同步注册。

---

## 三、风险评估

### 3.1 高风险项

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| **Wayfair GraphQL 客户端引入** | 首次在 Harness 层使用 GraphQL，增加新依赖（graphql-request 或 urql），可能与 Constitution Ch3 的 REST-first 理念冲突 | 高 | 1) 不引入 GraphQL 框架，用原生 `fetch` + JSON body 直接调用 GraphQL endpoint<br>2) 在 Harness 内部封装，不暴露 GraphQL 语义到外部 |
| **Wayfair 轮询模式的运维复杂度** | 引入定时轮询是全新的运维模式——需要 BullMQ repeatable job、幂等性保证、水位线管理、失败重试 | 中高 | 1) 复用现有 BullMQ 基础设施<br>2) `platform_poll_cursors` 表跟踪水位<br>3) 明确 SLO：轮询延迟 ≤5min |
| **Walmart 15min Token 频繁刷新** | 高并发下可能出现 Token 竞态（多个请求同时发现过期并尝试刷新） | 中 | 使用互斥锁或 Promise 缓存模式（只有第一个请求执行刷新，其余等待） |

### 3.2 中风险项

| 风险 | 缓解 |
|------|------|
| Walmart Webhook 签名验证需实测 | Sandbox 环境先验证 HMAC 方案 |
| Wayfair API 文档稀缺（相比 Amazon/Shopify） | 依赖 sandbox 实测 + plentymarkets 参考实现 |
| 两平台同时交付的测试负担 | 可分两个子 Sprint 串行交付 |

### 3.3 低风险项

| 风险 | 说明 |
|------|------|
| 数据库 `platform` 字段无需 migration | text 类型天然支持新值，风险极低 |
| Agent 层无需改动 | 5 个 Agent 通过 Harness 抽象交互，平台无关 |

---

## 四、YAGNI 审查（防过度设计）

| 方案中的设计 | YAGNI 评估 | 建议 |
|-------------|-----------|------|
| `platform_poll_cursors` 表 | ⚠️ 可能过早——Wayfair 轮询可先用 Redis key 存水位线 | **Phase 1 用 Redis，确认稳定后再考虑持久化** |
| `walmart-webhook-subscription.ts` 自动订阅管理 | ✅ 必要——Walmart 需主动创建 webhook 订阅 | 保留 |
| Walmart Region 支持 CA/MX | ⚠️ 如果当前只有 US 卖家，CA/MX 可延后 | **先只实现 US，Region 预留但不实现 CA/MX 特定逻辑** |
| Wayfair EU region | ⚠️ 同上 | **先只实现 US** |
| AdsCapable 显式标注"不实现" | ✅ 正确的 YAGNI 决策 | 保留 |
| Wayfair `useSandbox` 选项 | ⚠️ 开发期需要，但不应成为生产代码的持久选项 | **用 env 控制，不进 credential metadata** |
| GraphQL Client 封装 | ✅ 但应极简——原生 fetch 即可 | **不引入 graphql-request 等第三方包** |

---

## 五、与现有交付物的依赖关系

### 5.1 前置条件

| 前置 | 状态 | 风险 |
|------|------|------|
| Phase 2 所有 Sprint 代码交付 | ✅ 完成 | 无 |
| Phase 2 验收清单 20 项签核 | ⬜ 全部待做 | **如果验收发现架构缺陷，可能影响新平台方案** |
| Phase 1 AC-01 Paperclip 联调 | ⏳ 代码就绪 | 低——新平台不依赖 Paperclip 通路 |
| Market 层（货币/税务/合规） | ✅ Sprint 3 交付 | 方案需补充 Market 适配 |

### 5.2 影响范围

新增 Walmart/Wayfair **不会** 破坏：
- 现有 4 平台的 Harness / OAuth / Webhook
- 5 个 Agent 的执行逻辑（platform-agnostic）
- 审批工作流（approval-execute-worker）
- RLS / 多租户隔离

**可能影响：**
- `SUPPORTED_PLATFORMS` 数组扩展会影响 `resolve-credential.ts` 的默认平台优先级
- CI 运行时间增加（更多测试）

---

## 六、方案改进建议（按优先级排序）

### P0（必须修改）

1. **补充 RLS 要求**：任何新增表（如 `platform_poll_cursors`）必须包含 `tenant_id` + RLS policy + FORCE RLS
2. **补充 HTTP 韧性规范**：明确 fetch timeout 15s、重试 3 次、指数退避——与现有四平台一致
3. **补充 Constitution Ch5 审批流程**：新 Harness 方法和 DB schema 变更需记录审批决策
4. **GraphQL 不引入新框架**：Wayfair Harness 内部用原生 `fetch` 调 GraphQL endpoint，不引入 `graphql-request` / `urql` / `@apollo/client`

### P1（强烈建议）

5. **补充 Market 层适配**：Walmart (USD/CAD/MXN) 和 Wayfair (USD/GBP/EUR) 的货币/税务规则
6. **补充可观测性**：`plugins/metrics.ts` 的平台标签、Harness 错误率指标（Constitution Ch8 P0 门槛：>5%）
7. **补充 `resolve-credential.ts` 更新**：`DEFAULT_CREDENTIAL_PLATFORM_ORDER` 添加新平台
8. **Walmart Token 刷新并发安全**：使用 Promise 缓存模式避免竞态
9. **补充 Harness 导出**：`packages/harness/src/index.ts` barrel export

### P2（建议优化）

10. **Wayfair 轮询先用 Redis**：水位线存 Redis key，不急于建表
11. **Region 按需实现**：Walmart 先只做 US，Wayfair 先只做 US
12. **分阶段交付**：建议 Walmart 先行（REST + Webhook，与现有模式一致性高），Wayfair 后行（GraphQL + 轮询，复杂度高）
13. **补充 smoke test**：`app.smoke.test.ts` 覆盖新路由

---

## 七、推荐交付顺序

```
Sprint A (Walmart, ~4天)          Sprint B (Wayfair, ~5天)
┌─────────────────────┐          ┌─────────────────────┐
│ 1. Platform 类型扩展  │          │ 1. WayfairHarness    │
│ 2. WalmartHarness    │          │    (GraphQL 封装)     │
│ 3. OAuth 路由        │          │ 2. OAuth 路由         │
│ 4. Webhook 路由+订阅  │          │ 3. Poller (BullMQ)   │
│ 5. Factory 扩展      │          │ 4. Factory 扩展       │
│ 6. InventoryCapable  │          │ 5. InventoryCapable   │
│ 7. Market 适配       │          │ 6. Market 适配        │
│ 8. 测试 ≥80%        │          │ 7. 测试 ≥80%         │
└─────────────────────┘          └─────────────────────┘
```

**理由：** Walmart 是 REST + Webhook 模式，与现有 Amazon 最为接近，风险低、可快速交付并验证扩展模式；Wayfair 引入 GraphQL + 轮询两个新模式，复杂度更高，放在第二个 Sprint 可以在 Walmart 经验基础上迭代。

---

## Key Decisions

- **宪法合规**：方案核心路径合规（13/17 项），4 项需补充但无结构性风险
- **最大风险**：Wayfair 的 GraphQL + 轮询双重新模式引入
- **YAGNI**：GraphQL 用原生 fetch 不引入框架；轮询水位线先 Redis 后考虑持久化
- **Region 范围**：Walmart US/CA/MX 全覆盖；Wayfair 仅 US（EU 预留参数不实现）
- **Walmart Ads 预留**：预留 AdsCapable 接口签名，方法体待 WCPN 审批后实现
- **Wayfair 轮询可配置**：默认 15min，租户可覆盖（5/15/30min），纳入 tenant_settings 体系
- **交付顺序**：Walmart 先行（REST + Webhook，低风险），Wayfair 后行（GraphQL + 轮询，高复杂度）
- **Phase 2 并行**：验收与新平台开发并行推进，新平台在独立分支开发

## Resolved Questions

1. **Walmart Connect Ads API 准入** → **计划申请 WCPN**：Walmart Harness 需**预留 AdsCapable 接口签名**但不实现方法体，确保未来接入时 Harness 接口向后兼容（Constitution Ch7 SLA 要求）
2. **Wayfair 轮询频率** → **租户可配置**：默认 15 分钟，允许租户通过 `goalContext` 覆盖（5min / 15min / 30min）。需要在 Constitution Ch6（多租户覆盖）框架下实现——轮询间隔加入 `tenant_settings` 可覆盖项
3. **Phase 2 验收时间线** → **与新平台并行推进**：Phase 2 验收和 Walmart/Wayfair 开发同时进行。风险缓解：如果验收发现架构缺陷，新平台代码在独立分支上，可随时调整
4. **Region 范围** → **Walmart US/CA/MX + Wayfair 仅 US**：Walmart 实现全三个北美区域（API base URL 不同，逻辑共享）；Wayfair 初期仅 US，EU 预留 region 参数但不实现特定逻辑

## Open Questions

1. **Wayfair API 版本**：当前 GraphQL endpoint 是否有版本管理？PlentyMarkets 参考实现的 API 版本是否与我们的目标版本一致？（需 Sandbox 实测确认）

## Next Steps

→ 解答最后一个 Open Question（可在实施期通过 Sandbox 实测确认）后进入 `/workflows:plan` 生成实施级 task list
