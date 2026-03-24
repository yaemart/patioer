import type { DevOsTicketPriority } from './ticket-protocol.js'

/** 与 `prometheus/electroos-alerts.yml` 中 `alert:` 名称一一对应（供 SRE Agent / DevOS SLA）。 */
export const SRE_PROMETHEUS_ALERT_NAMES = [
  'ElectroOsHarnessErrorRateHigh',
  'ElectroOsAgentHeartbeatStale',
  'ElectroOsApiLatencyP99High',
  'ElectroOsDbPoolUsageHigh',
] as const

export type SrePrometheusAlertName = (typeof SRE_PROMETHEUS_ALERT_NAMES)[number]

const PRIORITY_BY_ALERT: Record<SrePrometheusAlertName, DevOsTicketPriority> = {
  ElectroOsHarnessErrorRateHigh: 'P0',
  ElectroOsDbPoolUsageHigh: 'P0',
  ElectroOsAgentHeartbeatStale: 'P1',
  ElectroOsApiLatencyP99High: 'P1',
}

/** 告警名 → 建议 DevOS Ticket 优先级（与 YAML `labels.devos_priority` 一致）。 */
export function sreAlertDevOsPriority(alertName: string): DevOsTicketPriority | undefined {
  return PRIORITY_BY_ALERT[alertName as SrePrometheusAlertName]
}
