/**
 * Walmart webhook (Event Notification) subscription management.
 *
 * Walmart uses a push-based Event Notification API where sellers register
 * callback URLs via the Marketplace API. This module provides helpers to
 * register the callback endpoint for the standard event types.
 *
 * Phase 1 implementation: subscription is managed manually or via onboarding;
 * automatic subscription will be added when the Walmart Event Notification API
 * is GA and stable across all regions.
 */

export const WALMART_WEBHOOK_EVENT_TYPES = [
  'ITEM_UPDATE',
  'OFFER_UPDATE',
  'ORDER_UPDATE',
  'INVENTORY_UPDATE',
] as const

export type WalmartWebhookEventType = (typeof WALMART_WEBHOOK_EVENT_TYPES)[number]

export interface WalmartWebhookSubscription {
  eventType: WalmartWebhookEventType
  callbackUrl: string
  status: 'active' | 'pending' | 'disabled'
}

/**
 * Build the callback URL for a given event type.
 * Used by onboarding and manual subscription flows.
 */
export function buildWalmartWebhookCallbackUrl(appBaseUrl: string, tenantId?: string): string {
  const baseUrl = `${appBaseUrl}/api/v1/webhooks/walmart`
  if (!tenantId) return baseUrl
  return `${baseUrl}?tenantId=${encodeURIComponent(tenantId)}`
}
