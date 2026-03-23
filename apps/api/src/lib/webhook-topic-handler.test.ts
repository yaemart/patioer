import { afterEach, describe, expect, it, vi } from 'vitest'

const mockNoHandlerInc = vi.fn()
const mockHandlerErrInc = vi.fn()
vi.mock('../plugins/metrics.js', () => ({
  webhookDispatchNoHandlerTotal: { labels: () => ({ inc: mockNoHandlerInc }) },
  webhookHandlerErrorsTotal: { labels: () => ({ inc: mockHandlerErrInc }) },
}))

vi.mock('./webhook-orders.js', () => ({
  upsertShopifyOrderFromPayload: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./webhook-products.js', () => ({
  upsertShopifyProductFromPayload: vi.fn().mockResolvedValue(undefined),
}))

import {
  _clearWebhookHandlers,
  dispatchWebhook,
  handleAmazonWebhook,
  handleShopeeWebhook,
  handleTikTokWebhook,
  registerStubPlatformWebhookHandlers,
  registerWebhookHandler,
  type PlatformWebhookEvent,
  type WebhookTopic,
} from './webhook-topic-handler.js'

afterEach(() => {
  _clearWebhookHandlers()
  mockNoHandlerInc.mockClear()
  mockHandlerErrInc.mockClear()
  vi.restoreAllMocks()
})

// ── Phase 2 · Sprint 3 Day 7: Multi-platform dispatch ─────────────────────────

describe('handleAmazonWebhook dispatches to registered handler', () => {
  it('calls the registered handler for an amazon topic', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerWebhookHandler('amazon:ORDER_CHANGE', handler)

    await handleAmazonWebhook('tenant-1', 'amazon:ORDER_CHANGE', { orderId: 'A1' })

    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0]?.[0] as PlatformWebhookEvent
    expect(event.platform).toBe('amazon')
    expect(event.topic).toBe('amazon:ORDER_CHANGE')
    expect(event.tenantId).toBe('tenant-1')
  })
})

describe('handleTikTokWebhook dispatches to registered handler', () => {
  it('calls the registered handler for a tiktok topic', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerWebhookHandler('tiktok:ORDER_STATUS_CHANGE', handler)

    await handleTikTokWebhook('tenant-2', 'tiktok:ORDER_STATUS_CHANGE', { type: 'ORDER_STATUS_CHANGE' })

    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0]?.[0] as PlatformWebhookEvent
    expect(event.platform).toBe('tiktok')
    expect(event.topic).toBe('tiktok:ORDER_STATUS_CHANGE')
    expect(event.tenantId).toBe('tenant-2')
  })
})

describe('handleShopeeWebhook dispatches to registered handler', () => {
  it('calls the registered handler for a shopee topic', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    registerWebhookHandler('shopee:order.status_update', handler)

    await handleShopeeWebhook('tenant-3', 'shopee:order.status_update', { code: 3, shop_id: 999 })

    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0]?.[0] as PlatformWebhookEvent
    expect(event.platform).toBe('shopee')
    expect(event.topic).toBe('shopee:order.status_update')
    expect(event.tenantId).toBe('tenant-3')
  })
})

describe('dispatchWebhook logs warning for unknown topic (no throw)', () => {
  it('does not throw and emits console.warn when no handler is registered', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Topic not in PLATFORM_WEBHOOK_STUB_TOPICS — simulates a future / mistyped topic
    await expect(
      dispatchWebhook({
        platform: 'amazon',
        topic: 'amazon:__test_unknown_topic__' as WebhookTopic,
        tenantId: 'tenant-x',
        payload: {},
        receivedAt: new Date(),
      }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('amazon:__test_unknown_topic__')
    expect(mockNoHandlerInc).toHaveBeenCalledOnce()
  })

  it('increments webhookHandlerErrorsTotal when a registered handler throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerWebhookHandler('amazon:FEED_PROCESSING_FINISHED', async () => {
      throw new Error('boom')
    })

    await dispatchWebhook({
      platform: 'amazon',
      topic: 'amazon:FEED_PROCESSING_FINISHED',
      tenantId: 't1',
      payload: {},
      receivedAt: new Date(),
    })

    expect(mockHandlerErrInc).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })
})

describe('registerStubPlatformWebhookHandlers', () => {
  it('registers no-op handlers so known topics do not trigger no-handler warn', async () => {
    registerStubPlatformWebhookHandlers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchWebhook({
      platform: 'amazon',
      topic: 'amazon:ITEM_CHANGE',
      tenantId: 'tenant-x',
      payload: {},
      receivedAt: new Date(),
    })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(mockNoHandlerInc).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('PlatformWebhookEvent has correct platform field', () => {
  it('event dispatched by handleTikTokWebhook carries platform=tiktok', async () => {
    let capturedEvent: PlatformWebhookEvent | undefined

    registerWebhookHandler('tiktok:LIVE_ORDER', async (ev) => {
      capturedEvent = ev
    })

    await handleTikTokWebhook('tenant-live', 'tiktok:LIVE_ORDER', { order_id: 'ORD-42' })

    expect(capturedEvent).toBeDefined()
    expect(capturedEvent!.platform).toBe('tiktok')
    expect(capturedEvent!.receivedAt).toBeInstanceOf(Date)
  })
})
