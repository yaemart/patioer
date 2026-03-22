import type { AgentContext } from '../context.js'
import type { ProductScoutRunInput, ScoutedProduct } from '../types.js'

const DEFAULT_MAX_PRODUCTS = 50
const LOW_INVENTORY_THRESHOLD = 5
const HIGH_PRICE_THRESHOLD = 10_000

function classifyProduct(product: {
  id: string
  title: string
  price: number | null
  inventory: number | null
}): ScoutedProduct {
  const price = product.price ?? 0
  const inventory = product.inventory ?? 0
  let flag: ScoutedProduct['flag'] = 'normal'
  if (inventory <= LOW_INVENTORY_THRESHOLD) flag = 'low_inventory'
  else if (price >= HIGH_PRICE_THRESHOLD) flag = 'high_price'

  return {
    productId: product.id,
    title: product.title,
    price,
    inventory,
    flag,
  }
}

export async function runProductScout(
  ctx: AgentContext,
  input: ProductScoutRunInput,
): Promise<{ scouted: ScoutedProduct[] }> {
  const raw = input.maxProducts ?? DEFAULT_MAX_PRODUCTS
  const maxProducts = Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_PRODUCTS

  await ctx.logAction('product_scout.run.started', { maxProducts })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('product_scout.budget_exceeded', { maxProducts })
    return { scouted: [] }
  }

  const products = await ctx.getHarness().getProducts({ limit: maxProducts })
  const scouted: ScoutedProduct[] = products.map(classifyProduct)

  const flagged = scouted.filter((s) => s.flag !== 'normal')

  if (flagged.length > 0) {
    await ctx.createTicket({
      title: `Product Scout: ${flagged.length} product(s) flagged`,
      body: flagged
        .map((f) => `- [${f.flag}] ${f.title} (id=${f.productId}, inv=${f.inventory}, $${f.price})`)
        .join('\n'),
    })
    await ctx.logAction('product_scout.ticket_created', {
      flaggedCount: flagged.length,
    })
  }

  await ctx.logAction('product_scout.run.completed', {
    scannedCount: products.length,
    flaggedCount: flagged.length,
  })

  return { scouted }
}
