export interface AlertDedupStore {
  has(fingerprint: string): boolean
  add(fingerprint: string): void
  readonly size: number
}

interface Entry {
  fingerprint: string
  expiresAt: number
}

const DEFAULT_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_SIZE = 2048

/** 内存 TTL 去重（进程重启清空；适合单实例 + Paperclip 短窗口）。 */
export function createAlertDedupStore(params?: {
  ttlMs?: number
  maxSize?: number
}): AlertDedupStore {
  const ttl = params?.ttlMs ?? DEFAULT_TTL_MS
  const maxSize = params?.maxSize ?? DEFAULT_MAX_SIZE
  const entries = new Map<string, Entry>()

  function evictExpired() {
    const now = Date.now()
    for (const [k, e] of entries) {
      if (e.expiresAt <= now) entries.delete(k)
    }
  }

  return {
    has(fingerprint: string): boolean {
      evictExpired()
      return entries.has(fingerprint)
    },

    add(fingerprint: string): void {
      evictExpired()
      if (entries.size >= maxSize) {
        const oldest = entries.keys().next().value as string
        entries.delete(oldest)
      }
      entries.set(fingerprint, { fingerprint, expiresAt: Date.now() + ttl })
    },

    get size() {
      evictExpired()
      return entries.size
    },
  }
}
