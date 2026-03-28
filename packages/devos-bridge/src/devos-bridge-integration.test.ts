import { describe, expect, it, vi } from 'vitest'
import { buildHarnessUpdateTicket } from './harness-update-ticket.js'
import { isDevOsTicket } from './ticket-protocol.js'
import { alertToDevOsTicket } from './alertmanager-to-ticket.js'
import { runAlertmanagerPipeline } from './alertmanager-pipeline.js'
import { createAlertDedupStore } from './alert-dedup.js'
import { buildSreBootstrapTicket } from './devos-org-chart.js'
import {
  FIXTURE_DB_POOL_FIRING,
  FIXTURE_HARNESS_ERROR_FIRING,
  FIXTURE_HEARTBEAT_STALE_FIRING,
  FIXTURE_LATENCY_P99_FIRING,
} from './alertmanager-e2e-fixtures.js'
import type { DevOsClient } from './devos-client.js'

function makeClient() {
  let n = 0
  return {
    createTicket: vi.fn().mockImplementation(async () => ({ ticketId: `t-${++n}` })),
    getTicketStatus: vi.fn().mockResolvedValue('open'),
    acknowledgeTicket: vi.fn().mockResolvedValue(undefined),
    resolveTicket: vi.fn().mockResolvedValue(undefined),
  } as unknown as DevOsClient
}

describe('devos-bridge integration', () => {
  it('harness error → buildHarnessUpdateTicket → client.createTicket round-trip', async () => {
    const client = makeClient()
    const ticket = buildHarnessUpdateTicket({
      platform: 'amazon',
      code: 'auth_expired',
      message: 'SP-API token refresh failed',
      tenantId: 'tenant-42',
    })
    expect(isDevOsTicket(ticket)).toBe(true)

    const { ticketId } = await client.createTicket(ticket)
    expect(ticketId).toBe('t-1')
    expect(client.createTicket).toHaveBeenCalledWith(ticket)
  })

  it('alert fixture → runAlertmanagerPipeline → ticket + suggestion', async () => {
    const client = makeClient()
    const result = await runAlertmanagerPipeline({
      body: FIXTURE_HARNESS_ERROR_FIRING,
      client,
    })

    expect(result.parseError).toBeUndefined()
    expect(result.webhookResult.created).toBe(1)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].alertName).toBe('ElectroOsHarnessErrorRateHigh')
    expect(result.suggestions[0].runbook).toContain('harness-error-rate-high')
  })

  it('duplicate alert is skipped on second pipeline run', async () => {
    const client = makeClient()
    const dedup = createAlertDedupStore({ ttlMs: 60_000 })

    const first = await runAlertmanagerPipeline({
      body: FIXTURE_DB_POOL_FIRING,
      client,
      dedup,
    })
    expect(first.webhookResult.created).toBe(1)
    expect(first.dedupSkipped).toBe(0)

    const second = await runAlertmanagerPipeline({
      body: FIXTURE_DB_POOL_FIRING,
      client,
      dedup,
    })
    expect(second.webhookResult.created).toBe(0)
    expect(second.dedupSkipped).toBe(1)
  })

  it('seed bootstrap ticket passes isDevOsTicket validation', () => {
    const ticket = buildSreBootstrapTicket()
    expect(isDevOsTicket(ticket)).toBe(true)
    expect(ticket.type).toBe('feature')
    expect(ticket.context.agentId).toBe('cto-agent')
  })

  it('all alertToDevOsTicket outputs pass isDevOsTicket', () => {
    const fixtures = [
      FIXTURE_HARNESS_ERROR_FIRING,
      FIXTURE_HEARTBEAT_STALE_FIRING,
      FIXTURE_LATENCY_P99_FIRING,
      FIXTURE_DB_POOL_FIRING,
    ]

    for (const fixture of fixtures) {
      const alert = fixture.alerts[0]
      const ticket = alertToDevOsTicket(alert)
      expect(isDevOsTicket(ticket)).toBe(true)
    }
  })
})
