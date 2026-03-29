import {
  normalizeShopifyOrderPayload,
  normalizeShopifyProductPayload,
} from './shopify-webhook-normalizer.js'
import { upsertShopifyOrder } from './webhook-orders.js'
import { upsertShopifyProduct } from './webhook-products.js'
import { webhookDispatchNoHandlerTotal, webhookHandlerErrorsTotal } from '../plugins/metrics.js'

// ─── Shopify (existing) ────────────────────────────────────────────────────────

export async function handleWebhookTopic(
  topic: string,
  tenantId: string,
  payload: unknown,
): Promise<void> {
  switch (topic) {
    case 'orders/create':
    case 'orders/updated':
      await upsertShopifyOrder(tenantId, normalizeShopifyOrderPayload(payload))
      break

    case 'products/create':
    case 'products/update':
      await upsertShopifyProduct(tenantId, normalizeShopifyProductPayload(payload))
      break

    default:
      break
  }
}

// ─── Phase 2: Multi-platform Webhook Topic types ──────────────────────────────

export type WebhookPlatform = 'shopify' | 'amazon' | 'tiktok' | 'shopee' | 'walmart'

export type ShopifyTopic =
  | 'orders/create'
  | 'orders/updated'
  | 'products/create'
  | 'products/update'

export type AmazonTopic =
  | 'amazon:ORDER_CHANGE'
  | 'amazon:ITEM_CHANGE'
  | 'amazon:FEED_PROCESSING_FINISHED'

export type TikTokTopic =
  | 'tiktok:ORDER_STATUS_CHANGE'
  | 'tiktok:LIVE_ORDER'
  | 'tiktok:SHOP_PRODUCT_CHANGE'

export type ShopeeTopic =
  | 'shopee:order.status_update'
  | 'shopee:logistics.tracking_update'
  | 'shopee:shop.update_profile'

export type WalmartTopic = `walmart:${string}`

export type WebhookTopic = ShopifyTopic | AmazonTopic | TikTokTopic | ShopeeTopic | WalmartTopic

// ─── Unified multi-platform webhook event ─────────────────────────────────────

export interface PlatformWebhookEvent {
  platform: WebhookPlatform
  topic: WebhookTopic
  tenantId: string
  /** Shopify shop domain or Amazon seller ID */
  shopId?: string
  shopName?: string
  payload: unknown
  receivedAt: Date
}

// ─── Handler registry ─────────────────────────────────────────────────────────

/** Handler function signature for platform webhook events. */
export type WebhookHandler = (event: PlatformWebhookEvent) => Promise<void>

/** topic → handler, populated at bootstrap time via registerWebhookHandler(). */
const handlers = new Map<WebhookTopic, WebhookHandler>()

/**
 * Register a handler for a specific topic.
 * Call once per topic during application bootstrap.
 * Re-registering a topic overwrites the previous handler.
 */
export function registerWebhookHandler(topic: WebhookTopic, handler: WebhookHandler): void {
  handlers.set(topic, handler)
}

/**
 * Topics accepted at HTTP routes (Amazon / TikTok / Shopee) for which we do not yet
 * run business logic after persistence. Registers a shared no-op handler so
 * `dispatchWebhook` does not emit no-handler warnings/metrics in production.
 * Replace individual topics with real handlers as features land.
 */
const PLATFORM_WEBHOOK_STUB_TOPICS: WebhookTopic[] = [
  'amazon:ORDER_CHANGE',
  'amazon:ITEM_CHANGE',
  'amazon:FEED_PROCESSING_FINISHED',
  'tiktok:ORDER_STATUS_CHANGE',
  'tiktok:LIVE_ORDER',
  'tiktok:SHOP_PRODUCT_CHANGE',
  'shopee:order.status_update',
  'shopee:logistics.tracking_update',
  'shopee:shop.update_profile',
]

export function registerStubPlatformWebhookHandlers(): void {
  const noop: WebhookHandler = async () => {
    // Routes persist `webhook_events`; side effects (sync jobs, etc.) are deferred.
  }
  for (const topic of PLATFORM_WEBHOOK_STUB_TOPICS) {
    registerWebhookHandler(topic, noop)
  }
}

/**
 * Remove all registered handlers.
 * Intended for test isolation only — not for production use.
 */
export function _clearWebhookHandlers(): void {
  handlers.clear()
}

// ─── Platform-agnostic dispatch ───────────────────────────────────────────────

/**
 * Route a PlatformWebhookEvent to its registered handler.
 * If no handler is registered for the topic, a warning is logged and the
 * function returns normally — never throws — to avoid triggering platform retries.
 * In production, {@link registerStubPlatformWebhookHandlers} registers no-ops for
 * all known non-Shopify topics so this path is reserved for unknown/future topics.
 */
export async function dispatchWebhook(event: PlatformWebhookEvent): Promise<void> {
  const handler = handlers.get(event.topic)
  if (!handler) {
    webhookDispatchNoHandlerTotal.labels(event.platform).inc()
    console.warn(
      `[webhook-topic-handler] No handler for topic "${event.topic}" (platform=${event.platform})`,
    )
    return
  }
  try {
    await handler(event)
  } catch (err) {
    webhookHandlerErrorsTotal.labels(event.platform, event.topic).inc()
    // Log and suppress handler errors so the webhook route returns 200 and prevents
    // platform retry storms. Operators should alert on this log line + metric.
    console.error(
      `[webhook-topic-handler] Handler for "${event.topic}" threw an error:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// ─── Per-platform entry points ────────────────────────────────────────────────

/** Called by the Amazon webhook route after payload is parsed and optionally persisted. */
export async function handleAmazonWebhook(
  tenantId: string,
  topic: AmazonTopic,
  payload: unknown,
): Promise<void> {
  await dispatchWebhook({
    platform: 'amazon',
    topic,
    tenantId,
    payload,
    receivedAt: new Date(),
  })
}

/** Called by the TikTok webhook route after HMAC verification and DB persistence. */
export async function handleTikTokWebhook(
  tenantId: string,
  topic: TikTokTopic,
  payload: unknown,
): Promise<void> {
  await dispatchWebhook({ platform: 'tiktok', topic, tenantId, payload, receivedAt: new Date() })
}

/** Called by the Shopee webhook route after signature verification and payload parsing. */
export async function handleShopeeWebhook(
  tenantId: string,
  topic: ShopeeTopic,
  payload: unknown,
): Promise<void> {
  await dispatchWebhook({ platform: 'shopee', topic, tenantId, payload, receivedAt: new Date() })
}

/** Called by the Walmart webhook route after payload parsing and persistence. */
export async function handleWalmartWebhook(
  tenantId: string,
  topic: WalmartTopic,
  payload: unknown,
): Promise<void> {
  await dispatchWebhook({ platform: 'walmart', topic, tenantId, payload, receivedAt: new Date() })
}
