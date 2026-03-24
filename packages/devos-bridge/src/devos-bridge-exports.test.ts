import { describe, expect, it } from 'vitest'
import * as bridge from './index.js'

const EXPECTED_RUNTIME_EXPORTS = [
  'DEVOS_BRIDGE_VERSION',
  'loadDevOsBridgeEnv',
  'isDevOsBridgeConfigured',
  'defaultSlaForPriority',
  'isDevOsTicket',
  'createDevOsClient',
  'DevOsHttpError',
  'assertElectroOsAndDevOsDbIsolated',
  'isSamePostgresDatabase',
  'postgresIdentityFromUrl',
  'DEVOS_ENGINEERING_ORG',
  'buildSreBootstrapTicket',
  'runDevOsSeed',
  'probeDevOsHttpBaseUrl',
  'buildHarnessUpdateTicket',
  'deriveHarnessUpdatePriority',
  'reportHarnessErrorToDevOs',
  'SRE_PROMETHEUS_ALERT_NAMES',
  'sreAlertDevOsPriority',
  'checkAlertMetricAlignment',
  'extractMetricNamesFromYaml',
  'sreMetricsSmokeCheck',
  'parseAlertmanagerPayload',
  'alertToDevOsTicket',
  'handleAlertmanagerWebhook',
  'buildSreResponseSuggestion',
  'createAlertDedupStore',
  'runAlertmanagerPipeline',
  'FIXTURE_HARNESS_ERROR_FIRING',
  'FIXTURE_HEARTBEAT_STALE_FIRING',
  'FIXTURE_LATENCY_P99_FIRING',
  'FIXTURE_DB_POOL_FIRING',
  'FIXTURE_RESOLVED',
  'runSprint5AcceptanceChecklist',
  'checkTicketProtocolIntegrity',
  'checkHarnessToDevOsFlow',
  'checkAlertRulesCatalogComplete',
  'checkDbIsolationLogic',
] as const

describe('devos-bridge exports', () => {
  it('all runtime exports from index.ts are defined', () => {
    const mod = bridge as Record<string, unknown>
    const missing: string[] = []
    for (const name of EXPECTED_RUNTIME_EXPORTS) {
      if (mod[name] === undefined) missing.push(name)
    }
    expect(missing).toEqual([])
  })

  it('exported functions are callable', () => {
    expect(typeof bridge.defaultSlaForPriority).toBe('function')
    expect(typeof bridge.isDevOsTicket).toBe('function')
    expect(typeof bridge.createDevOsClient).toBe('function')
    expect(typeof bridge.buildHarnessUpdateTicket).toBe('function')
    expect(typeof bridge.sreAlertDevOsPriority).toBe('function')
    expect(typeof bridge.parseAlertmanagerPayload).toBe('function')
    expect(typeof bridge.runAlertmanagerPipeline).toBe('function')
    expect(typeof bridge.createAlertDedupStore).toBe('function')
    expect(typeof bridge.runSprint5AcceptanceChecklist).toBe('function')
  })
})
