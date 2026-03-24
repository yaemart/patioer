import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  checkAlertMetricAlignment,
  extractMetricNamesFromYaml,
} from './sre-alert-metric-alignment.js'
import { SRE_PROMETHEUS_ALERT_NAMES } from './sre-alert-catalog.js'

const _dir = dirname(fileURLToPath(import.meta.url))
const yamlContent = readFileSync(join(_dir, '../prometheus/electroos-alerts.yml'), 'utf8')

const KNOWN_METRICS = [
  'harness_error_total',
  'tenant_request_total',
  'agent_heartbeat_last_timestamp',
  'api_request_duration_seconds_bucket',
  'electroos_db_pool_usage_ratio',
]

describe('extractMetricNamesFromYaml', () => {
  it('extractMetricNamesFromYaml finds all four metric families', () => {
    const names = extractMetricNamesFromYaml(yamlContent)
    expect(names).toContain('harness_error_total')
    expect(names).toContain('tenant_request_total')
    expect(names).toContain('agent_heartbeat_last_timestamp')
    expect(names).toContain('api_request_duration_seconds_bucket')
    expect(names).toContain('electroos_db_pool_usage_ratio')
  })
})

describe('checkAlertMetricAlignment', () => {
  it('checkAlertMetricAlignment returns ok when all metrics present', () => {
    const result = checkAlertMetricAlignment({
      yamlContent,
      knownMetricNames: KNOWN_METRICS,
      catalogAlertNames: SRE_PROMETHEUS_ALERT_NAMES,
    })
    expect(result.ok).toBe(true)
    expect(result.missingMetrics).toHaveLength(0)
    expect(result.extraAlerts).toHaveLength(0)
  })

  it('checkAlertMetricAlignment detects missing metric', () => {
    const result = checkAlertMetricAlignment({
      yamlContent,
      knownMetricNames: ['harness_error_total'],
      catalogAlertNames: SRE_PROMETHEUS_ALERT_NAMES,
    })
    expect(result.ok).toBe(false)
    expect(result.missingMetrics.length).toBeGreaterThan(0)
  })

  it('checkAlertMetricAlignment detects extra alert not in catalog', () => {
    const extraYaml = yamlContent + '\n      - alert: SomeBogusAlert\n        expr: up == 0\n'
    const result = checkAlertMetricAlignment({
      yamlContent: extraYaml,
      knownMetricNames: KNOWN_METRICS,
      catalogAlertNames: SRE_PROMETHEUS_ALERT_NAMES,
    })
    expect(result.ok).toBe(false)
    expect(result.extraAlerts).toContain('SomeBogusAlert')
  })
})
