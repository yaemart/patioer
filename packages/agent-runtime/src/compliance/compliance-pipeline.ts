/**
 * CompliancePipeline — Multi-market product compliance checker (Phase 4 §S12 tasks 12.2–12.5)
 *
 * Runs a sequence of checks for a given market:
 *  1. Prohibited keyword scan (title + description)
 *  2. Category restriction validation
 *  3. Certification requirements verification
 *  4. HS Code risk assessment
 *  5. AI content review (LLM-based, optional)
 *
 * Returns a ComplianceCheckResult per market, and can auto-create compliance Tickets.
 *
 * AC-P4-17: ID market Halal certification detection
 * AC-P4-18: Prohibited product auto-block + compliance Ticket creation
 */

import type { AgentContext } from '../context.js'
import { extractFirstJsonObject } from '../extract-json.js'
import type {
  ComplianceCheckResult,
  ComplianceMarket,
  ComplianceProductInput,
  ComplianceSeverity,
  ComplianceViolation,
} from './prohibited-keywords.js'
import {
  CATEGORY_RESTRICTIONS,
  HS_CODE_RISKS,
  PROHIBITED_KEYWORDS,
} from './prohibited-keywords.js'

// ─── 1. Prohibited Keyword Check ──────────────────────────────────────────────

export function checkProhibitedKeywords(
  product: ComplianceProductInput,
  market: ComplianceMarket,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  const keywords = PROHIBITED_KEYWORDS[market]

  const searchableFields: Array<{ field: string; value: string }> = [
    { field: 'title', value: product.title },
    { field: 'description', value: product.description },
  ]

  if (product.tags) {
    searchableFields.push({ field: 'tags', value: product.tags.join(' ') })
  }

  for (const entry of keywords) {
    const kw = entry.keyword.toLowerCase()
    for (const { field, value } of searchableFields) {
      if (value.toLowerCase().includes(kw)) {
        violations.push({
          market,
          checkType: 'prohibited_keyword',
          severity: entry.severity,
          field,
          matchedValue: entry.keyword,
          rule: entry.reason,
          suggestion: entry.severity === 'block'
            ? `Remove or replace "${entry.keyword}" — this product cannot be listed in ${market}`
            : `Review "${entry.keyword}" usage — may require special labeling or certification in ${market}`,
        })
      }
    }
  }

  return violations
}

// ─── 2. Category Restriction Check ────────────────────────────────────────────

export function checkCategoryRestrictions(
  product: ComplianceProductInput,
  market: ComplianceMarket,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  const restrictions = CATEGORY_RESTRICTIONS[market]

  if (!product.category) return violations

  const productCategory = product.category.toLowerCase()

  for (const restriction of restrictions) {
    if (productCategory.includes(restriction.category)) {
      const severity: ComplianceSeverity = restriction.restriction === 'prohibited' ? 'block' : 'warn'
      violations.push({
        market,
        checkType: 'category_restriction',
        severity,
        field: 'category',
        matchedValue: product.category,
        rule: restriction.reason,
        suggestion: restriction.certificationName
          ? `Ensure ${restriction.certificationName} certification is obtained before listing in ${market}`
          : `Category "${product.category}" is restricted in ${market}`,
      })
    }
  }

  return violations
}

// ─── 3. Certification Requirements Check (AC-P4-17: Halal) ────────────────────

export function checkCertificationRequirements(
  product: ComplianceProductInput,
  market: ComplianceMarket,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []
  const restrictions = CATEGORY_RESTRICTIONS[market]

  if (!product.category) return violations

  const productCategory = product.category.toLowerCase()
  const productCerts = new Set((product.certifications ?? []).map((c) => c.toLowerCase()))

  for (const restriction of restrictions) {
    if (!productCategory.includes(restriction.category)) continue
    if (restriction.restriction !== 'requires_certification' || !restriction.certificationName) continue

    const requiredCert = restriction.certificationName.toLowerCase()

    if (!productCerts.has(requiredCert)) {
      violations.push({
        market,
        checkType: 'certification_missing',
        severity: 'block',
        field: 'certifications',
        matchedValue: restriction.certificationName,
        rule: restriction.reason,
        suggestion: `Missing ${restriction.certificationName} certification — required for "${product.category}" in ${market}`,
      })
    }
  }

  return violations
}

// ─── 4. HS Code Risk Assessment ───────────────────────────────────────────────

export function checkHSCode(
  product: ComplianceProductInput,
  market: ComplianceMarket,
): ComplianceViolation[] {
  const violations: ComplianceViolation[] = []

  if (!product.hsCode) return violations

  for (const risk of HS_CODE_RISKS) {
    if (!product.hsCode.startsWith(risk.prefix)) continue

    if (risk.severity === 'block') {
      violations.push({
        market,
        checkType: 'hs_code',
        severity: 'block',
        field: 'hsCode',
        matchedValue: product.hsCode,
        rule: `HS ${risk.prefix}: ${risk.description} — prohibited`,
      })
      continue
    }

    const productCerts = new Set((product.certifications ?? []).map((c) => c.toLowerCase()))
    const missingCerts = risk.requiredCerts.filter((c) => !productCerts.has(c.toLowerCase()))

    if (missingCerts.length > 0) {
      violations.push({
        market,
        checkType: 'hs_code',
        severity: risk.severity,
        field: 'hsCode',
        matchedValue: product.hsCode,
        rule: `HS ${risk.prefix} (${risk.description}) may require: ${missingCerts.join(', ')}`,
        suggestion: `Verify ${missingCerts.join(', ')} certification for HS code ${product.hsCode} in ${market}`,
      })
    }
  }

  return violations
}

