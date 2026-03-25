import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { FastifyRequest } from 'fastify'
import { schema } from '@patioer/db'
import { createDevOsTicketFromHarnessError } from './harness-error-devos-ticket.js'

type InsertedState = {
  tickets: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
}

function makeRequest(state: InsertedState): FastifyRequest {
  const req = {
    log: {
      warn: () => undefined,
    },
    withDb: async (callback: (db: { insert: (table: unknown) => { values: (v: unknown) => Promise<void> } }) => Promise<void>) =>
      callback({
        insert: (table: unknown) => ({
          values: async (v: unknown) => {
            if (table === schema.devosTickets) {
              state.tickets.push(v as Record<string, unknown>)
            } else if (table === schema.agentEvents) {
              state.events.push(v as Record<string, unknown>)
            }
          },
        }),
      }),
  } as unknown as FastifyRequest
  return req
}

const envBackup = {
  DEVOS_BASE_URL: process.env.DEVOS_BASE_URL,
  DEVOS_API_KEY: process.env.DEVOS_API_KEY,
}

afterEach(() => {
  process.env.DEVOS_BASE_URL = envBackup.DEVOS_BASE_URL
  process.env.DEVOS_API_KEY = envBackup.DEVOS_API_KEY
})

describe('createDevOsTicketFromHarnessError', () => {
  it('writes local devos_tickets row even when bridge is not configured', async () => {
    delete process.env.DEVOS_BASE_URL
    delete process.env.DEVOS_API_KEY

    const state: InsertedState = { tickets: [], events: [] }
    const request = makeRequest(state)

    const res = await createDevOsTicketFromHarnessError(request, {
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      agentId: '123e4567-e89b-12d3-a456-426614174001',
      platform: 'amazon',
      code: '429',
      message: 'rate limited',
    })

    expect(res.devosTicketId).toBeUndefined()
    expect(state.tickets).toHaveLength(1)
    expect(state.events).toHaveLength(1)
    expect(state.tickets[0]).toMatchObject({
      type: 'harness_update',
      priority: 'P1',
      status: 'open',
      devosTicketId: undefined,
    })
  })

  it('creates remote DevOS ticket and persists returned ticketId', async () => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/v1/devos/tickets') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ticketId: 'devos-123' }))
        return
      }
      res.statusCode = 404
      res.end('not found')
    })

    await new Promise<void>((resolve) => server.listen(3901, resolve))
    process.env.DEVOS_BASE_URL = 'http://127.0.0.1:3901'
    delete process.env.DEVOS_API_KEY

    try {
      const state: InsertedState = { tickets: [], events: [] }
      const request = makeRequest(state)
      const res = await createDevOsTicketFromHarnessError(request, {
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        agentId: '123e4567-e89b-12d3-a456-426614174001',
        platform: 'shopify',
        code: '401',
        message: 'token expired',
      })

      expect(res.devosTicketId).toBe('devos-123')
      expect(state.tickets[0]).toMatchObject({ devosTicketId: 'devos-123', status: 'open' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })
})
