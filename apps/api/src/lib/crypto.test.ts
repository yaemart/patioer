import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encryptToken, decryptToken } from './crypto.js'

const validKey = randomBytes(32).toString('hex') // 64 hex chars

describe('encryptToken / decryptToken', () => {
  it('round-trips plaintext through encrypt then decrypt', () => {
    const plaintext = 'shpat_abc123-secret-token'
    const ciphertext = encryptToken(plaintext, validKey)
    expect(decryptToken(ciphertext, validKey)).toBe(plaintext)
  })

  it('produces different ciphertext for the same input (random IV)', () => {
    const plaintext = 'same-token'
    const a = encryptToken(plaintext, validKey)
    const b = encryptToken(plaintext, validKey)
    expect(a).not.toBe(b)
  })

  it('throws on wrong key during decrypt (auth tag mismatch)', () => {
    const ciphertext = encryptToken('secret', validKey)
    const wrongKey = randomBytes(32).toString('hex')
    expect(() => decryptToken(ciphertext, wrongKey)).toThrow()
  })

  it('throws on malformed ciphertext format', () => {
    expect(() => decryptToken('not-valid', validKey)).toThrow('Invalid ciphertext format')
    expect(() => decryptToken('a:b', validKey)).toThrow('Invalid ciphertext format')
  })

  it('throws when key is not 32 bytes', () => {
    expect(() => encryptToken('x', 'abcd')).toThrow('AES-256 key must be exactly 32 bytes')
    expect(() => decryptToken('aa:bb:cc', 'abcd')).toThrow('AES-256 key must be exactly 32 bytes')
  })

  it('handles empty plaintext', () => {
    const ciphertext = encryptToken('', validKey)
    expect(decryptToken(ciphertext, validKey)).toBe('')
  })

  it('handles unicode plaintext', () => {
    const plaintext = '你好世界🔐'
    const ciphertext = encryptToken(plaintext, validKey)
    expect(decryptToken(ciphertext, validKey)).toBe(plaintext)
  })
})
