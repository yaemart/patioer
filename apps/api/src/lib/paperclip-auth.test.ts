import { describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyPaperclipAuth } from './paperclip-auth.js'

function createReplyMock(): FastifyReply {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  } as unknown as FastifyReply
  ;(reply.code as unknown as ReturnType<typeof vi.fn>).mockReturnValue(reply)
  return reply
}

function createRequestMock(apiKey?: string): FastifyRequest {
  return {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  } as unknown as FastifyRequest
}

describe('verifyPaperclipAuth', () => {
  it('returns false when PAPERCLIP_API_KEY is missing', () => {
    const previous = process.env.PAPERCLIP_API_KEY
    delete process.env.PAPERCLIP_API_KEY
    const reply = createReplyMock()
    const authReply = verifyPaperclipAuth(createRequestMock('k'), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(503)
    process.env.PAPERCLIP_API_KEY = previous
  })

  it('returns false when x-api-key header is missing', () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    const reply = createReplyMock()
    const authReply = verifyPaperclipAuth(createRequestMock(), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(401)
  })

  it('returns false when x-api-key mismatches', () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    const reply = createReplyMock()
    const authReply = verifyPaperclipAuth(createRequestMock('k2'), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(401)
  })

  it('returns null when x-api-key matches exactly', () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    const reply = createReplyMock()
    const authReply = verifyPaperclipAuth(createRequestMock('k1'), reply)
    expect(authReply).toBeNull()
    expect(reply.code).not.toHaveBeenCalled()
  })
})
