import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'

function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'paperclip-auth').update(a).digest()
  const hb = createHmac('sha256', 'paperclip-auth').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function verifyPaperclipAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply | null {
  const apiKey = process.env.PAPERCLIP_API_KEY
  if (!apiKey) {
    reply.code(503).send({ error: 'paperclip auth not configured' })
    return reply
  }

  const incoming = request.headers['x-api-key']
  if (typeof incoming !== 'string' || incoming.length === 0) {
    reply.code(401).send({ error: 'unauthorized' })
    return reply
  }

  if (!constantTimeEqual(incoming, apiKey)) {
    reply.code(401).send({ error: 'unauthorized' })
    return reply
  }

  return null
}
