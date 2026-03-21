import { describe, expect, it } from 'vitest'
import { SERVICE_IDENTIFIER } from './service.js'

describe('service identifier', () => {
  it('resolves api package name by default', () => {
    expect(SERVICE_IDENTIFIER).toBe('@patioer/api')
  })
})
