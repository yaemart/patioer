/**
 * Wayfair B2B Adapter — Partner-specific configuration for the B2B Harness.
 *
 * Wayfair uses standard EDI 850 (X12) for purchase orders. The existing
 * `parseEDI850()` in `b2b.harness.ts` handles Wayfair POs without modification.
 *
 * This module provides:
 *  1. Wayfair-specific default configuration (currency, MOQ, tier discounts)
 *  2. A factory to create a B2BHarness pre-configured for Wayfair
 *  3. Wayfair-specific tiered pricing (different discount tiers from generic B2B)
 *
 * The Wayfair B2B instance reuses the same `B2BHarness` class — no new
 * harness class is created (per plan D10: no wayfair.harness.ts).
 */

import type { B2BHarnessConfig, B2BPriceSchedule, TieredPrice } from './b2b.types.js'
import { B2BHarness, type B2BBackendAdapter } from './b2b.harness.js'

// ─── Wayfair Partner Configuration ──────────────────────────────────────────

export interface WayfairPartnerConfig {
  apiBaseUrl: string
  apiKey: string
  tenantId: string
  ediEndpoint?: string
  supplierId: string
  currency?: string
  moqDefault?: number
}

/**
 * Wayfair uses different discount tiers from the generic B2B defaults:
 * - Tier 1 (1–49): base price
 * - Tier 2 (50–199): 5% discount (Wayfair standard wholesale)
 * - Tier 3 (200+): 12% discount (Wayfair volume commitment)
 */
export function buildWayfairTiers(basePrice: number): [TieredPrice, TieredPrice, TieredPrice] {
  return [
    { minQty: 1, maxQty: 49, unitPrice: basePrice },
    { minQty: 50, maxQty: 199, unitPrice: +(basePrice * 0.95).toFixed(2) },
    { minQty: 200, maxQty: null, unitPrice: +(basePrice * 0.88).toFixed(2) },
  ]
}

/**
 * Build a Wayfair-specific B2BPriceSchedule using Wayfair tier breaks.
 */
export function buildWayfairPriceSchedule(
  productId: string,
  basePrice: number,
  currency = 'USD',
): B2BPriceSchedule {
  return {
    productId,
    basePricePerUnit: basePrice,
    tiers: buildWayfairTiers(basePrice),
    currency,
  }
}

// ─── Wayfair B2B Harness Factory ────────────────────────────────────────────

/**
 * Convert a WayfairPartnerConfig into a standard B2BHarnessConfig.
 * Wayfair supplier ID is passed as metadata for tracing but does not
 * change the adapter interface.
 */
export function toB2BConfig(wayfair: WayfairPartnerConfig): B2BHarnessConfig {
  return {
    credentials: {
      apiBaseUrl: wayfair.apiBaseUrl,
      apiKey: wayfair.apiKey,
      tenantId: wayfair.tenantId,
      ediEndpoint: wayfair.ediEndpoint,
    },
    defaultCurrency: wayfair.currency ?? 'USD',
    moqDefault: wayfair.moqDefault ?? 1,
  }
}

/**
 * Create a B2BHarness pre-configured for Wayfair.
 * Accepts an optional custom backend adapter for testing.
 */
export function createWayfairB2BHarness(
  config: WayfairPartnerConfig,
  backend?: B2BBackendAdapter,
): B2BHarness {
  return new B2BHarness(toB2BConfig(config), backend)
}

/**
 * Wayfair-specific partner identifiers used in EDI 850 buyer fields.
 * Used to detect whether an incoming EDI PO originates from Wayfair.
 */
export const WAYFAIR_BUYER_IDENTIFIERS = [
  'WAYFAIR',
  'WAYFAIR LLC',
  'WAYFAIR INC',
] as const

export function isWayfairPO(buyerCompanyName: string): boolean {
  const normalized = buyerCompanyName.toUpperCase().trim()
  return WAYFAIR_BUYER_IDENTIFIERS.some((id) => normalized.includes(id))
}
