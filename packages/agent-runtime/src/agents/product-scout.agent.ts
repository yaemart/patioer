import type { AgentContext } from '../context.js'
import type { PendingApprovalItem } from '../ports.js'
import type { ProductScoutRunInput, ScoutedProduct } from '../commerce-types.js'
import { runComplianceCheck } from '../compliance/compliance-pipeline.js'
import type { ComplianceMarket, ComplianceProductInput } from '../compliance/prohibited-keywords.js'
import { ALL_COMPLIANCE_MARKETS } from '../compliance/prohibited-keywords.js'
import { runAgentPreflight } from './preflight.js'

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

function isValidMarket(m: string): m is ComplianceMarket {
  return (ALL_COMPLIANCE_MARKETS as readonly string[]).includes(m)
}

function hasPendingFlagReview(
  pendingApprovals: PendingApprovalItem[],
  flagged: ScoutedProduct[],
): boolean {
  const flaggedIds = new Set(flagged.map((item) => item.productId))
  return pendingApprovals.some((item) => {
    if (item.action !== 'product_scout.review_flagged') return false
    const payload = (item.payload ?? {}) as Record<string, unknown>
    const products = Array.isArray(payload.products) ? payload.products : []
    return products.some((product) => {
      const record = product as Record<string, unknown>
      return typeof record.productId === 'string' && flaggedIds.has(record.productId)
    })
  })
}

export async function runProductScout(
  ctx: AgentContext,
  input: ProductScoutRunInput,
): Promise<{ scouted: ScoutedProduct[]; complianceBlocked: string[] }> {
  const raw = input.maxProducts ?? DEFAULT_MAX_PRODUCTS
  const maxProducts = Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_PRODUCTS
  const complianceMarkets = (input.complianceMarkets ?? []).filter(isValidMarket)

  await ctx.logAction('product_scout.run.started', { maxProducts, complianceMarkets })

  const preflight = await runAgentPreflight(ctx, {
    agentKey: 'product_scout',
    humanInLoopAction: 'product_scout.full_run',
    payload: { maxProducts, complianceMarkets },
  })
  if (preflight.reason === 'human_in_loop') {
    return { scouted: [], complianceBlocked: [] }
  }
  if (preflight.reason === 'budget_exceeded') {
    return { scouted: [], complianceBlocked: [] }
  }

  const governance = preflight.governance
  const pendingApprovals = preflight.pendingApprovals
  const products = await ctx.getHarness().getProducts({ limit: maxProducts })
  const scouted: ScoutedProduct[] = products.map(classifyProduct)
  const complianceBlocked: string[] = []

  if (complianceMarkets.length > 0) {
    for (const product of products) {
      const complianceInput: ComplianceProductInput = {
        productId: product.id,
        title: product.title,
        description: product.title,
        price: product.price,
        category: (product.platformMeta as Record<string, unknown> | undefined)?.category as string | undefined,
      }
      for (const market of complianceMarkets) {
        const result = await runComplianceCheck(complianceInput, market, ctx)
        if (!result.passed) {
          complianceBlocked.push(product.id)
          break
        }
      }
    }

    if (complianceBlocked.length > 0) {
      await ctx.logAction('product_scout.compliance_blocked', {
        blockedCount: complianceBlocked.length,
        markets: complianceMarkets,
      })
    }
  }

  const flagged = scouted.filter((s) => s.flag !== 'normal')

  if (flagged.length > 0) {
    if (governance.newListingApproval) {
      if (hasPendingFlagReview(pendingApprovals, flagged)) {
        await ctx.logAction('product_scout.approval_duplicate_skipped', {
          flaggedCount: flagged.length,
          keyword: 'PRODUCT_SCOUT_PENDING_DEDUPE',
        })
      } else {
        await ctx.requestApproval({
          action: 'product_scout.review_flagged',
          payload: {
            flaggedCount: flagged.length,
            products: flagged.map((f) => ({
              productId: f.productId,
              title: f.title,
              flag: f.flag,
              price: f.price,
              inventory: f.inventory,
            })),
          },
          reason: `${flagged.length} product(s) flagged — newListingApproval is enabled`,
        })
        await ctx.logAction('product_scout.approval_requested', {
          flaggedCount: flagged.length,
        })
      }
    } else {
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
  }

  await ctx.logAction('product_scout.run.completed', {
    scannedCount: products.length,
    flaggedCount: flagged.length,
    complianceBlockedCount: complianceBlocked.length,
  })

  return { scouted, complianceBlocked }
}
