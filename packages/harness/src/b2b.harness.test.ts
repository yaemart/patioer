import { describe, it, expect, vi } from 'vitest'
import {
  B2BHarness,
  parseEDI850,
  buildDefaultTiers,
  resolveUnitPrice,
  createB2BHarness,
  filterCatalogByTier,
  type B2BBackendAdapter,
} from './b2b.harness.js'
import type { B2BHarnessConfig, B2BProduct } from './b2b.types.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG: B2BHarnessConfig = {
  credentials: { apiBaseUrl: 'https://b2b.example.com', apiKey: 'test-key', tenantId: 'tenant-b2b' },
  defaultCurrency: 'USD',
  moqDefault: 10,
}

function mockProduct(overrides?: Partial<B2BProduct>): B2BProduct {
  return {
    id: 'prod-001',
    title: 'Widget A',
    sku: 'WA-001',
    moq: 10,
    basePricePerUnit: 25.0,
    currency: 'USD',
    inventory: 500,
    catalogVisibility: 'all',
    priceSchedule: {
      productId: 'prod-001',
      basePricePerUnit: 25.0,
      tiers: buildDefaultTiers(25.0),
      currency: 'USD',
    },
    ...overrides,
  }
}

function createMockBackend(overrides?: Partial<B2BBackendAdapter>): B2BBackendAdapter {
  return {
    fetchProducts: vi.fn().mockResolvedValue([mockProduct()]),
    fetchProduct: vi.fn().mockResolvedValue(mockProduct()),
    updatePriceSchedule: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    fetchOrders: vi.fn().mockResolvedValue([{ id: 'ord-001', status: 'confirmed', totalPrice: 1250 }]),
    submitEDIOrder: vi.fn().mockResolvedValue({ id: 'ord-edi-001', status: 'pending', totalPrice: 5000 }),
    fetchAnalytics: vi.fn().mockResolvedValue({ revenue: 25000, orders: 20, truncated: false }),
    ...overrides,
  }
}

// ─── Tiered Pricing ───────────────────────────────────────────────────────────

describe('buildDefaultTiers', () => {
  it('creates 3 tiers with 10% and 20% discounts', () => {
    const tiers = buildDefaultTiers(100)
    expect(tiers).toHaveLength(3)
    expect(tiers[0]).toEqual({ minQty: 1, maxQty: 99, unitPrice: 100 })
    expect(tiers[1]).toEqual({ minQty: 100, maxQty: 499, unitPrice: 90 })
    expect(tiers[2]).toEqual({ minQty: 500, maxQty: null, unitPrice: 80 })
  })

  it('handles fractional base prices with proper rounding', () => {
    const tiers = buildDefaultTiers(33.33)
    expect(tiers[1].unitPrice).toBe(30)
    expect(tiers[2].unitPrice).toBe(26.66)
  })
})

describe('resolveUnitPrice', () => {
  const tiers = buildDefaultTiers(50)

  it('returns tier-1 price for small quantities', () => {
    expect(resolveUnitPrice(tiers, 1)).toBe(50)
    expect(resolveUnitPrice(tiers, 99)).toBe(50)
  })

  it('returns tier-2 price for medium quantities', () => {
    expect(resolveUnitPrice(tiers, 100)).toBe(45)
    expect(resolveUnitPrice(tiers, 499)).toBe(45)
  })

  it('returns tier-3 price for large quantities', () => {
    expect(resolveUnitPrice(tiers, 500)).toBe(40)
    expect(resolveUnitPrice(tiers, 10000)).toBe(40)
  })
})

// ─── EDI 850 Parser ───────────────────────────────────────────────────────────

describe('parseEDI850', () => {
  const sampleEDI = [
    'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*U*00401*000000001*0*P*>',
    'GS*PO*SENDER*RECEIVER*20230101*1200*1*X*004010',
    'ST*850*0001',
    'BEG*00*NE*PO-12345**20230101',
    'CUR*BY*USD',
    'N1*BY*Acme Corp*92*BUYER-001',
    'N1*ST*Warehouse Alpha',
    'N3*123 Industrial Ave',
    'N4*Los Angeles*CA*90001*US',
    'PO1*1*50*EA*25.00*PE*SK*WIDGET-A',
    'PO1*2*200*EA*12.50*PE*SK*WIDGET-B',
    'CTT*2',
    'SE*12*0001',
    'GE*1*1',
    'IEA*1*000000001',
  ].join('~')

  it('extracts PO number and order date', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.poNumber).toBe('PO-12345')
    expect(po.orderDate).toBe('20230101')
  })

  it('extracts buyer information', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.buyerId).toBe('BUYER-001')
    expect(po.buyerCompanyName).toBe('Acme Corp')
  })

  it('extracts ship-to address', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.shipTo.street).toBe('123 Industrial Ave')
    expect(po.shipTo.city).toBe('Los Angeles')
    expect(po.shipTo.state).toBe('CA')
    expect(po.shipTo.postalCode).toBe('90001')
  })

  it('parses line items with correct quantities and prices', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.lineItems).toHaveLength(2)
    expect(po.lineItems[0]).toMatchObject({
      lineNumber: 1,
      quantity: 50,
      unitPrice: 25,
      sku: 'WIDGET-A',
    })
    expect(po.lineItems[1]).toMatchObject({
      lineNumber: 2,
      quantity: 200,
      unitPrice: 12.5,
      sku: 'WIDGET-B',
    })
  })

  it('calculates total amount correctly', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.totalAmount).toBe(50 * 25 + 200 * 12.5)
  })

  it('extracts currency', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.currency).toBe('USD')
  })

  it('preserves raw segments', () => {
    const po = parseEDI850(sampleEDI)
    expect(po.rawSegments).toBe(sampleEDI)
  })
})

