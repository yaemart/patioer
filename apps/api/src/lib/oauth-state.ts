import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface SignedOAuthState {
  tenantId: string
  nonce: string
  iat: number
}

export function signOAuthState<T extends { tenantId: string } & Record<string, unknown>>(
  payload: T,
  secret: string,
): string {
  const signedPayload: SignedOAuthState = {
    ...payload,
    tenantId: String(payload.tenantId ?? ''),
    nonce: randomBytes(8).toString('hex'),
    iat: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(signedPayload)).toString('base64url')
  const hmac = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${hmac}`
}

export function verifyOAuthState<T extends SignedOAuthState>(
  state: string,
  secret: string,
): T | null {
  const dot = state.lastIndexOf('.')
  if (dot === -1) return null

  const payload = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const signatureBuf = Buffer.from(signature, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')

  if (
    signatureBuf.length !== expectedBuf.length
    || !timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function isOAuthStateFresh(
  payload: { iat: number },
  maxAgeMs: number,
): boolean {
  return Date.now() - payload.iat <= maxAgeMs
}
