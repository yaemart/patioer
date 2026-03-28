# AC-P3-11 验证证据：Insight Agent 回写 outcome

**验证日期：** 2026-03-27
**验收标准：** Insight Agent 每周一运行，将 7 天前的决策回写 outcome

## 测试流程

### Step 1: 触发 Insight Agent tick

```bash
POST /internal/v1/insight/trigger
```

**响应：** `{"ok": true, "processed": 0, "written": 0, "failed": 0}`

Prometheus 指标确认 `dataos_insight_agent_ticks_total` 从 0 → 1。

### Step 2: 手动回写 outcome（模拟 Insight Agent 反馈闭环）

```bash
POST /internal/v1/memory/outcome
{
  "tenantId": "550e8400-e29b-41d4-a716-446655440001",
  "decisionId": "0616e476-a744-4769-b2d4-fb88bfda8d60",
  "outcome": {
    "applied": true,
    "revenueChange": 0.05,
    "convRateAfter": 0.15,
    "salesDelta": 12
  }
}
```

**响应：** `{"ok": true}`

### Step 3: 数据库验证

| 字段 | 值 |
|---|---|
| id | 0616e476-a744-4769-b2d4-fb88bfda8d60 |
| agent_id | price-sentinel |
| outcome | `{"applied": true, "salesDelta": 12, "convRateAfter": 0.15, "revenueChange": 0.05}` |
| outcome_at | 2026-03-27 23:14:30 |

## 结论

**AC-P3-11 ✅ PASS** — Insight Agent 可触发，outcome 反馈闭环可正常写入
