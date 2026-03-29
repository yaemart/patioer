import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isOAuthStateFresh, signOAuthState, verifyOAuthState } from './oauth-state.js'

describe('oauth-state', () => {
  it('signs and verifies a state payload', () => {
    const state = signOAuthState(
      { tenantId: 'tenant-1', sellerId: 'seller-1', region: 'na' },
      'secret',
    )

    const payload = verifyOAuthState<{
      tenantId: string
      sellerId: string
      region: string
      nonce: string
      iat: number
    }>(state, 'secret')

    expect(payload).toMatchObject({
      tenantId: 'tenant-1',
      sellerId: 'seller-1',
      region: 'na',
    })
    expect(payload?.nonce).toMatch(/^[0-9a-f]{16}$/)
    expect(typeof payload?.iat).toBe('number')
  })

  it('rejects a tampered state', () => {
    const encoded = Buffer.from(
      JSON.stringify({ tenantId: 'tenant-1', nonce: '1234567890abcdef', iat: Date.now() }),
    ).toString('base64url')
    const hmac = createHmac('sha256', 'secret').update(encoded).digest('hex')
    const tamperedHmac = `${hmac[0] === '0' ? '1' : '0'}${hmac.slice(1)}`
    const state = `${encoded}.${tamperedHmac}`

    expect(verifyOAuthState(state, 'secret')).toBeNull()
  })

  it('checks state freshness by age window', () => {
    expect(isOAuthStateFresh({ iat: Date.now() - 5_000 }, 10_000)).toBe(true)
    expect(isOAuthStateFresh({ iat: Date.now() - 15_000 }, 10_000)).toBe(false)
  })
})
