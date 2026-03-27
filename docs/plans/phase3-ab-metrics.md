# Phase 3 — DataOS A/B 可观测方案

## 1. 背景

Phase 3 引入 DataOS 学习层（Feature Store、Decision Memory、Event Lake）后，Agent 决策从"无记忆"升级为"有上下文"。为量化 DataOS 对 Agent 决策质量的影响，需建立 A/B 可观测体系。

**核心假设：** DataOS 注入特征和历史记忆后，Agent 决策质量提升，体现为：
- 审批率下降（Decision Memory 提供更合理的定价参考）
- 内容质量提升（Feature Store 注入产品特征）
- 竞品分析更精准（历史数据反哺）

## 2. 指标定义

| 指标名 | 类型 | 标签 | 含义 |
|--------|------|------|------|
| `dataos_ab_agent_executions_total` | Counter | `agent_type`, `dataos_mode` | Agent 执行总数，按 DataOS 模式分组 |
| `dataos_ab_approval_requests_total` | Counter | `agent_type`, `dataos_mode` | 需人工审批的决策数 |
| `dataos_ab_price_changes_total` | Counter | `dataos_mode` | Price Sentinel 实际执行的调价数 |
| `dataos_ab_content_generations_total` | Counter | `dataos_mode` | Content Writer 文案生成数 |
| `dataos_ab_market_intel_products_total` | Counter | `dataos_mode` | Market Intel 分析产品数 |
| `dataos_ab_execution_duration_seconds` | Histogram | `agent_type`, `dataos_mode` | Agent 执行时长分布 |

**`dataos_mode` 取值：**
- `enabled` — DataOS 可用，Agent 使用 Feature Store + Decision Memory
- `degraded` — DataOS 不可用，Agent 以无记忆模式运行

## 3. 对比维度

采用"自然 A/B"策略：

| 维度 | enabled 组 | degraded 组 |
|------|-----------|-------------|
| 触发条件 | DataOS 正常运行 | DataOS 不可用（`DATAOS_ENABLED=0` 或服务宕机） |
| 特征注入 | `ctx.dataOS.getFeatures()` 返回产品特征 | `ctx.dataOS = undefined`，无特征注入 |
| 记忆注入 | `ctx.dataOS.recallMemory()` 返回历史案例 | 无历史记忆 |
| 学习闭环 | `recordMemory()` + `writeOutcome()` 积累经验 | 无学习记录 |

## 4. 关键 KPI

### 4.1 审批率变化
- **公式：** `approval_rate = ab_approval_requests / ab_agent_executions`
- **期望：** `enabled` 组审批率低于 `degraded` 组（Decision Memory 提供合理参考后，极端定价决策减少）

### 4.2 执行时长
- **公式：** `p50/p95/p99` of `ab_execution_duration_seconds`
- **期望：** `enabled` 组略高于 `degraded` 组（DataOS 调用增加延迟），但差值 < 2s

### 4.3 内容生成质量（Phase 4 扩展）
- 需配合 A/B 实验框架 + 人工评分反馈
- Sprint 5 仅收集数量指标

## 5. 数据查询示例

### PromQL

```promql
# 各 Agent 类型在两种模式下的执行速率
rate(dataos_ab_agent_executions_total[5m])

# 审批率对比
rate(dataos_ab_approval_requests_total{dataos_mode="enabled"}[1h])
  /
rate(dataos_ab_agent_executions_total{dataos_mode="enabled"}[1h])

# 执行时长 p95 对比
histogram_quantile(0.95,
  rate(dataos_ab_execution_duration_seconds_bucket{dataos_mode="enabled"}[5m])
)

# 降级模式占比
sum(rate(dataos_ab_agent_executions_total{dataos_mode="degraded"}[1h]))
  /
sum(rate(dataos_ab_agent_executions_total[1h]))
```

### ClickHouse（Event Lake 分析）

```sql
-- A/B 指标事件统计
SELECT
  JSONExtractString(payload, 'agentType') AS agent_type,
  JSONExtractString(payload, 'dataosMode') AS dataos_mode,
  count() AS executions,
  avg(JSONExtractFloat(payload, 'durationSec')) AS avg_duration_sec,
  quantile(0.95)(JSONExtractFloat(payload, 'durationSec')) AS p95_duration_sec
FROM lake_events
WHERE event_type = 'ab_metric'
  AND created_at > now() - INTERVAL 7 DAY
GROUP BY agent_type, dataos_mode
ORDER BY agent_type, dataos_mode
```

## 6. 阈值与告警

| 告警规则 | 条件 | 严重级别 |
|---------|------|---------|
| 降级模式占比过高 | `degraded / total > 0.20` 持续 15min | Warning |
| 降级模式占比极高 | `degraded / total > 0.50` 持续 5min | Critical |
| Agent 执行超时 | `p95 > 30s` 持续 10min | Warning |
| DataOS 写入全部失败 | `dataos_write_failed` 事件 > 100/min | Critical |

## 7. Phase 4 路线图

- **Feature Flag 级 A/B 实验框架：** 通过 `tenant.dataos_enabled` flag 随机分配 enabled/degraded 组
- **人工评分反馈：** Content Writer 生成结果接入人工评分 → `writeOutcome()` → 闭环优化
- **自动基线对比：** 自动计算 enabled vs degraded KPI 差值，低于阈值触发告警
- **Grafana 仪表板模板：** 预置 A/B 对比面板
