import type { FastifyRequest } from 'fastify'
import {
  buildHarnessUpdateTicket,
  createDevOsClient,
  isDevOsBridgeConfigured,
  loadDevOsBridgeEnv,
} from '@patioer/devos-bridge'
import { schema } from '@patioer/db'

export interface HarnessErrorTicketInput {
  tenantId: string
  agentId: string
  platform: string
  code: string
  message: string
}

/**
 * Best-effort bridge for AC-P2-12:
 * - Try creating a DevOS ticket over HTTP when DEVOS_BASE_URL is configured.
 * - Always persist a local devos_tickets row for audit/replay.
 */
export async function createDevOsTicketFromHarnessError(
  request: FastifyRequest,
  input: HarnessErrorTicketInput,
): Promise<{ devosTicketId?: string; bridgeError?: string }> {
  try {
    const ticket = buildHarnessUpdateTicket(input)

    const env = loadDevOsBridgeEnv(process.env)
    let devosTicketId: string | undefined
    let bridgeError: string | undefined

    if (isDevOsBridgeConfigured(env)) {
      try {
        const client = createDevOsClient({ baseUrl: env.baseUrl, apiKey: env.apiKey })
        const res = await client.createTicket(ticket)
        devosTicketId = res.ticketId
      } catch (err) {
        bridgeError = err instanceof Error ? err.message : String(err)
        request.log.warn(
          {
            tenantId: input.tenantId,
            agentId: input.agentId,
            platform: input.platform,
            code: input.code,
            err: bridgeError,
          },
          'devos bridge createTicket failed; local devos_tickets row will still be written',
        )
      }
    }

    if (request.withDb) {
      await request.withDb(async (db) => {
        await db.insert(schema.devosTickets).values({
          tenantId: input.tenantId,
          type: ticket.type,
          priority: ticket.priority,
          title: ticket.title,
          description: ticket.description,
          context: {
            ...ticket.context,
            source: 'agent.execute.harness_error',
            bridgeError,
          },
          status: 'open',
          devosTicketId,
        })

        await db.insert(schema.agentEvents).values({
          tenantId: input.tenantId,
          agentId: input.agentId,
          action: 'devos.ticket.create',
          payload: {
            type: ticket.type,
            priority: ticket.priority,
            title: ticket.title,
            devosTicketId: devosTicketId ?? null,
            bridgeError: bridgeError ?? null,
          } as Record<string, unknown>,
        })
      })
    }

    return { devosTicketId, bridgeError }
  } catch (err) {
    const bridgeError = err instanceof Error ? err.message : String(err)
    request.log.warn(
      { tenantId: input.tenantId, agentId: input.agentId, platform: input.platform, code: input.code, err: bridgeError },
      'createDevOsTicketFromHarnessError failed',
    )
    return { bridgeError }
  }
}
