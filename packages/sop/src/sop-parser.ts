import type { AgentExtractionSchema, ExtractionFieldDef } from './extraction-schemas.js'
import { getExtractionSchema } from './extraction-schemas.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SopParseResult {
  goalContext: Record<string, unknown>
  systemPrompt: string
  governance: Record<string, unknown>
  warnings: string[]
}

export interface SopParseOptions {
  scope: string
  sopText: string
  llmExtract?: LlmExtractFn
}

/**
 * Pluggable LLM extraction function.
 * Given a prompt string, returns the raw JSON string from the LLM.
 * In production this calls OpenAI / Anthropic; in tests it's mocked.
 */
export type LlmExtractFn = (prompt: string) => Promise<string>

// ---------------------------------------------------------------------------
// Safety — reject prompt-injection / constitution-override attempts
// ---------------------------------------------------------------------------

const BLOCKED_PATTERNS: RegExp[] = [
  /忽略以上规则/i,
  /取消所有审批/i,
  /override\s+constitution/i,
  /ignore\s+(all\s+)?(previous|above|prior)\s+(rules|instructions|constraints)/i,
  /disable\s+(all\s+)?approvals?/i,
  /bypass\s+(all\s+)?guard(s|rails)?/i,
  /system\s*:\s*/i,
  /\bassistant\s*:\s*/i,
  /remove\s+all\s+limits/i,
  /no\s+human\s+review/i,
]

export class SopSafetyError extends Error {
  constructor(public readonly pattern: string) {
    super(`SOP rejected: contains blocked pattern "${pattern}"`)
    this.name = 'SopSafetyError'
  }
}

export function checkSopSafety(sopText: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sopText)) {
      throw new SopSafetyError(pattern.source)
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildExtractionPrompt(schema: AgentExtractionSchema, sopText: string): string {
  const fieldDocs = schema.fields
    .map((f) => {
      const parts = [`- "${f.key}" (${f.type}): ${f.description}`]
      if (f.min !== undefined) parts.push(`  min: ${f.min}`)
      if (f.max !== undefined) parts.push(`  max: ${f.max}`)
      if (f.enum) parts.push(`  allowed: ${JSON.stringify(f.enum)}`)
      if (f.default !== undefined) parts.push(`  default: ${JSON.stringify(f.default)}`)
      return parts.join('\n')
    })
    .join('\n')

  return `You are a structured parameter extraction engine for the "${schema.displayName}" agent.

Given the seller's operating procedure (SOP) text below, extract structured parameters into three sections:

1. **goalContext** (JSON object): Extract values for these fields:
${fieldDocs}
Only include fields that are explicitly or clearly implied by the SOP text. Do not guess.

2. **systemPrompt** (string): Any behavioral guidance from the SOP that cannot be captured as a structured parameter. This becomes the agent's behavioral instruction. If there is nothing beyond what the structured fields capture, return an empty string.

3. **governance** (JSON object): Any overrides for governance settings the SOP implies:
- "priceChangeThreshold" (number 5-30): approval threshold for price changes
- "adsBudgetApproval" (number): USD threshold for ad budget approval
- "newListingApproval" (boolean): whether new listings need approval
Only include fields the SOP explicitly mentions.

4. **warnings** (string array): Anything in the SOP that could not be mapped to any known parameter. Each warning should describe what was not mappable.

Respond ONLY with valid JSON in this exact shape:
{
  "goalContext": { ... },
  "systemPrompt": "...",
  "governance": { ... },
  "warnings": ["..."]
}

SOP Text:
"""
${sopText}
"""`
}

// ---------------------------------------------------------------------------
// Response parser & validator
// ---------------------------------------------------------------------------

function validateField(key: string, value: unknown, def: ExtractionFieldDef): unknown {
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n)) return undefined
      if (def.min !== undefined && n < def.min) return def.min
      if (def.max !== undefined && n > def.max) return def.max
      return n
    }
    case 'string': {
      const s = String(value ?? '')
      if (def.enum && !def.enum.includes(s)) return undefined
      return s || undefined
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'string[]': {
      if (!Array.isArray(value)) return undefined
      return value.filter((v): v is string => typeof v === 'string')
    }
    default: {
      const _exhaustive: never = def.type
      throw new Error(`Unknown field type: ${_exhaustive}`)
    }
  }
}

