import type { AlertmanagerWebhookPayload } from './alertmanager-webhook-payload.js'

function firingPayload(alertname: string, severity: string, description: string): AlertmanagerWebhookPayload {
  return {
    version: '4',
    status: 'firing',
    alerts: [
      {
        status: 'firing',
        labels: { alertname, severity, devos_priority: severity === 'critical' ? 'P0' : 'P1' },
        annotations: {
          summary: `${alertname} triggered`,
          description,
        },
        startsAt: '2026-03-23T12:00:00Z',
        endsAt: '0001-01-01T00:00:00Z',
        fingerprint: `fixture-${alertname}`,
      },
    ],
  }
}

export const FIXTURE_HARNESS_ERROR_FIRING = firingPayload(
  'ElectroOsHarnessErrorRateHigh',
  'critical',
  'Harness error rate (12%) exceeds the 5% threshold relative to tenant_request_total.',
)

export const FIXTURE_HEARTBEAT_STALE_FIRING = firingPayload(
  'ElectroOsAgentHeartbeatStale',
  'warning',
  'Agent price-sentinel for tenant t-1 last heartbeat was 18m ago (threshold 15m).',
)

export const FIXTURE_LATENCY_P99_FIRING = firingPayload(
  'ElectroOsApiLatencyP99High',
  'warning',
  'The 99th percentile API latency is 7.2s, exceeding the 5s threshold.',
)

export const FIXTURE_DB_POOL_FIRING = firingPayload(
  'ElectroOsDbPoolUsageHigh',
  'critical',
  'Pool usage ratio is 93%. Risk of connection exhaustion.',
)

export const FIXTURE_RESOLVED: AlertmanagerWebhookPayload = {
  version: '4',
  status: 'resolved',
  alerts: [
    {
      status: 'resolved',
      labels: { alertname: 'ElectroOsHarnessErrorRateHigh', severity: 'critical' },
      annotations: { summary: 'Resolved: Harness error rate', description: 'Error rate back to normal.' },
      startsAt: '2026-03-23T12:00:00Z',
      endsAt: '2026-03-23T12:15:00Z',
      fingerprint: 'fixture-ElectroOsHarnessErrorRateHigh',
    },
  ],
}
