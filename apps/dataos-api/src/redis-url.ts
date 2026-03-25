export interface RedisConnection {
  host: string
  port: number
  password?: string
  db?: number
}

export function parseRedisConnection(urlStr: string): RedisConnection {
  const u = new URL(urlStr)
  const dbPath = u.pathname?.replace('/', '')
  const db = dbPath && dbPath !== '' ? Number.parseInt(dbPath, 10) : undefined
  return {
    host: u.hostname,
    port: u.port ? Number.parseInt(u.port, 10) : 6379,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isFinite(db) ? db : undefined,
  }
}
