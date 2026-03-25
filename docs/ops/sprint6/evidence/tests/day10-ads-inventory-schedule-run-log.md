# Day 10 AC-P2-07/08/09 调度运行证据

## 目标

- AC-P2-07：Ads Optimizer 每 4 小时触发，预算调整日志可查。
- AC-P2-08：广告预算 >$500 触发审批 Ticket，未批准不执行预算更新。
- AC-P2-09：Inventory Guard 在 08:00 本地时间触发，低库存生成补货建议 Ticket。

## 执行命令

```bash
pnpm exec node --import tsx ./scripts/sprint6-drill-ac-p2-07-08-09.ts
```

## 演练结果（节选）

```json
{
  "passed": true,
  "ac07": {
    "passed": true,
    "expectedCadenceMs": 14400000,
    "simulatedTicks": [
      "2026-03-26T00:00:00.000Z",
      "2026-03-26T04:00:00.000Z",
      "2026-03-26T08:00:00.000Z"
    ],
    "triggerLogs": 3,
    "tickLogs": 3
  },
  "ac08": {
    "passed": true,
    "approvalsRequested": 1,
    "budgetUpdatesApplied": 0,
    "approvalPayload": {
      "action": "ads.set_budget",
      "payload": {
        "proposedDailyBudgetUsd": 506,
        "thresholdUsd": 500
      }
    }
  },
  "ac09": {
    "passed": true,
    "usedTimeZone": "Atlantic/Azores",
    "localHourAtRun": 8,
    "ticketsCreated": 1,
    "replenishApprovalsRequested": 1
  }
}
```

## 结论

- AC-P2-07 达成：4h cadence 对应 `ADS_OPTIMIZER_HEARTBEAT_MS=14400000`，3 个调度 tick 均产生 trigger 日志。
- AC-P2-08 达成：`proposedDailyBudgetUsd=506` (>500) 时仅请求审批，不调用 `updateAdsBudget`。
- AC-P2-09 达成：08:00 本地时间窗口内运行，检测低库存并创建补货建议 Ticket。