// ─── B2B Harness ──────────────────────────────────────────────────────────────

describe('B2BHarness', () => {
  it('has correct tenantId and platformId', () => {
    const backend = createMockBackend()
    const harness = new B2BHarness(MOCK_CONFIG, backend)
    expect(harness.tenantId).toBe('tenant-b2b')
    expect(harness.platformId).toBe('b2b')
  })

  describe('getProduct', () => {
    it('returns flattened Product from B2BProduct', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const product = await harness.getProduct('prod-001')
      expect(product).toMatchObject({
        id: 'prod-001',
        title: 'Widget A',
        price: 25,
        inventory: 500,
        sku: 'WA-001',
      })
      expect(product!.platformMeta).toMatchObject({
        moq: 10,
        catalogVisibility: 'all',
        tierCount: 3,
      })
    })

    it('returns null for non-existent product', async () => {
      const backend = createMockBackend({ fetchProduct: vi.fn().mockResolvedValue(null) })
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      expect(await harness.getProduct('nope')).toBeNull()
    })
  })

  describe('getProducts', () => {
    it('returns array of Products with truncated flag', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const products = await harness.getProducts({ limit: 50 })
      expect(products).toHaveLength(1)
      expect(products[0].id).toBe('prod-001')
    })
  })

  describe('getProductsPage', () => {
    it('returns paginated result', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const page = await harness.getProductsPage({ limit: 10 })
      expect(page.items).toHaveLength(1)
    })
  })

  describe('updatePrice (AC-P4-16: 3-tier pricing)', () => {
    it('calls backend with 3-tier price schedule', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      await harness.updatePrice('prod-001', 100)

      expect(backend.updatePriceSchedule).toHaveBeenCalledWith(
        'prod-001',
        expect.objectContaining({
          productId: 'prod-001',
          basePricePerUnit: 100,
          tiers: [
            { minQty: 1, maxQty: 99, unitPrice: 100 },
            { minQty: 100, maxQty: 499, unitPrice: 90 },
            { minQty: 500, maxQty: null, unitPrice: 80 },
          ],
          currency: 'USD',
        }),
      )
    })
  })

  describe('updateInventory', () => {
    it('delegates to backend', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      await harness.updateInventory('prod-001', 1000)
      expect(backend.updateInventory).toHaveBeenCalledWith('prod-001', 1000)
    })
  })

  describe('getOrders', () => {
    it('returns orders from backend', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const orders = await harness.getOrders()
      expect(orders).toHaveLength(1)
      expect(orders[0].id).toBe('ord-001')
    })
  })

  describe('getOrdersPage', () => {
    it('returns paginated order result', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const page = await harness.getOrdersPage({ limit: 10 })
      expect(page.items).toHaveLength(1)
    })
  })

  describe('receiveEDIOrder (AC-P4-15: EDI 850)', () => {
    it('parses EDI and submits to backend', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const edi = 'BEG*00*NE*PO-999**20230601~PO1*1*100*EA*10.00*PE*SK*SKU-X~'
      const order = await harness.receiveEDIOrder(edi)
      expect(order.id).toBe('ord-edi-001')
      expect(backend.submitEDIOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          poNumber: 'PO-999',
          lineItems: [expect.objectContaining({ quantity: 100, unitPrice: 10, sku: 'SKU-X' })],
        }),
      )
    })
  })

  describe('getAnalytics', () => {
    it('returns analytics for date range', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      const range = { from: new Date('2025-01-01'), to: new Date('2025-01-31') }
      const analytics = await harness.getAnalytics(range)
      expect(analytics.revenue).toBe(25000)
      expect(analytics.orders).toBe(20)
    })
  })

  describe('messaging', () => {
    it('replyToMessage throws (B2B uses email)', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      await expect(harness.replyToMessage('t-1', 'hello')).rejects.toThrow('B2B messaging not supported')
    })

    it('getOpenThreads returns empty array', async () => {
      const backend = createMockBackend()
      const harness = new B2BHarness(MOCK_CONFIG, backend)
      expect(await harness.getOpenThreads()).toEqual([])
    })
  })

  describe('implements TenantHarness interface', () => {
    it('has all required methods', () => {
      const backend = createMockBackend()
      const harness = createB2BHarness(MOCK_CONFIG, backend)
      const methods: Array<keyof typeof harness> = [
        'getProduct', 'getProducts', 'getProductsPage',
        'updatePrice', 'updateInventory',
        'getOrders', 'getOrdersPage',
        'replyToMessage', 'getOpenThreads',
        'getAnalytics',
      ]
      for (const m of methods) {
        expect(typeof harness[m]).toBe('function')
      }
    })
  })
})

// ─── filterCatalogByTier ──────────────────────────────────────────────────────

describe('filterCatalogByTier', () => {
  it('includes all-visibility products for any tier', () => {
    const products = [mockProduct({ catalogVisibility: 'all' })]
    expect(filterCatalogByTier(products, 'silver')).toHaveLength(1)
    expect(filterCatalogByTier(products, 'platinum')).toHaveLength(1)
  })

  it('filters by buyer tier', () => {
    const products = [
      mockProduct({ id: 'p1', catalogVisibility: ['gold', 'platinum'] }),
      mockProduct({ id: 'p2', catalogVisibility: ['silver'] }),
      mockProduct({ id: 'p3', catalogVisibility: 'all' }),
    ]
    const silver = filterCatalogByTier(products, 'silver')
    expect(silver.map((p) => p.id)).toEqual(['p2', 'p3'])

    const gold = filterCatalogByTier(products, 'gold')
    expect(gold.map((p) => p.id)).toEqual(['p1', 'p3'])
  })
})
