/**
 * Single source of truth for Amazon SP-API region (`na` | `eu` | `fe`) from env or DB.
 * Normalizes case so `AMAZON_REGION=NA` matches `na`.
 */
const VALID_AMAZON_REGIONS = ['na', 'eu', 'fe'] as const

export type AmazonSpApiRegion = (typeof VALID_AMAZON_REGIONS)[number]

export function parseAmazonRegion(raw: string | null | undefined): AmazonSpApiRegion {
  const normalized = (raw ?? 'na').toLowerCase()
  if (!VALID_AMAZON_REGIONS.includes(normalized as AmazonSpApiRegion)) {
    throw new Error(`Invalid Amazon region: "${raw ?? ''}". Must be one of: ${VALID_AMAZON_REGIONS.join(', ')}`)
  }
  return normalized as AmazonSpApiRegion
}