function validateGoalContext(
  raw: Record<string, unknown>,
  schema: AgentExtractionSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of schema.fields) {
    if (field.key in raw) {
      const validated = validateField(field.key, raw[field.key], field)
      if (validated !== undefined) {
        result[field.key] = validated
      }
    }
  }
  return result
}

/**
 * Whitelist-validate governance overrides, clamping numeric values to safe ranges.
 * Only known governance keys pass through; unknown keys are silently dropped.
 */
function validateGovernance(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (typeof raw.priceChangeThreshold === 'number' && Number.isFinite(raw.priceChangeThreshold)) {
    result.priceChangeThreshold = Math.min(30, Math.max(5, raw.priceChangeThreshold))
  }
  if (typeof raw.adsBudgetApproval === 'number' && Number.isFinite(raw.adsBudgetApproval)) {
    result.adsBudgetApproval = Math.min(2000, Math.max(100, raw.adsBudgetApproval))
  }
  if (typeof raw.newListingApproval === 'boolean') {
    result.newListingApproval = raw.newListingApproval
  }

  return result
}

// ---------------------------------------------------------------------------
// Default local extraction (no LLM — rule-based fallback)
// ---------------------------------------------------------------------------

const NUMBER_PATTERNS: Array<{ keys: string[]; pattern: RegExp }> = [
  { keys: ['minMarginPercent', 'approvalThresholdPercent'], pattern: /(?:最低|最小|最少|minimum|min)?\s*(?:利润率|利润|margin|profit)\s*(?:率|rate)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/i },
  { keys: ['targetRoas'], pattern: /(?:ROAS|roas)\s*[:=]?\s*(\d+(?:\.\d+)?)/i },
  { keys: ['safetyThreshold'], pattern: /(?:安全库存|safety\s*(?:stock|threshold))\s*[:=]?\s*(\d+)/i },
  { keys: ['maxProducts'], pattern: /(?:最多|max|maximum)\s*(?:商品|products?)\s*[:=]?\s*(\d+)/i },
  { keys: ['maxDailyBudgetUsd'], pattern: /(?:日(?:预算|限额)|daily\s*budget)\s*[:=]?\s*\$?\s*(\d+(?:\.\d+)?)/i },
  { keys: ['maxUndercutPercent'], pattern: /(?:低于|undercut)\s*(?:竞品|竞争|competitor)?\s*(\d+(?:\.\d+)?)\s*%/i },
]

const STRATEGY_KEYWORDS: Record<string, Record<string, string>> = {
  pricingStrategy: {
    '激进': 'aggressive-match',
    'aggressive': 'aggressive-match',
    '防守': 'defensive',
    '守利润': 'defensive',
    'defensive': 'defensive',
    'defend': 'defensive',
    '平衡': 'balanced',
    'balanced': 'balanced',
  },
  adsStrategy: {
    '高预算': 'aggressive-growth',
    'aggressive': 'aggressive-growth',
    '精准': 'precision-targeting',
    'precision': 'precision-targeting',
    '品牌词': 'brand-only',
    'brand': 'brand-only',
    '停广告': 'brand-only',
    '平衡': 'balanced',
    'balanced': 'balanced',
  },
  inventoryStrategy: {
    '快补': 'aggressive-restock',
    'aggressive': 'aggressive-restock',
    '不补货': 'drain-only',
    '消库存': 'drain-only',
    'drain': 'drain-only',
    '保守': 'conservative',
    'conservative': 'conservative',
    '平衡': 'balanced',
    'balanced': 'balanced',
  },
}

