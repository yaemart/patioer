import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'paperclip-auth').update(a).digest()
  const hb = createHmac('sha256', 'paperclip-auth').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function matchesAnyConfiguredKey(incoming: string): boolean {
  const paperclip = process.env.PAPERCLIP_API_KEY
  const tenantExecute = process.env.ELECTROOS_EXECUTE_API_KEY
  if (paperclip && constantTimeEqual(incoming, paperclip)) return true
  if (tenantExecute && constantTimeEqual(incoming, tenantExecute)) return true
  return false
}

/**
 * Validates `x-api-key` for `POST /api/v1/agents/:id/execute`.
 *
 * Accepts either:
 * - `PAPERCLIP_API_KEY` — Paperclip scheduler / heartbeat callbacks
 * - `ELECTROOS_EXECUTE_API_KEY` — tenant backends, automation, or MCP (same header; separate secret)
 */
export function verifyAgentExecuteAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply | null {
  const paperclip = process.env.PAPERCLIP_API_KEY
  const tenantExecute = process.env.ELECTROOS_EXECUTE_API_KEY
  if (!paperclip && !tenantExecute) {
    reply.code(503).send({ error: 'agent execute auth not configured (set PAPERCLIP_API_KEY and/or ELECTROOS_EXECUTE_API_KEY)' })
    return reply
  }

  const incoming = request.headers['x-api-key']
  if (typeof incoming !== 'string' || incoming.length === 0) {
    reply.code(401).send({ error: 'unauthorized' })
    return reply
  }

  if (!matchesAnyConfiguredKey(incoming)) {
    reply.code(401).send({ error: 'unauthorized' })
    return reply
  }

  return null
}

/** @deprecated Use verifyAgentExecuteAuth — name kept for call sites that still read "Paperclip". */
export const verifyPaperclipAuth = verifyAgentExecuteAuth
