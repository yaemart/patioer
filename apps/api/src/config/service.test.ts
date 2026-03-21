import { describe, expect, it } from 'vitest'
import { SERVICE_IDENTIFIER } from './service.js'

describe('service identifier', () => {
  it('defaults to api when env var is not set', () => {
    expect(SERVICE_IDENTIFIER).toBe('api')
  })
})
