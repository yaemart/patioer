import { HarnessError } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type {
  MarketIntelCompetitorInsight,
  MarketIntelRunInput,
  MarketIntelResult,
} from '../commerce-types.js'
import { errorMessage } from '../error-message.js'
import { extractFirstJsonObject } from '../extract-json.js'
import { randomRunId } from '../run-id.js'

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

  lines.push(`
Based on market data and your knowledge, estimate competitor pricing.
Respond with valid JSON in this exact shape:
{
  "competitorMinPrice": <number>,
  "competitorAvgPrice": <number>,
  "pricePosition": "below" | "at" | "above",
  "recommendation": "<optional string>"
}`)

  return lines.join('\n')
}

function parseLlmInsight(
  text: string,
  productId: string,
  platform: string,
): MarketIntelCompetitorInsight | null {
  try {
    const jsonMatch = extractFirstJsonObject(text)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch) as Record<string, unknown>

    const competitorMinPrice = Number(parsed.competitorMinPrice)
    const competitorAvgPrice = Number(parsed.competitorAvgPrice)
    if (!Number.isFinite(competitorMinPrice) || competitorMinPrice < 0) return null
    if (!Number.isFinite(competitorAvgPrice) || competitorAvgPrice < 0) return null

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
  const runId = randomRunId()
  const platforms = input.platforms ?? ctx.getEnabledPlatforms()
  const requestedMaxProducts = input.maxProducts ?? DEFAULT_MAX_PRODUCTS
  const maxProducts =
    Number.isFinite(requestedMaxProducts) && requestedMaxProducts > 0
      ? Math.min(requestedMaxProducts, DEFAULT_MAX_PRODUCTS)
      : DEFAULT_MAX_PRODUCTS

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
        reason: errorMessage(err),
      })
      continue
    }

    for (const product of products) {
      let features: unknown = null
      if (ctx.dataOS) {
        try {
          features = await ctx.dataOS.getFeatures(platform, product.id)
        } catch (err) {
          await ctx.logAction('market_intel.dataos_degraded', {
            productId: product.id,
            platform,
            op: 'getFeatures',
            error: errorMessage(err),
          })
        }
      }

      let insight: MarketIntelCompetitorInsight | null
      try {
        const prompt = buildAnalysisPrompt(product, platform, features)
        const dataOsContext = ctx.describeDataOsCapabilities()
        const llmResponse = await ctx.llm({
          prompt,
          systemPrompt: `You are a market intelligence analyst for e-commerce. Analyze competitor pricing based on the product information. Always respond with valid JSON.\n\nData context: ${dataOsContext}`,
        })
        insight = parseLlmInsight(llmResponse.text, product.id, platform)
      } catch (err) {
        await ctx.logAction('market_intel.llm_failed', {
          productId: product.id,
          platform,
          message: errorMessage(err),
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
        } catch (err) {
          await ctx.logAction('market_intel.dataos_write_failed', {
            productId: product.id,
            platform,
            op: 'upsertFeature',
            error: errorMessage(err),
          })
        }
      }
    }
  }

  if (ctx.dataOS) {
    try {
      await ctx.dataOS.recordLakeEvent({
        platform: platforms.length === 1 ? platforms[0] : undefined,
        agentId: ctx.agentId,
        eventType: 'market_intel_completed',
        payload: { runId, analyzedProducts, featuresUpdated, insightCount: insights.length },
        metadata: { agentType: 'market-intel', platforms },
      })
    } catch (err) {
      await ctx.logAction('market_intel.dataos_write_failed', { runId, op: 'recordLakeEvent', error: errorMessage(err) })
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
