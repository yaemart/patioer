# Prometheus · SRE 告警规则（Sprint 5 · Task 5.7）

## 规则文件

仓库内 canonical 副本：

- [`packages/devos-bridge/prometheus/electroos-alerts.yml`](../../packages/devos-bridge/prometheus/electroos-alerts.yml)

部署时将该文件纳入 Prometheus `rule_files`，或在 Kubernetes（如 kube-prometheus-stack）中用 `additionalPrometheusRulesMap` 挂载。

## 指标来源

告警依赖 ElectroOS API `GET /metrics`（`apps/api/src/plugins/metrics.ts`）中的指标名，包括：

- `harness_error_total`、`tenant_request_total`（错误率相对请求）
- `agent_heartbeat_last_timestamp`（心跳陈旧）
- `api_request_duration_seconds_bucket`（延迟 p99）
- `electroos_db_pool_usage_ratio`（PG 连接池占用）

## DevOS 优先级映射

TypeScript 目录 [`packages/devos-bridge/src/sre-alert-catalog.ts`](../../packages/devos-bridge/src/sre-alert-catalog.ts) 导出：

- `SRE_PROMETHEUS_ALERT_NAMES`：与 YAML 中 `alert:` 名称一致
- `sreAlertDevOsPriority(alertName)`：返回建议的 `DevOsTicket` 优先级（`P0` / `P1`），与 YAML 中 `labels.devos_priority` 对齐，供 SRE Agent 或 Alertmanager → DevOS 桥接使用。

## 对齐验证（Sprint 5 Day 7）

`packages/devos-bridge` 导出两个辅助函数用于规则↔指标对齐校验：

- `checkAlertMetricAlignment({ yamlContent, knownMetricNames, catalogAlertNames })`  
  编程验证 YAML 中 `expr` 引用的 metric 全部存在于 `knownMetricNames`，且 `alert:` 名与 TS catalog 匹配。返回 `{ ok, missingMetrics, extraAlerts }`。  
  在 `sre-alert-metric-alignment.test.ts` 中已用 `metrics.ts` 的六个已注册指标名验证。可选：在 CI 跑 `vitest` 时自动执行。

- `sreMetricsSmokeCheck({ metricsUrl, requiredMetrics })`  
  拉取 `/metrics` 文本，检查每个 `requiredMetrics` 名出现在响应中；本地冒烟或集成测试时一行调用即可。

## 相关文档

- 本地 DevOS 栈：[devos-local.md](./devos-local.md)
