import type { ExchangeRate } from './types.js'

// Guard: parse TTL and reject NaN / non-positive values.
const _rawTtl = parseInt(process.env.EXCHANGE_RATE_CACHE_TTL_SECONDS ?? '3600', 10)
const CACHE_TTL = Number.isFinite(_rawTtl) && _rawTtl > 0 ? _rawTtl : 3600
const API_BASE = process.env.EXCHANGE_RATE_API_URL ?? 'https://api.frankfurter.app'

// ISO 4217: exactly 3 uppercase letters.
const ISO4217_RE = /^[A-Z]{3}$/

/**
 * Minimal Redis interface — injected so tests can pass a mock without importing ioredis.
 * Exported so market-context.ts (and tests) can share the same type without duplication.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>
}

let _redis: RedisLike | null = null

/**
 * Inject a Redis client for exchange-rate caching.
 * Call once at app startup (e.g. from createMarketContext).
 * Safe to call multiple times; later call wins.
 */
export function setCurrencyRedis(redis: RedisLike): void {
  _redis = redis
}

/** @internal — exposed only for tests that need to reset state */
export function _resetCurrencyRedis(): void {
  _redis = null
}

function cacheKey(from: string, to: string): string {
  return `market:fx:${from}:${to}`
}

/**
 * Fetch the exchange rate between two currencies.
 * Results are cached in Redis for CACHE_TTL seconds (default 1 h).
 *
 * Both `from` and `to` must be valid ISO 4217 currency codes (3 uppercase letters).
 * This prevents URL/Redis-key injection attacks.
 */
export async function getExchangeRate(from: string, to: string): Promise<ExchangeRate> {
  if (!ISO4217_RE.test(from) || !ISO4217_RE.test(to)) {
    throw new Error(`Invalid currency code: "${from}"/"${to}" — must be ISO 4217 (3 uppercase letters)`)
  }

  // 1. Redis cache hit — wrap in try/catch so a Redis outage never blocks callers
  if (_redis) {
    try {
      const cached = await _redis.get(cacheKey(from, to))
      if (cached) {
        const parsed = JSON.parse(cached) as { from: string; to: string; rate: number; fetchedAt: string }
        // Re-hydrate Date field that JSON.stringify serialises to string
        return { ...parsed, fetchedAt: new Date(parsed.fetchedAt) }
      }
    } catch {
      // Redis unavailable — fall through to live API fetch
    }
  }

  // 2. Cache miss → fetch from API
  const url = new URL(`${API_BASE}/latest`)
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)
  const resp = await fetch(url.toString())
  if (!resp.ok) throw new Error(`Exchange rate fetch failed: ${resp.status} (${from}→${to})`)

  const data = (await resp.json()) as { rates: Record<string, number>; date: string }
  const rate = data.rates[to]
  if (rate === undefined) throw new Error(`No rate found for ${from}→${to}`)

  const result: ExchangeRate = { from, to, rate, fetchedAt: new Date() }

  // 3. Persist to cache — best-effort, never throw
  if (_redis) {
    try {
      await _redis.set(cacheKey(from, to), JSON.stringify(result), 'EX', CACHE_TTL)
    } catch {
      // Redis write failure is non-fatal
    }
  }

  return result
}

/**
 * Convert `amount` from one currency to another.
 * Precision is rounded to 6 decimal places to avoid floating-point drift.
 * Returns the original amount unchanged when `from === to`.
 *
 * Accepts an optional Redis client to override the module-level singleton —
 * use this when multiple MarketContext instances need independent caching.
 */
export async function convertPrice(
  amount: number,
  from: string,
  to: string,
  redis?: RedisLike | null,
): Promise<number> {
  if (from === to) return amount
  // Temporarily swap the module singleton if a context-local redis is supplied
  const prev = _redis
  if (redis !== undefined) _redis = redis
  try {
    const { rate } = await getExchangeRate(from, to)
    return Math.round(amount * rate * 1_000_000) / 1_000_000
  } finally {
    if (redis !== undefined) _redis = prev
  }
}
