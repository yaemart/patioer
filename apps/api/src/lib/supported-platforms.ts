/** Single source of truth for platform id + default credential order (shopify → … → shopee). */
export const SUPPORTED_PLATFORMS = ['shopify', 'amazon', 'tiktok', 'shopee'] as const
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number]
