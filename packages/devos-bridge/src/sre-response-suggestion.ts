import type { SrePrometheusAlertName } from './sre-alert-catalog.js'

export interface SreResponseSuggestion {
  alertName: string
  severity: string
  suggestedAction: string
  runbook: string
}

const RUNBOOKS: Record<SrePrometheusAlertName, { severity: string; action: string; runbook: string }> = {
  ElectroOsHarnessErrorRateHigh: {
    severity: 'critical',
    action: 'Check platform API status pages; inspect harness error logs for rate-limiting or auth failures.',
    runbook: 'docs/runbooks/harness-error-rate-high.md',
  },
  ElectroOsAgentHeartbeatStale: {
    severity: 'warning',
    action: 'Verify Paperclip heartbeat cron is running; check agent_heartbeat_last_timestamp labels.',
    runbook: 'docs/runbooks/agent-heartbeat-stale.md',
  },
  ElectroOsApiLatencyP99High: {
    severity: 'warning',
    action: 'Profile slow routes; check DB query latency and connection pool metrics.',
    runbook: 'docs/runbooks/api-latency-p99-high.md',
  },
  ElectroOsDbPoolUsageHigh: {
    severity: 'critical',
    action: 'Scale pool.max or investigate long-running transactions; check for connection leaks.',
    runbook: 'docs/runbooks/db-pool-usage-high.md',
  },
}

/** 根据告警名生成 SRE 标准响应建议（runbook 链接 + 建议操作）。 */
export function buildSreResponseSuggestion(alertName: string): SreResponseSuggestion {
  const entry = RUNBOOKS[alertName as SrePrometheusAlertName]
  if (entry) {
    return {
      alertName,
      severity: entry.severity,
      suggestedAction: entry.action,
      runbook: entry.runbook,
    }
  }
  return {
    alertName,
    severity: 'unknown',
    suggestedAction: 'Investigate alert details and check related dashboards.',
    runbook: 'docs/runbooks/generic-alert.md',
  }
}
