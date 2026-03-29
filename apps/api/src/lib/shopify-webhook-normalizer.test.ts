import { describe, expect, it } from 'vitest'
import {
  normalizeShopifyOrderPayload,
  normalizeShopifyProductPayload,
} from './shopify-webhook-normalizer.js'

describe('normalizeShopifyOrderPayload', () => {
  it('maps Shopify order payload into a stable DTO', () => {
    expect(
      normalizeShopifyOrderPayload({
        id: 123,
        financial_status: 'paid',
        total_price: '18.88',
        line_items: [{ sku: 'SKU-1' }],
      }),
    ).toEqual({
      platformOrderId: '123',
      status: 'paid',
      totalPrice: '18.88',
      items: [{ sku: 'SKU-1' }],
    })
  })

  it('fills safe defaults when payload shape is incomplete', () => {
    expect(normalizeShopifyOrderPayload(null)).toEqual({
      platformOrderId: '',
      status: 'unknown',
      totalPrice: '0',
      items: null,
    })
  })
})

describe('normalizeShopifyProductPayload', () => {
  it('maps Shopify product payload into a stable DTO', () => {
    expect(
      normalizeShopifyProductPayload({
        id: 456,
        title: 'Desk Lamp',
        product_type: 'lighting',
        variants: [{ price: 29.9 }],
      }),
    ).toEqual({
      platformProductId: '456',
      title: 'Desk Lamp',
      category: 'lighting',
      price: '29.9',
      attributes: {
        id: 456,
        title: 'Desk Lamp',
        product_type: 'lighting',
        variants: [{ price: 29.9 }],
      },
    })
  })

  it('fills safe defaults when variants or title are missing', () => {
    expect(
      normalizeShopifyProductPayload({
        id: 8,
      }),
    ).toEqual({
      platformProductId: '8',
      title: 'Untitled',
      category: null,
      price: null,
      attributes: {
        id: 8,
      },
    })
  })
})
