import { describe, expect, it } from 'vitest'
import { parseAlertmanagerPayload } from './alertmanager-webhook-payload.js'

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    status: 'firing',
    labels: { alertname: 'ElectroOsHarnessErrorRateHigh', severity: 'critical' },
    annotations: { summary: 'Harness error rate high', description: 'Details' },
    startsAt: '2026-03-23T10:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    fingerprint: 'abc123',
    ...overrides,
  }
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    version: '4',
    status: 'firing',
    alerts: [makeAlert()],
    ...overrides,
  }
}

describe('parseAlertmanagerPayload', () => {
  it('parses valid firing payload', () => {
    const result = parseAlertmanagerPayload(makePayload())
    expect(result).not.toBeNull()
    expect(result!.status).toBe('firing')
    expect(result!.alerts).toHaveLength(1)
    expect(result!.alerts[0].labels.alertname).toBe('ElectroOsHarnessErrorRateHigh')
  })

  it('parses valid resolved payload', () => {
    const result = parseAlertmanagerPayload(
      makePayload({ status: 'resolved', alerts: [makeAlert({ status: 'resolved' })] }),
    )
    expect(result).not.toBeNull()
    expect(result!.status).toBe('resolved')
    expect(result!.alerts[0].status).toBe('resolved')
  })

  it('returns null for non-object', () => {
    expect(parseAlertmanagerPayload(null)).toBeNull()
    expect(parseAlertmanagerPayload('string')).toBeNull()
    expect(parseAlertmanagerPayload(42)).toBeNull()
  })

  it('returns null when alerts missing', () => {
    expect(parseAlertmanagerPayload({ version: '4', status: 'firing' })).toBeNull()
  })

  it('returns null when alert entry lacks required fields', () => {
    const bad = makePayload({ alerts: [{ status: 'firing' }] })
    expect(parseAlertmanagerPayload(bad)).toBeNull()
  })
})
