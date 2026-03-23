import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SRE_PROMETHEUS_ALERT_NAMES, sreAlertDevOsPriority } from './sre-alert-catalog.js'

const _dir = dirname(fileURLToPath(import.meta.url))
const alertsYamlPath = join(_dir, '../prometheus/electroos-alerts.yml')

describe('SRE_PROMETHEUS_ALERT_NAMES', () => {
  it('SRE_PROMETHEUS_ALERT_NAMES lists four alert names', () => {
    expect(SRE_PROMETHEUS_ALERT_NAMES).toHaveLength(4)
    expect(new Set(SRE_PROMETHEUS_ALERT_NAMES).size).toBe(4)
  })
})

describe('sreAlertDevOsPriority', () => {
  it('sreAlertDevOsPriority returns P0 for harness and db pool alerts', () => {
    expect(sreAlertDevOsPriority('ElectroOsHarnessErrorRateHigh')).toBe('P0')
    expect(sreAlertDevOsPriority('ElectroOsDbPoolUsageHigh')).toBe('P0')
  })

  it('sreAlertDevOsPriority returns P1 for heartbeat and latency alerts', () => {
    expect(sreAlertDevOsPriority('ElectroOsAgentHeartbeatStale')).toBe('P1')
    expect(sreAlertDevOsPriority('ElectroOsApiLatencyP99High')).toBe('P1')
  })
})

describe('electroos-alerts.yml', () => {
  it('electroos-alerts.yml contains every catalog alert name', () => {
    const yaml = readFileSync(alertsYamlPath, 'utf8')
    for (const name of SRE_PROMETHEUS_ALERT_NAMES) {
      expect(yaml).toContain(`alert: ${name}`)
    }
  })
})
