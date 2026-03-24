import { describe, expect, it, vi } from 'vitest'
import { parseAlertmanagerPayload } from './alertmanager-webhook-payload.js'
import { runAlertmanagerPipeline } from './alertmanager-pipeline.js'
import type { DevOsClient } from './devos-client.js'
import {
  FIXTURE_DB_POOL_FIRING,
  FIXTURE_HARNESS_ERROR_FIRING,
  FIXTURE_HEARTBEAT_STALE_FIRING,
  FIXTURE_LATENCY_P99_FIRING,
  FIXTURE_RESOLVED,
} from './alertmanager-e2e-fixtures.js'

const ALL_FIRING = [
  FIXTURE_HARNESS_ERROR_FIRING,
  FIXTURE_HEARTBEAT_STALE_FIRING,
  FIXTURE_LATENCY_P99_FIRING,
  FIXTURE_DB_POOL_FIRING,
]

function makeClient() {
  let n = 0
  return {
    createTicket: vi.fn().mockImplementation(async () => ({ ticketId: `t-${++n}` })),
  } as unknown as DevOsClient
}

describe('alertmanager-e2e-fixtures', () => {
  it('all firing fixtures pass parseAlertmanagerPayload', () => {
    for (const fixture of ALL_FIRING) {
      const parsed = parseAlertmanagerPayload(fixture)
      expect(parsed).not.toBeNull()
      expect(parsed!.alerts[0].status).toBe('firing')
    }
  })

  it('resolved fixture has status resolved', () => {
    const parsed = parseAlertmanagerPayload(FIXTURE_RESOLVED)
    expect(parsed).not.toBeNull()
    expect(parsed!.status).toBe('resolved')
    expect(parsed!.alerts[0].status).toBe('resolved')
  })

  it('pipeline processes all four firing fixtures end-to-end', async () => {
    for (const fixture of ALL_FIRING) {
      const client = makeClient()
      const result = await runAlertmanagerPipeline({ body: fixture, client })

      expect(result.parseError).toBeUndefined()
      expect(result.webhookResult.created).toBe(1)
      expect(result.webhookResult.ticketIds).toHaveLength(1)
      expect(result.suggestions).toHaveLength(1)
      expect(result.suggestions[0].runbook).toBeTruthy()
    }
  })
})
