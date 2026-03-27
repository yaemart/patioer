import { randomUUID } from 'node:crypto'
import { HarnessError } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type {
  MarketIntelCompetitorInsight,
  MarketIntelRunInput,
  MarketIntelResult,
} from '../types.js'

const DEFAULT_MAX_PRODUCTS = 50

function buildAnalysisPrompt(
  product: { id: string; title: string; price: number | null },
  platform: string,
  features: unknown,
): string {
  const lines: string[] = [
    `Analyze competitor pricing for this product on ${platform}.`,
    `Product ID: ${product.id}`,
    `Product Title: ${product.title}`,
    `Current Price: $${product.price ?? 'unknown'}`,
  ]

  if (features && typeof features === 'object') {
    lines.push(`\nKnown product features:`)
    lines.push(JSON.stringify(features, null, 2))
  }

  lines.push(`\nBased on market data and your knowledge, estimate competitor pricing.`)
  lines.push(`Respond with valid JSON in this exact shape:`)
  lines.push(`{`)
  lines.push(`  "competitorMinPrice": <number>,`)
  lines.push(`  "competitorAvgPrice": <number>,`)
  lines.push(`  "pricePosition": "below" | "at" | "above",`)
  lines.push(`  "recommendation": "<optional string>"`)
  lines.push(`}`)

  return lines.join('\n')
}

function parseLlmInsight(
  text: string,
  productId: string,
  platform: string,
): MarketIntelCompetitorInsight | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    const competitorMinPrice = Number(parsed.competitorMinPrice)
    const competitorAvgPrice = Number(parsed.competitorAvgPrice)
    if (!Number.isFinite(competitorMinPrice) || !Number.isFinite(competitorAvgPrice)) return null

    const pos = parsed.pricePosition
    const pricePosition =
      pos === 'below' || pos === 'at' || pos === 'above' ? pos : 'at'

    return {
      productId,
      platform,
      competitorMinPrice,
      competitorAvgPrice,
      pricePosition,
      recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : undefined,
    }
  } catch {
    return null
  }
}

export async function runMarketIntel(
  ctx: AgentContext,
  input: MarketIntelRunInput,
): Promise<MarketIntelResult> {
  const runId = randomUUID()
  const platforms = input.platforms ?? ctx.getEnabledPlatforms()
  const maxProducts = input.maxProducts ?? DEFAULT_MAX_PRODUCTS

  await ctx.logAction('market_intel.run.started', { runId, platforms, maxProducts })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('market_intel.budget_exceeded', { runId })
    return { runId, analyzedProducts: 0, insights: [], featuresUpdated: 0 }
  }

  const insights: MarketIntelCompetitorInsight[] = []
  let analyzedProducts = 0
  let featuresUpdated = 0

  for (const platform of platforms) {
    let products: Array<{ id: string; title: string; price: number | null }>
    try {
      products = await ctx.getHarness(platform).getProducts({ limit: maxProducts })
    } catch (err) {
      const code = err instanceof HarnessError ? err.code : 'unknown'
      await ctx.logAction('market_intel.platform_skipped', {
        platform,
        code,
        reason: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    for (const product of products) {
      let features: unknown = null
      if (ctx.dataOS) {
        try {
          features = await ctx.dataOS.getFeatures(platform, product.id)
        } catch {
          await ctx.logAction('market_intel.dataos_degraded', {
            productId: product.id,
            platform,
            op: 'getFeatures',
          })
        }
      }

      let insight: MarketIntelCompetitorInsight | null = null
      try {
        const prompt = buildAnalysisPrompt(product, platform, features)
        const llmResponse = await ctx.llm({
          prompt,
          systemPrompt:
            'You are a market intelligence analyst for e-commerce. Analyze competitor pricing based on the product information. Always respond with valid JSON.',
        })
        insight = parseLlmInsight(llmResponse.text, product.id, platform)
      } catch (err) {
        await ctx.logAction('market_intel.llm_failed', {
          productId: product.id,
          platform,
          message: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      if (!insight) {
        await ctx.logAction('market_intel.parse_failed', {
          productId: product.id,
          platform,
        })
        continue
      }

      analyzedProducts++
      insights.push(insight)

      if (ctx.dataOS) {
        try {
          await ctx.dataOS.upsertFeature({
            platform,
            productId: product.id,
            competitorMinPrice: insight.competitorMinPrice,
            competitorAvgPrice: insight.competitorAvgPrice,
            pricePosition: insight.pricePosition,
          })
          featuresUpdated++
        } catch {
          await ctx.logAction('market_intel.dataos_write_failed', {
            productId: product.id,
            platform,
            op: 'upsertFeature',
          })
        }
      }
    }
  }

  if (ctx.dataOS) {
    try {
      await ctx.dataOS.recordLakeEvent({
        agentId: ctx.agentId,
        eventType: 'market_intel_completed',
        payload: { runId, analyzedProducts, featuresUpdated, insightCount: insights.length },
        metadata: { agentType: 'market-intel', platforms },
      })
    } catch {
      await ctx.logAction('market_intel.dataos_write_failed', { runId, op: 'recordLakeEvent' })
    }
  }

  await ctx.logAction('market_intel.run.completed', {
    runId,
    analyzedProducts,
    featuresUpdated,
    insightCount: insights.length,
  })

  return { runId, analyzedProducts, insights, featuresUpdated }
}