// ─── 5. AI Content Review (LLM-based) ─────────────────────────────────────────

const AI_REVIEW_SYSTEM_PROMPT =
  'You are a product compliance reviewer for cross-border e-commerce. ' +
  'Analyze the product listing for potential compliance issues in the given market. ' +
  'Respond ONLY with a JSON object: { "issues": [{ "field": string, "issue": string, "severity": "block"|"warn"|"info" }] }. ' +
  'If no issues, return { "issues": [] }.'

interface AiReviewIssue {
  field: string
  issue: string
  severity: ComplianceSeverity
}

export async function aiContentReview(
  product: ComplianceProductInput,
  market: ComplianceMarket,
  llm: (params: { prompt: string; systemPrompt?: string }) => Promise<{ text: string }>,
): Promise<ComplianceViolation[]> {
  const prompt =
    `Market: ${market}\n` +
    `Product title: ${product.title}\n` +
    `Description: ${product.description}\n` +
    `Category: ${product.category ?? 'unknown'}\n` +
    `Tags: ${(product.tags ?? []).join(', ')}\n` +
    `HS Code: ${product.hsCode ?? 'N/A'}\n` +
    `Certifications: ${(product.certifications ?? []).join(', ') || 'none'}\n\n` +
    `Review this listing for ${market} market compliance issues.`

  const response = await llm({ prompt, systemPrompt: AI_REVIEW_SYSTEM_PROMPT })
  const jsonStr = extractFirstJsonObject(response.text)
  if (!jsonStr) return []

  let parsed: { issues?: unknown[] }
  try {
    parsed = JSON.parse(jsonStr) as { issues?: unknown[] }
  } catch {
    return []
  }

  if (!Array.isArray(parsed.issues)) return []

  return (parsed.issues as AiReviewIssue[])
    .filter((i): i is AiReviewIssue =>
      typeof i.field === 'string' &&
      typeof i.issue === 'string' &&
      (i.severity === 'block' || i.severity === 'warn' || i.severity === 'info'),
    )
    .map((issue) => ({
      market,
      checkType: 'ai_content' as const,
      severity: issue.severity,
      field: issue.field,
      matchedValue: issue.issue,
      rule: `AI review: ${issue.issue}`,
    }))
}

// ─── CompliancePipeline — Orchestrator ────────────────────────────────────────

export interface CompliancePipelineOptions {
  enableAiReview?: boolean
}

export async function runComplianceCheck(
  product: ComplianceProductInput,
  market: ComplianceMarket,
  ctx: AgentContext,
  options: CompliancePipelineOptions = {},
): Promise<ComplianceCheckResult> {
  const violations: ComplianceViolation[] = []

  violations.push(...checkProhibitedKeywords(product, market))
  violations.push(...checkCategoryRestrictions(product, market))
  violations.push(...checkCertificationRequirements(product, market))
  violations.push(...checkHSCode(product, market))

  if (options.enableAiReview) {
    try {
      const aiViolations = await aiContentReview(product, market, ctx.llm.bind(ctx))
      violations.push(...aiViolations)
    } catch {
      await ctx.logAction('compliance.ai_review_degraded', {
        productId: product.productId,
        market,
      })
    }
  }

  const hasBlocking = violations.some((v) => v.severity === 'block')

  if (violations.length > 0) {
    const blockCount = violations.filter((v) => v.severity === 'block').length
    const warnCount = violations.filter((v) => v.severity === 'warn').length

    await ctx.createTicket({
      title: `[Compliance] ${market}: ${product.title} — ${blockCount} block, ${warnCount} warn`,
      body: formatViolationsForTicket(product, market, violations),
    })

    await ctx.logAction('compliance.ticket_created', {
      productId: product.productId,
      market,
      violationCount: violations.length,
      blockCount,
      warnCount,
    })
  }

  return {
    passed: !hasBlocking,
    violations,
    market,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Run compliance checks across multiple markets.
 * Returns results per market, with tickets auto-created for violations.
 */
export async function runMultiMarketCompliance(
  product: ComplianceProductInput,
  markets: readonly ComplianceMarket[],
  ctx: AgentContext,
  options: CompliancePipelineOptions = {},
): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = []

  for (const market of markets) {
    const result = await runComplianceCheck(product, market, ctx, options)
    results.push(result)
  }

  await ctx.logAction('compliance.multi_market_completed', {
    productId: product.productId,
    markets: markets.slice(),
    allPassed: results.every((r) => r.passed),
    totalViolations: results.reduce((sum, r) => sum + r.violations.length, 0),
  })

  return results
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatViolationsForTicket(
  product: ComplianceProductInput,
  market: ComplianceMarket,
  violations: ComplianceViolation[],
): string {
  const lines = [
    `**Product:** ${product.title} (${product.productId})`,
    `**Market:** ${market}`,
    `**Category:** ${product.category ?? 'N/A'}`,
    `**HS Code:** ${product.hsCode ?? 'N/A'}`,
    '',
    `### Violations (${violations.length})`,
    '',
  ]

  for (const v of violations) {
    const icon = v.severity === 'block' ? '🚫' : v.severity === 'warn' ? '⚠️' : 'ℹ️'
    lines.push(`- ${icon} **[${v.severity.toUpperCase()}]** \`${v.field}\`: ${v.rule}`)
    if (v.suggestion) lines.push(`  → ${v.suggestion}`)
  }

  return lines.join('\n')
}
