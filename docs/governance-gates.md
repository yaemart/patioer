# Governance gates（Sprint 4 · Task 4.7）

单一执行路径：**Agent** 只发起审批或 Ticket；**已批准** 的平台写操作由 `apps/api/src/lib/approval-execute-worker.ts` 在队列任务 `approval.execute` 中执行。

## 动作与状态

| `approvals.action` | Agent 行为（未批准） | 批准后 Worker |
|--------------------|----------------------|---------------|
| `ads.set_budget` | 提议日预算 **>** $500 时仅 `requestApproval`，**不**调用 `updateAdsBudget` | 调用 `updateAdsBudget(campaignId, proposedDailyBudgetUsd)` |
| `inventory.adjust` | 建议补货量 **≥** `replenishApprovalMinUnits`（默认 50，见 `goalContext`）时 `requestApproval`，**不**调用 `updateInventory` | 调用 `updateInventory(platformProductId, targetQuantity)` |
| `price.update` | （既有）需审批后改价 | `updatePrice` |

## Ticket / 审批状态

| `approvals.status` | 含义 |
|--------------------|------|
| `pending` | 待人处理；同一 `(platform, campaign, proposedUsd)` 的重复 pending 会被 Ads Optimizer 跳过二次申请 |
| `approved` | `PATCH .../approvals/:id/resolve` 后入队执行；见 `agent_events.action = approval.resolved.approved` |
| `rejected` | 不入队；无平台写 |

执行完成后见 `agent_events.action = approval.executed`，`payload.kind` 为 `ads.set_budget` / `inventory.adjust` / `price.update` 等。

## 环境变量

- `INVENTORY_GUARD_TZ`：Inventory Guard 可选 `enforceDailyWindow` 的默认 IANA 时区（见 `.env.example`）。
