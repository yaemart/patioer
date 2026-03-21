import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const EXPECTED_KEY_BYTES = 32

function parseKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex')
  if (key.length !== EXPECTED_KEY_BYTES) {
    throw new Error(
      `AES-256 key must be exactly ${EXPECTED_KEY_BYTES} bytes (${EXPECTED_KEY_BYTES * 2} hex chars), got ${key.length} bytes`,
    )
  }
  return key
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a colon-joined string: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
 * The key must be 32 bytes encoded as a 64-char hex string.
 */
export function encryptToken(plaintext: string, hexKey: string): string {
  const key = parseKey(hexKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Decrypts a value produced by `encryptToken`.
 * Throws if the ciphertext is malformed or the auth tag verification fails.
 */
export function decryptToken(ciphertext: string, hexKey: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid ciphertext format')
  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string]
  const key = parseKey(hexKey)
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
