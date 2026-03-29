/**
 * Platform-specific event type contracts for the Event Lake.
 *
 * The Event Lake stores `eventType` as a free-form string; these constants
 * provide a recommended vocabulary per platform so that downstream
 * consumers (Feature Agent, Insight Agent, dashboards) can rely on
 * consistent naming across the codebase.
 *
 * ADR-0003: Events are written asynchronously; failures must not block
 * the main business path.
 */

export const SHOPIFY_EVENT_TYPES = [
  'shopify:product.created',
  'shopify:product.updated',
  'shopify:order.created',
  'shopify:order.fulfilled',
  'shopify:inventory.updated',
] as const

export const AMAZON_EVENT_TYPES = [
  'amazon:listing.updated',
  'amazon:order.created',
  'amazon:order.shipped',
  'amazon:inventory.updated',
] as const

export const TIKTOK_EVENT_TYPES = [
  'tiktok:product.updated',
  'tiktok:order.created',
  'tiktok:order.shipped',
] as const

export const SHOPEE_EVENT_TYPES = [
  'shopee:item.updated',
  'shopee:order.created',
  'shopee:order.shipped',
] as const

export const WALMART_EVENT_TYPES = [
  'walmart:item.updated',
  'walmart:offer.updated',
  'walmart:order.created',
  'walmart:order.updated',
  'walmart:inventory.updated',
  'walmart:price.changed',
] as const

export const WAYFAIR_B2B_EVENT_TYPES = [
  'b2b:wayfair:po.received',
  'b2b:wayfair:po.confirmed',
  'b2b:wayfair:inventory.updated',
  'b2b:wayfair:price.changed',
] as const

export type WalmartEventType = (typeof WALMART_EVENT_TYPES)[number]
export type WayfairB2BEventType = (typeof WAYFAIR_B2B_EVENT_TYPES)[number]

export const ALL_PLATFORM_EVENT_TYPES = [
  ...SHOPIFY_EVENT_TYPES,
  ...AMAZON_EVENT_TYPES,
  ...TIKTOK_EVENT_TYPES,
  ...SHOPEE_EVENT_TYPES,
  ...WALMART_EVENT_TYPES,
  ...WAYFAIR_B2B_EVENT_TYPES,
] as const