function extractLocally(sopText: string, schema: AgentExtractionSchema): SopParseResult {
  const goalContext: Record<string, unknown> = {}
  const warnings: string[] = []
  let systemPrompt = ''
  const governance: Record<string, unknown> = {}
  const lower = sopText.toLowerCase()

  const schemaKeys = new Set(schema.fields.map((f) => f.key))

  for (const { keys, pattern } of NUMBER_PATTERNS) {
    const match = sopText.match(pattern)
    if (match?.[1]) {
      for (const key of keys) {
        if (schemaKeys.has(key)) {
          goalContext[key] = Number(match[1])
        }
      }
    }
  }

  for (const [fieldKey, keywords] of Object.entries(STRATEGY_KEYWORDS)) {
    if (!schemaKeys.has(fieldKey)) continue
    for (const [keyword, value] of Object.entries(keywords)) {
      if (lower.includes(keyword.toLowerCase())) {
        goalContext[fieldKey] = value
        break
      }
    }
  }

  const adsBudgetMatch = sopText.match(/审批.*?(\d+)\s*(?:美元|\$|usd)/i)
  if (adsBudgetMatch?.[1]) governance['adsBudgetApproval'] = Number(adsBudgetMatch[1])
  if (/(?:新品|new\s*listing).*(?:无需审批|不需要审批|skip|no)\s*(?:审批|approval)/i.test(sopText)) {
    governance['newListingApproval'] = false
  }
  if (/(?:新品|new\s*listing).*(?:需要|require|must).*(?:审批|approval)/i.test(sopText)) {
    governance['newListingApproval'] = true
  }

  const sentences = sopText.split(/[。\n.;；]/).map((s) => s.trim()).filter(Boolean)
  const unmapped: string[] = []
  for (const sentence of sentences) {
    let mapped = false
    for (const { pattern } of NUMBER_PATTERNS) {
      if (pattern.test(sentence)) { mapped = true; break }
    }
    if (!mapped) {
      for (const keywords of Object.values(STRATEGY_KEYWORDS)) {
        for (const keyword of Object.keys(keywords)) {
          if (sentence.toLowerCase().includes(keyword.toLowerCase())) { mapped = true; break }
        }
        if (mapped) break
      }
    }
    if (!mapped && sentence.length > 5) {
      unmapped.push(sentence)
    }
  }

  if (unmapped.length > 0) {
    systemPrompt = unmapped.join('. ')
    for (const u of unmapped) {
      if (u.length > 20) {
        warnings.push(`Could not map to structured parameter: "${u.slice(0, 80)}"`)
      }
    }
  }

  const validated = validateGoalContext(goalContext, schema)
  return { goalContext: validated, systemPrompt, governance: validateGovernance(governance), warnings }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseSop(options: SopParseOptions): Promise<SopParseResult> {
  checkSopSafety(options.sopText)

  const schema = getExtractionSchema(options.scope)
  if (!schema) {
    return {
      goalContext: {},
      systemPrompt: options.sopText,
      governance: {},
      warnings: [`No extraction schema for scope "${options.scope}"; full text passed as systemPrompt`],
    }
  }

  if (!options.llmExtract) {
    return extractLocally(options.sopText, schema)
  }

  const prompt = buildExtractionPrompt(schema, options.sopText)
  const raw = await options.llmExtract(prompt)

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {
      goalContext: {},
      systemPrompt: options.sopText,
      governance: {},
      warnings: ['LLM returned invalid JSON; falling back to full text as systemPrompt'],
    }
  }

  const rawGoalContext = (parsed.goalContext ?? {}) as Record<string, unknown>
  const goalContext = validateGoalContext(rawGoalContext, schema)

  const rawGov = (typeof parsed.governance === 'object' && parsed.governance !== null)
    ? parsed.governance as Record<string, unknown>
    : {}

  return {
    goalContext,
    systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
    governance: validateGovernance(rawGov),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  }
}

export { buildExtractionPrompt }
