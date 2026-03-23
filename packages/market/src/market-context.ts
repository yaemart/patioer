import type { Market, ProductComplianceInfo, TaxCalculationResult, ComplianceResult, CertificationBody } from './types.js'
import { convertPrice, type RedisLike } from './currency.js'
import { calculateTax } from './tax.js'
import { checkCompliance, isProhibited, getRequiredCertifications } from './compliance.js'

/**
 * The single entry-point that Agents use to access all market capabilities.
 * Agents should import from `@patioer/market` and call `createMarketContext()`
 * rather than importing individual sub-modules directly.
 */
export interface MarketContext {
  /** Convert amount between currencies (Redis-cached, TTL 1 h). */
  convertPrice(amount: number, from: string, to: string): Promise<number>
  /** Calculate tax breakdown for amount in the given market. */
  calculateTax(amount: number, market: Market): TaxCalculationResult
  /** Full compliance check: prohibited-category gate + certification requirements. */
  checkCompliance(info: ProductComplianceInfo): ComplianceResult
  /** Quick prohibited-category test without a full compliance run. */
  isProhibited(category: string, market: Market): boolean
  /** Return certification bodies required for a category in a market. */
  getRequiredCertifications(category: string, market: Market): CertificationBody[]
}

export interface MarketContextOptions {
  /**
   * Shared Redis client for exchange-rate caching.
   * When omitted, `convertPrice` still works but hits the API on every call.
   *
   * Each MarketContext captures its own Redis reference via closure, so multiple
   * contexts with different clients coexist safely without shared global state.
   */
  redis?: RedisLike
}

/**
 * Create a MarketContext bound to an optional Redis client.
 * Call once at app startup and share the instance across Agents.
 *
 * Multiple contexts can be created with different Redis clients — each one
 * isolates its caching state through closure, avoiding the previous global
 * singleton pattern that caused cross-context interference.
 *
 * @example
 * const ctx = createMarketContext({ redis: getRedisClient() })
 * const usd = await ctx.convertPrice(100, 'SGD', 'USD')
 */
export function createMarketContext(opts: MarketContextOptions = {}): MarketContext {
  const redis = opts.redis ?? null

  return {
    convertPrice(amount: number, from: string, to: string): Promise<number> {
      // Pass redis explicitly so this context never touches the module-level singleton
      return convertPrice(amount, from, to, redis)
    },
    calculateTax,
    checkCompliance,
    isProhibited,
    getRequiredCertifications,
  }
}
