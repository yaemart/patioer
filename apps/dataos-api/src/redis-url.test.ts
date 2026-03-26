import { describe, expect, it } from 'vitest'
import { parseRedisConnection } from './redis-url.js'

describe('parseRedisConnection', () => {
  it('parses simple redis URL', () => {
    const conn = parseRedisConnection('redis://localhost:6380')
    expect(conn.host).toBe('localhost')
    expect(conn.port).toBe(6380)
    expect(conn.password).toBeUndefined()
    expect(conn.db).toBeUndefined()
  })

  it('parses URL with password and db', () => {
    const conn = parseRedisConnection('redis://:s3cret@redis.local:6379/2')
    expect(conn.host).toBe('redis.local')
    expect(conn.port).toBe(6379)
    expect(conn.password).toBe('s3cret')
    expect(conn.db).toBe(2)
  })

  it('defaults port to 6379 when omitted', () => {
    const conn = parseRedisConnection('redis://myhost')
    expect(conn.port).toBe(6379)
  })

  it('handles URL-encoded password', () => {
    const conn = parseRedisConnection('redis://:p%40ss%23word@host:6379')
    expect(conn.password).toBe('p@ss#word')
  })
})
