# Sprint 4 验收清单（Day 12 · D12-01）

来源：`phase2-plan.md` 中 **Sprint 4 验收** 五项。下列「依据」指向本仓库实现或文档；**需沙盒/生产人工确认** 的项在备注中说明，未达标须走豁免流程并登记 `known-issues.md`。

| # | 验收项 | 状态 | 依据（可追溯） |
|---|--------|------|----------------|
| 1 | Ads Optimizer **每 4h** 触发，**日志可查** | 代码就绪 | 默认 cron `0 */4 * * *`（`seed-default-agents.ts` `DEFAULT_CRON`）；运行时 `runAdsOptimizer`（`packages/agent-runtime`）；execute 路由测试通过。**生产验证**：Paperclip 心跳触发 + API 日志。 |
| 2 | 广告**日预算 > $500** 触发**审批 Ticket** | 代码就绪 | `setAdsBudget` → `requestApproval` → `approval-execute-worker`；自动化测试覆盖。**沙盒验证**：构造预算变更超阈值并断言审批单。 |
| 3 | Inventory Guard **每天 08:00** 触发，**低库存**生成**告警 Ticket** | 代码就绪 | 默认 cron `0 8 * * *`；`runInventoryGuard` + Ticket 路径（`agent-runtime` + API）。**生产验证**：时区与 CRON_TZ 以部署为准。 |
| 4 | **5 Agent 种子**一键初始化 | 已满足 | `pnpm seed:agents <tenantUuid>`；API `POST /api/v1/onboarding/initialize-agents`；`--dry-run` 支持；单元测试 + 幂等测试通过。 |
| 5 | Onboarding **4 步**完整流程 **< 30 分钟**（含人工 OAuth） | 已满足 | `docs/onboarding-flow.md`；4 路由就绪（register → OAuth → initialize-agents → health）；health 含 execute-pipeline 探针。 |

## 各日 D* 交付交叉引用

| 阶段 | 文档 / 代码入口 |
|------|-----------------|
| Day 8–9 | `docs/onboarding-flow.md`；`apps/api/src/routes/onboarding.ts`；`seed-default-agents.ts` |
| Day 10 | `docs/ops/agents-seed.md`；`seed-default-agents.test.ts`（dry-run + 幂等） |
| Day 11 | `docs/onboarding-flow.md` Step 4；`onboarding-health-probe.ts` + `agent-execute-probe.ts` |
| 补齐 | `agent-execute-probe.ts`（execute 探针）；`platform-credentials.test.ts`；coverage 恢复 branches>=70 |

## 质量门禁

- **CI**：`pnpm test:ci`（lint + typecheck + test + coverage）全部绿灯。
- **覆盖率**：`branches >= 70%`、`statements >= 80%`、`lines >= 80%`，无 route exclude 排除。
- **Execute 探针**：`agents-execute` 路由支持 `?probe=1` 无副作用模式；onboarding health 使用 execute-pipeline 探针替代 Paperclip-only canary。

## 范围边界（当日不纳入）

- **Sprint 5** DevOS 全套、**Sprint 6** 全量 20 项（见 Phase 2 路线图）。
- **OpenAPI 全文**、多租户压测等属 Sprint 6 及以后，不阻塞本清单签字。
