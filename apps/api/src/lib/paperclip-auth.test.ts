import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAgentExecuteAuth, verifyPaperclipAuth } from './paperclip-auth.js'

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

describe('verifyAgentExecuteAuth', () => {
  const prevPaperclip = process.env.PAPERCLIP_API_KEY
  const prevExecute = process.env.ELECTROOS_EXECUTE_API_KEY

  beforeEach(() => {
    delete process.env.PAPERCLIP_API_KEY
    delete process.env.ELECTROOS_EXECUTE_API_KEY
  })

  afterEach(() => {
    if (prevPaperclip !== undefined) process.env.PAPERCLIP_API_KEY = prevPaperclip
    else delete process.env.PAPERCLIP_API_KEY
    if (prevExecute !== undefined) process.env.ELECTROOS_EXECUTE_API_KEY = prevExecute
    else delete process.env.ELECTROOS_EXECUTE_API_KEY
  })

  it('returns 503 when neither PAPERCLIP_API_KEY nor ELECTROOS_EXECUTE_API_KEY is set', async () => {
    const reply = createReplyMock()
    const authReply = await verifyAgentExecuteAuth(createRequestMock('k'), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(503)
  })

  it('returns 401 when x-api-key header is missing', async () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    const reply = createReplyMock()
    const authReply = await verifyAgentExecuteAuth(createRequestMock(), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(401)
  })

  it('returns 401 when x-api-key mismatches both keys', async () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    process.env.ELECTROOS_EXECUTE_API_KEY = 'k2'
    const reply = createReplyMock()
    const authReply = await verifyAgentExecuteAuth(createRequestMock('k3'), reply)
    expect(authReply).toBe(reply)
    expect(reply.code).toHaveBeenCalledWith(401)
  })

  it('returns null when x-api-key matches PAPERCLIP_API_KEY', async () => {
    process.env.PAPERCLIP_API_KEY = 'k1'
    const reply = createReplyMock()
    const authReply = await verifyAgentExecuteAuth(createRequestMock('k1'), reply)
    expect(authReply).toBeNull()
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('returns null when x-api-key matches ELECTROOS_EXECUTE_API_KEY (without Paperclip key)', async () => {
    process.env.ELECTROOS_EXECUTE_API_KEY = 'tenant-run-key'
    const reply = createReplyMock()
    const authReply = await verifyAgentExecuteAuth(createRequestMock('tenant-run-key'), reply)
    expect(authReply).toBeNull()
    expect(reply.code).not.toHaveBeenCalled()
  })
})

describe('verifyPaperclipAuth alias', () => {
  it('is the same function as verifyAgentExecuteAuth', () => {
    expect(verifyPaperclipAuth).toBe(verifyAgentExecuteAuth)
  })
})
