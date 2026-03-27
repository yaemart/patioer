import { HarnessError } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type { ContentWriterRunInput, ContentWriterResult } from '../types.js'

const DEFAULT_TONE = 'professional' as const
const DEFAULT_MAX_LENGTH = 2000

function buildGenerationPrompt(
  product: { id: string; title: string; price: number | null },
  features: unknown,
  memories: unknown[],
  tone: ContentWriterRunInput['tone'],
  maxLength: number,
): string {
  const lines: string[] = [
    `Generate e-commerce product content for the following product.`,
    `Product ID: ${product.id}`,
    `Product Title: ${product.title}`,
    `Product Price: $${product.price ?? 'unknown'}`,
  ]

  if (features && typeof features === 'object') {
    lines.push(`\nProduct Features (from Feature Store):`)
    lines.push(JSON.stringify(features, null, 2))
  }

  if (memories.length > 0) {
    lines.push(`\nPrevious content generation examples (from Decision Memory):`)
    for (const m of memories.slice(0, 3)) {
      lines.push(JSON.stringify(m))
    }
  }

  lines.push(`\nTone: ${tone}`)
  lines.push(`Max length: ${maxLength} characters`)
  lines.push(`\nRespond with valid JSON in this exact shape:`)
  lines.push(`{`)
  lines.push(`  "title": "optimized product title",`)
  lines.push(`  "description": "compelling product description",`)
  lines.push(`  "bulletPoints": ["point1", "point2", ...],`)
  lines.push(`  "seoKeywords": ["keyword1", "keyword2", ...]`)
  lines.push(`}`)

  return lines.join('\n')
}

function parseLlmResponse(text: string, productId: string): ContentWriterResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('no JSON object found')
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    return {
      productId,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      bulletPoints: Array.isArray(parsed.bulletPoints)
        ? parsed.bulletPoints.filter((b): b is string => typeof b === 'string')
        : [],
      seoKeywords: Array.isArray(parsed.seoKeywords)
        ? parsed.seoKeywords.filter((k): k is string => typeof k === 'string')
        : [],
    }
  } catch {
    return {
      productId,
      title: text.slice(0, 200),
      description: text,
      bulletPoints: [],
      seoKeywords: [],
    }
  }
}

export async function runContentWriter(
  ctx: AgentContext,
  input: ContentWriterRunInput,
): Promise<ContentWriterResult> {
  const { productId } = input
  const tone = input.tone ?? DEFAULT_TONE
  const maxLength = input.maxLength ?? DEFAULT_MAX_LENGTH
  const platform = input.platform ?? ctx.getEnabledPlatforms()[0] ?? 'shopify'

  await ctx.logAction('content_writer.run.started', { productId, platform, tone, maxLength })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('content_writer.budget_exceeded', { productId })
    return { productId, title: '', description: '', bulletPoints: [], seoKeywords: [] }
  }

  let features: unknown = null
  let memories: unknown[] = []

  if (ctx.dataOS) {
    try {
      features = await ctx.dataOS.getFeatures(platform, productId)
    } catch {
      await ctx.logAction('content_writer.dataos_degraded', { productId, op: 'getFeatures' })
    }
    try {
      memories = (await ctx.dataOS.recallMemory('content-writer', { productId, features })) ?? []
    } catch {
      await ctx.logAction('content_writer.dataos_degraded', { productId, op: 'recallMemory' })
    }
  }

  let product: { id: string; title: string; price: number | null } = {
    id: productId,
    title: productId,
    price: null,
  }

  try {
    const match = await ctx.getHarness(platform).getProduct(productId)
    if (match) {
      product = { id: match.id, title: match.title, price: match.price }
    }
  } catch (err) {
    const code = err instanceof HarnessError ? err.code : 'unknown'
    await ctx.logAction('content_writer.harness_error', {
      type: 'harness_error',
      platform,
      code,
      productId,
      message: err instanceof Error ? err.message : String(err),
    })
  }

  const prompt = buildGenerationPrompt(product, features, memories, tone, maxLength)
  const llmResponse = await ctx.llm({
    prompt,
    systemPrompt: 'You are an expert e-commerce content writer. Generate compelling, SEO-optimized product content. Always respond with valid JSON.',
  })

  const result = parseLlmResponse(llmResponse.text, productId)

  if (ctx.dataOS) {
    try {
      await ctx.dataOS.recordMemory({
        agentId: 'content-writer',
        entityId: productId,
        context: { productId, features, tone },
        action: { title: result.title, description: result.description, bulletPoints: result.bulletPoints },
      })
    } catch {
      await ctx.logAction('content_writer.dataos_write_failed', { productId, op: 'recordMemory' })
    }
    try {
      await ctx.dataOS.recordLakeEvent({
        agentId: ctx.agentId,
        eventType: 'content_generated',
        entityId: productId,
        payload: result,
        metadata: { agentType: 'content-writer', tone },
      })
    } catch {
      await ctx.logAction('content_writer.dataos_write_failed', { productId, op: 'recordLakeEvent' })
    }
  }

  await ctx.logAction('content_writer.run.completed', {
    productId,
    titleLength: result.title.length,
    bulletCount: result.bulletPoints.length,
    keywordCount: result.seoKeywords.length,
  })

  return result
}
