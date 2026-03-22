import { Redis } from 'ioredis'

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (redisClient) return redisClient
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  redisClient = new Redis(url, { maxRetriesPerRequest: null })
  return redisClient
}

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) return
  const current = redisClient
  redisClient = null
  await current.quit()
}

export async function assertRedisConnection(): Promise<boolean> {
  const pong = await getRedisClient().ping()
  return pong === 'PONG'
}
