import { describe, expect, it, vi } from 'vitest'
import { runAlertmanagerPipeline } from './alertmanager-pipeline.js'
import { createAlertDedupStore } from './alert-dedup.js'
import type { DevOsClient } from './devos-client.js'

function makeAlert(name: string, status: 'firing' | 'resolved' = 'firing', fp?: string) {
  return {
    status,
    labels: { alertname: name, severity: 'critical' },
    annotations: { summary: `${name} fired`, description: `${name} details` },
    startsAt: '2026-03-23T10:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    fingerprint: fp ?? `fp-${name}`,
  }
}

function makePayload(alerts: ReturnType<typeof makeAlert>[]) {
  return {
    version: '4',
    status: 'firing' as const,
    alerts,
  }
}

function makeClient() {
  let n = 0
  return {
    createTicket: vi.fn().mockImplementation(async () => ({ ticketId: `t-${++n}` })),
  } as unknown as DevOsClient
}

describe('runAlertmanagerPipeline', () => {
  it('returns parse_error when body is invalid', async () => {
    const result = await runAlertmanagerPipeline({
      body: 'garbage',
      client: makeClient(),
    })
    expect(result.parseError).toBe(true)
    expect(result.webhookResult.created).toBe(0)
    expect(result.suggestions).toHaveLength(0)
  })

  it('creates tickets and returns suggestions for firing alerts', async () => {
    const client = makeClient()
    const payload = makePayload([
      makeAlert('ElectroOsHarnessErrorRateHigh'),
      makeAlert('ElectroOsDbPoolUsageHigh'),
    ])

    const result = await runAlertmanagerPipeline({ body: payload, client })
    expect(result.webhookResult.created).toBe(2)
    expect(result.webhookResult.ticketIds).toHaveLength(2)
    expect(result.suggestions).toHaveLength(2)
    expect(result.suggestions[0].alertName).toBe('ElectroOsHarnessErrorRateHigh')
    expect(result.suggestions[1].alertName).toBe('ElectroOsDbPoolUsageHigh')
    expect(result.parseError).toBeUndefined()
  })

  it('skips duplicate fingerprints via dedup store', async () => {
    const client = makeClient()
    const dedup = createAlertDedupStore({ ttlMs: 60_000 })
    const payload = makePayload([
      makeAlert('ElectroOsHarnessErrorRateHigh', 'firing', 'same-fp'),
      makeAlert('ElectroOsDbPoolUsageHigh', 'firing', 'same-fp'),
    ])

    const result = await runAlertmanagerPipeline({ body: payload, client, dedup })
    expect(result.webhookResult.created).toBe(1)
    expect(result.dedupSkipped).toBe(1)
    expect(result.suggestions).toHaveLength(1)
  })

  it('handles mixed firing and resolved alerts', async () => {
    const client = makeClient()
    const payload = makePayload([
      makeAlert('ElectroOsHarnessErrorRateHigh', 'firing'),
      makeAlert('ElectroOsAgentHeartbeatStale', 'resolved'),
    ])

    const result = await runAlertmanagerPipeline({ body: payload, client })
    expect(result.webhookResult.created).toBe(1)
    expect(result.webhookResult.skipped).toBe(1)
    expect(result.suggestions).toHaveLength(1)
  })
})
