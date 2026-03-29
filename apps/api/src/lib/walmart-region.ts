/**
 * Single source of truth for Walmart region (us | ca | mx) from env or DB.
 * Stored in `platform_credentials.metadata.region`.
 */
const VALID_WALMART_REGIONS = ['us', 'ca', 'mx'] as const

export type WalmartRegion = (typeof VALID_WALMART_REGIONS)[number]

export function parseWalmartRegion(raw: string | null | undefined): WalmartRegion {
  const normalized = (raw ?? 'us').toLowerCase()
  if (!VALID_WALMART_REGIONS.includes(normalized as WalmartRegion)) {
    throw new Error(`Invalid Walmart region: "${raw ?? ''}". Must be one of: ${VALID_WALMART_REGIONS.join(', ')}`)
  }
  return normalized as WalmartRegion
}
