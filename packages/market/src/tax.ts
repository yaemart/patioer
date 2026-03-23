import type { Market, TaxRate, TaxCalculationResult } from './types.js'

/**
 * Tax rates for all Phase 2 markets.
 * `inclusive: true`  → the platform price already includes the tax (TH, ID).
 * `inclusive: false` → the platform price is pre-tax; tax is added on checkout (SG, MY, UK, DE).
 */
const TAX_RATES: Record<Market, TaxRate> = {
  SG: { market: 'SG', rate: 0.09,  name: 'GST',  inclusive: false },
  MY: { market: 'MY', rate: 0.06,  name: 'SST',  inclusive: false },
  TH: { market: 'TH', rate: 0.07,  name: 'VAT',  inclusive: true  },
  ID: { market: 'ID', rate: 0.11,  name: 'PPN',  inclusive: true  },
  UK: { market: 'UK', rate: 0.20,  name: 'VAT',  inclusive: false },
  DE: { market: 'DE', rate: 0.19,  name: 'MwSt', inclusive: false },
}

/** Return the tax configuration for a market. O(1) lookup. */
export function getTaxRate(market: Market): TaxRate {
  return TAX_RATES[market]
}

/**
 * Calculate tax breakdown for the given amount and market.
 *
 * Non-inclusive markets (SG, MY, UK, DE):
 *   `amount` is the pre-tax base price.
 *   taxAmount  = amount × rate
 *   totalAmount = amount × (1 + rate)
 *
 * Inclusive markets (TH, ID):
 *   `amount` is the listed tax-inclusive price.
 *   taxAmount  = amount × rate / (1 + rate)
 *   baseAmount = amount − taxAmount
 */
export function calculateTax(amount: number, market: Market): TaxCalculationResult {
  const taxRate = getTaxRate(market)

  if (taxRate.inclusive) {
    // Reverse-calculate: extract tax from an inclusive price
    const taxAmount = round6((amount * taxRate.rate) / (1 + taxRate.rate))
    return {
      baseAmount: round6(amount - taxAmount),
      taxAmount,
      totalAmount: amount,
      taxRate,
    }
  } else {
    // Forward-calculate: add tax to a pre-tax price
    const taxAmount = round6(amount * taxRate.rate)
    return {
      baseAmount: amount,
      taxAmount,
      totalAmount: round6(amount + taxAmount),
      taxRate,
    }
  }
}

/**
 * Extract the pre-tax base price from a tax-inclusive total.
 * Works for both inclusive and non-inclusive markets:
 * for non-inclusive markets the caller is expected to pass the gross (total+tax) amount.
 *
 * Used for cross-border pricing standardisation.
 */
export function extractBasePrice(totalAmount: number, market: Market): number {
  const { rate } = getTaxRate(market)
  return round6(totalAmount / (1 + rate))
}

/** Round to 6 decimal places to prevent floating-point drift across repeated operations. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}
