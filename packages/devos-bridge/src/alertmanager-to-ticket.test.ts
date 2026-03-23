import { describe, expect, it, vi } from 'vitest'
import type { AlertmanagerAlert, AlertmanagerWebhookPayload } from './alertmanager-webhook-payload.js'
import { alertToDevOsTicket, handleAlertmanagerWebhook } from './alertmanager-to-ticket.js'
import { isDevOsTicket } from './ticket-protocol.js'
import type { DevOsClient } from './devos-client.js'

function makeAlert(overrides: Partial<AlertmanagerAlert> = {}): AlertmanagerAlert {
  return {
    status: 'firing',
    labels: { alertname: 'ElectroOsHarnessErrorRateHigh', severity: 'critical' },
    annotations: { summary: 'High error rate', description: 'Harness errors > 5%' },
    startsAt: '2026-03-23T10:00:00Z',
    endsAt: '0001-01-01T00:00:00Z',
    fingerprint: 'fp-1',
    ...overrides,
  }
}

describe('alertToDevOsTicket', () => {
  it('alertToDevOsTicket builds valid ticket from firing alert', () => {
    const ticket = alertToDevOsTicket(makeAlert())
    expect(isDevOsTicket(ticket)).toBe(true)
    expect(ticket.title).toContain('ElectroOsHarnessErrorRateHigh')
    expect(ticket.description).toBe('Harness errors > 5%')
  })

  it('alertToDevOsTicket uses P0 for HarnessErrorRateHigh', () => {
    const ticket = alertToDevOsTicket(makeAlert())
    expect(ticket.priority).toBe('P0')
    expect(ticket.type).toBe('harness_update')
  })

  it('alertToDevOsTicket falls back to P1 for unknown alert', () => {
    const ticket = alertToDevOsTicket(
      makeAlert({ labels: { alertname: 'SomeUnknownAlert', severity: 'warning' } }),
    )
    expect(ticket.priority).toBe('P1')
    expect(ticket.type).toBe('performance')
  })
})

describe('handleAlertmanagerWebhook', () => {
  it('handleAlertmanagerWebhook creates tickets for firing alerts', async () => {
    const createTicket = vi.fn().mockResolvedValue({ ticketId: 't-1' })
    const client = { createTicket } as unknown as DevOsClient
    const payload: AlertmanagerWebhookPayload = {
      version: '4',
      status: 'firing',
      alerts: [makeAlert(), makeAlert({ fingerprint: 'fp-2' })],
    }

    const result = await handleAlertmanagerWebhook({ payload, client })
    expect(result.created).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.ticketIds).toEqual(['t-1', 't-1'])
    expect(createTicket).toHaveBeenCalledTimes(2)
  })

  it('handleAlertmanagerWebhook skips resolved alerts', async () => {
    const createTicket = vi.fn().mockResolvedValue({ ticketId: 't-1' })
    const client = { createTicket } as unknown as DevOsClient
    const payload: AlertmanagerWebhookPayload = {
      version: '4',
      status: 'resolved',
      alerts: [makeAlert({ status: 'resolved' })],
    }

    const result = await handleAlertmanagerWebhook({ payload, client })
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(1)
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('handleAlertmanagerWebhook records errors from createTicket failures', async () => {
    const createTicket = vi.fn().mockRejectedValue(new Error('DevOS down'))
    const client = { createTicket } as unknown as DevOsClient
    const payload: AlertmanagerWebhookPayload = {
      version: '4',
      status: 'firing',
      alerts: [makeAlert()],
    }

    const result = await handleAlertmanagerWebhook({ payload, client })
    expect(result.created).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ fingerprint: 'fp-1', error: 'DevOS down' })
  })
})
