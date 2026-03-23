import { describe, expect, it } from 'vitest'
import { HarnessError, toHarnessErrorWire } from './harness-error.js'

describe('toHarnessErrorWire', () => {
  it('returns wire for HarnessError', () => {
    const err = new HarnessError('shopify', '429', 'rate limited')
    expect(toHarnessErrorWire(err)).toEqual({
      platform: 'shopify',
      code: '429',
      message: 'rate limited',
    })
  })

  it('returns null for non-HarnessError', () => {
    expect(toHarnessErrorWire(new Error('x'))).toBeNull()
    expect(toHarnessErrorWire(null)).toBeNull()
    expect(toHarnessErrorWire({ platform: 'x' })).toBeNull()
  })
})
