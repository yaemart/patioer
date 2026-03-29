/** Single source of truth for platform id + default credential order (shopify → … → walmart). */
export const SUPPORTED_PLATFORMS = ['shopify', 'amazon', 'tiktok', 'shopee', 'walmart'] as const
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number]
