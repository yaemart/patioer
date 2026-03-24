import { describe, expect, it, vi } from 'vitest'
import { createDevOsClient, DevOsHttpError } from './devos-client.js'
import type { DevOsTicket } from './ticket-protocol.js'

const sampleTicket: DevOsTicket = {
  type: 'harness_update',
  priority: 'P1',
  title: 't',
  description: 'd',
  context: {},
  sla: { acknowledge: '4h', resolve: '24h' },
}

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createDevOsClient', () => {
  it('createTicket POSTs /api/v1/devos/tickets with ticket body', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ticketId: 'tid-1' }))
    const client = createDevOsClient({
      baseUrl: 'http://localhost:3200',
      apiKey: 'k',
      fetch,
    })
    const out = await client.createTicket(sampleTicket)
    expect(out).toEqual({ ticketId: 'tid-1' })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3200/api/v1/devos/tickets')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-api-key': 'k',
    })
    expect(JSON.parse(init.body as string)).toEqual({ ticket: sampleTicket })
  })

  it('getTicketStatus GETs .../tickets/:id/status', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ status: 'open' }))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    const st = await client.getTicketStatus('abc-1')
    expect(st).toBe('open')
    expect(fetch).toHaveBeenCalledWith(
      'http://x/api/v1/devos/tickets/abc-1/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getTicketStatus accepts bare string JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse('acknowledged'))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    const st = await client.getTicketStatus('t')
    expect(st).toBe('acknowledged')
  })

  it('acknowledgeTicket POSTs .../acknowledge', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    await client.acknowledgeTicket('tid')
    expect(fetch).toHaveBeenCalledWith(
      'http://x/api/v1/devos/tickets/tid/acknowledge',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('resolveTicket POSTs .../resolve', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    await client.resolveTicket('tid')
    expect(fetch).toHaveBeenCalledWith(
      'http://x/api/v1/devos/tickets/tid/resolve',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws DevOsHttpError on non-OK', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 502 }))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    await expect(client.createTicket(sampleTicket)).rejects.toMatchObject({
      name: 'DevOsHttpError',
      status: 502,
    })
  })

  it('throws when create response missing ticketId', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}))
    const client = createDevOsClient({ baseUrl: 'http://x/', fetch })
    await expect(client.createTicket(sampleTicket)).rejects.toBeInstanceOf(DevOsHttpError)
  })
})
