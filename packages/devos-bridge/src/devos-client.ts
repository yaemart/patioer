/**
 * DevOS HTTP 客户端（Paperclip 侧约定路由前缀 `/api/v1/devos/tickets`）。
 * 真实 DevOS 实现可逐步对齐；此处为 ElectroOS 可调用的稳定契约。
 */
import type { DevOsTicket, TicketStatus } from './ticket-protocol.js'

const TICKET_PATH = '/api/v1/devos/tickets'

const TICKET_STATUSES = new Set<TicketStatus>([
  'open',
  'acknowledged',
  'in_progress',
  'resolved',
  'closed',
])

export class DevOsHttpError extends Error {
  readonly status: number
  readonly responseBody: string

  constructor(status: number, responseBody: string) {
    super(`DevOS HTTP ${status}: ${responseBody.slice(0, 500)}`)
    this.name = 'DevOsHttpError'
    this.status = status
    this.responseBody = responseBody
  }
}

export interface DevOsClient {
  createTicket(ticket: DevOsTicket): Promise<{ ticketId: string }>
  getTicketStatus(ticketId: string): Promise<TicketStatus>
  acknowledgeTicket(ticketId: string): Promise<void>
  resolveTicket(ticketId: string): Promise<void>
}

export interface DevOsClientOptions {
  baseUrl: string
  apiKey?: string
  /** 测试注入；默认 `globalThis.fetch`。 */
  fetch?: typeof fetch
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function parseTicketStatusJson(data: unknown): TicketStatus {
  if (typeof data === 'string' && TICKET_STATUSES.has(data as TicketStatus)) {
    return data as TicketStatus
  }
  if (data !== null && typeof data === 'object' && 'status' in data) {
    const s = (data as { status: unknown }).status
    if (typeof s === 'string' && TICKET_STATUSES.has(s as TicketStatus)) return s as TicketStatus
  }
  throw new Error('invalid_ticket_status_response')
}

export function createDevOsClient(options: DevOsClientOptions): DevOsClient {
  const base = normalizeBaseUrl(options.baseUrl)
  const fetchFn = options.fetch ?? globalThis.fetch

  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: 'application/json',
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    if (options.apiKey) {
      headers['x-api-key'] = options.apiKey
    }
    return await fetchFn(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  return {
    async createTicket(ticket: DevOsTicket) {
      const res = await request('POST', TICKET_PATH, { ticket })
      const text = await readErrorBody(res)
      if (!res.ok) throw new DevOsHttpError(res.status, text)
      let data: unknown
      try {
        data = JSON.parse(text) as unknown
      } catch {
        throw new DevOsHttpError(res.status, 'invalid_json')
      }
      const ticketId =
        data !== null &&
        typeof data === 'object' &&
        'ticketId' in data &&
        typeof (data as { ticketId: unknown }).ticketId === 'string'
          ? (data as { ticketId: string }).ticketId
          : null
      if (!ticketId) throw new DevOsHttpError(res.status, 'missing_ticket_id')
      return { ticketId }
    },

    async getTicketStatus(ticketId: string) {
      const encoded = encodeURIComponent(ticketId)
      const res = await request('GET', `${TICKET_PATH}/${encoded}/status`)
      const text = await readErrorBody(res)
      if (!res.ok) throw new DevOsHttpError(res.status, text)
      let data: unknown
      try {
        data = JSON.parse(text) as unknown
      } catch {
        throw new DevOsHttpError(res.status, 'invalid_json')
      }
      return parseTicketStatusJson(data)
    },

    async acknowledgeTicket(ticketId: string) {
      const encoded = encodeURIComponent(ticketId)
      const res = await request('POST', `${TICKET_PATH}/${encoded}/acknowledge`)
      const text = await readErrorBody(res)
      if (!res.ok) throw new DevOsHttpError(res.status, text)
    },

    async resolveTicket(ticketId: string) {
      const encoded = encodeURIComponent(ticketId)
      const res = await request('POST', `${TICKET_PATH}/${encoded}/resolve`)
      const text = await readErrorBody(res)
      if (!res.ok) throw new DevOsHttpError(res.status, text)
    },
  }
}
