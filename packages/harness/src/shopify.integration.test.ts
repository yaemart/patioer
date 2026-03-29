/**
 * Shopify 真实联调集成测试（Sprint 8 AC）
 *
 * 测试范围：OAuth Token 有效性验证 → getProducts 返回真实商品 → updatePrice 可回查
 *
 * 执行前置：
 *   1. 在 Shopify Partner Dashboard 创建 Custom App，生成 Admin API Access Token
 *   2. 设置环境变量：
 *      SHOPIFY_SHOP_DOMAIN   = mystore.myshopify.com
 *      SHOPIFY_ACCESS_TOKEN  = shpat_xxxxxxxxxxxx
 *      SHOPIFY_TEST_PRODUCT_ID = 12345678  (可选，用于 updatePrice 回查)
 *
 * 运行命令：
 *   SHOPIFY_SHOP_DOMAIN=xxx SHOPIFY_ACCESS_TOKEN=yyy \
 *   pnpm --filter @patioer/harness vitest run src/shopify.integration.test.ts
 *
 * 若环境变量缺失，本文件自动跳过所有测试（CI 安全）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { ShopifyHarness } from './shopify.harness.js'

const SHOP_DOMAIN = process.env['SHOPIFY_SHOP_DOMAIN'] ?? ''
const ACCESS_TOKEN = process.env['SHOPIFY_ACCESS_TOKEN'] ?? ''
const TEST_PRODUCT_ID = process.env['SHOPIFY_TEST_PRODUCT_ID'] ?? ''

const SKIP = !SHOP_DOMAIN || !ACCESS_TOKEN

function describeIntegration(name: string, fn: () => void) {
  if (SKIP) {
    describe.skip(`[SKIPPED — env vars missing] ${name}`, fn)
  } else {
    describe(name, fn)
  }
}

describeIntegration('Shopify 真实联调 (Sprint 8 AC)', () => {
  let harness: ShopifyHarness

  beforeAll(() => {
    harness = new ShopifyHarness('tenant-integration', SHOP_DOMAIN, ACCESS_TOKEN)
  })

  it('OAuth Access Token 有效 — getProducts 返回至少 1 个商品', async () => {
    const products = await harness.getProducts({ limit: 5 })
    console.log(`✅ getProducts 返回 ${products.length} 个商品`)
    if (products.length > 0) {
      const first = products[0]!
      console.log(`   first product: id=${first.id} title="${first.title}" price=${first.price}`)
    }
    expect(Array.isArray(products)).toBe(true)
    expect(products.length).toBeGreaterThan(0)
  }, 30_000)

  it('getProducts 每个商品有合法 id/title/price', async () => {
    const products = await harness.getProducts({ limit: 10 })
    for (const p of products) {
      expect(typeof p.id).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
      expect(typeof p.title).toBe('string')
      expect(typeof p.price).toBe('number')
      expect(p.price).toBeGreaterThanOrEqual(0)
    }
  }, 30_000)

  it('getProductsPage 返回分页结构', async () => {
    const page = await harness.getProductsPage({ limit: 3 })
    expect(Array.isArray(page.items)).toBe(true)
    // nextCursor 可能为 undefined（商品数 ≤ 3 时）
    const cursorType = typeof page.nextCursor
    expect(['string', 'undefined']).toContain(cursorType)
    console.log(`   page.items.length=${page.items.length}, nextCursor=${page.nextCursor ?? '(none)'}`)
  }, 30_000)

  it('updatePrice 可回查 — 将测试商品价格改为 $1.00 后验证', async () => {
    if (!TEST_PRODUCT_ID) {
      console.log('   跳过 updatePrice 回查（SHOPIFY_TEST_PRODUCT_ID 未设置）')
      return
    }

    const before = await harness.getProduct(TEST_PRODUCT_ID)
    expect(before).not.toBeNull()
    const originalPrice = before!.price ?? 0
    console.log(`   updatePrice 测试商品 id=${TEST_PRODUCT_ID} 原价 $${originalPrice}`)

    const testPrice = 1.0
    await harness.updatePrice(TEST_PRODUCT_ID, testPrice)

    const after = await harness.getProduct(TEST_PRODUCT_ID)
    expect(after).not.toBeNull()
    expect(after!.price).toBeCloseTo(testPrice, 2)
    console.log(`✅ updatePrice 回查: $${after!.price} (expected $${testPrice})`)

    // 恢复原价（最佳努力）
    await harness.updatePrice(TEST_PRODUCT_ID, originalPrice)
    console.log(`   已恢复原价 $${originalPrice}`)
  }, 60_000)

  it('getProduct 返回 null 对不存在的商品 ID', async () => {
    const result = await harness.getProduct('9999999999999')
    expect(result).toBeNull()
    console.log('✅ getProduct(nonexistent) → null')
  }, 30_000)
})
