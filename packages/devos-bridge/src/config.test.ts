import { describe, expect, it } from 'vitest'
import { isDevOsBridgeConfigured, loadDevOsBridgeEnv } from './config.js'

describe('loadDevOsBridgeEnv', () => {
  it('reads DEVOS_BASE_URL and DEVOS_API_KEY', () => {
    const env = loadDevOsBridgeEnv({
      DEVOS_BASE_URL: 'http://localhost:3200',
      DEVOS_API_KEY: 'secret',
    })
    expect(env.baseUrl).toBe('http://localhost:3200')
    expect(env.apiKey).toBe('secret')
  })

  it('returns empty baseUrl when DEVOS_BASE_URL unset', () => {
    const env = loadDevOsBridgeEnv({})
    expect(env.baseUrl).toBe('')
    expect(env.apiKey).toBeUndefined()
  })

  it('trims DEVOS_BASE_URL whitespace', () => {
    const env = loadDevOsBridgeEnv({
      DEVOS_BASE_URL: '  https://devos.example.com/  ',
    })
    expect(env.baseUrl).toBe('https://devos.example.com/')
  })
})

describe('isDevOsBridgeConfigured', () => {
  it('returns false for empty baseUrl', () => {
    expect(isDevOsBridgeConfigured({ baseUrl: '' })).toBe(false)
  })

  it('returns true for http:// and https://', () => {
    expect(isDevOsBridgeConfigured({ baseUrl: 'http://localhost:3200' })).toBe(true)
    expect(isDevOsBridgeConfigured({ baseUrl: 'https://devos.example.com' })).toBe(true)
  })

  it('returns false for non-http URL', () => {
    expect(isDevOsBridgeConfigured({ baseUrl: 'ftp://localhost:3200' })).toBe(false)
    expect(isDevOsBridgeConfigured({ baseUrl: 'not-a-url' })).toBe(false)
  })
})
