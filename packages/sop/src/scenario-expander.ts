import type { ScenarioTemplate } from './scenario-templates.js'
import { getTemplatesForScenario } from './scenario-templates.js'
import { parseSop } from './sop-parser.js'
import type { LlmExtractFn } from './sop-parser.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpandedSop {
  scope: string
  scenario: string
  sopText: string
  goalContext: Record<string, unknown>
  systemPrompt: string
  governance: Record<string, unknown>
  warnings: string[]
}

export interface ScenarioExpandOptions {
  scenario: string
  tenantOverrides?: Record<string, Record<string, unknown>>
  llmExtract?: LlmExtractFn
}

export interface ScenarioExpandResult {
  scenario: string
  expandedSops: ExpandedSop[]
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Merge seller overrides into template goalContext while respecting locked fields.
 */
function mergeGoalContext(
  template: ScenarioTemplate,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides) return { ...template.defaultGoalContext }

  const merged = { ...template.defaultGoalContext }
  const lockedSet = new Set(template.lockedFields)

  for (const [key, value] of Object.entries(overrides)) {
    if (lockedSet.has(key)) continue
    if (template.editableFields.length > 0 && !template.editableFields.includes(key)) continue
    merged[key] = value
  }

  return merged
}

/**
 * Build the effective SOP text by appending seller customizations to the default.
 */
function buildEffectiveSopText(
  template: ScenarioTemplate,
  mergedGoalContext: Record<string, unknown>,
): string {
  const diffs: string[] = []

  for (const [key, value] of Object.entries(mergedGoalContext)) {
    const defaultValue = template.defaultGoalContext[key]
    if (defaultValue !== undefined && defaultValue !== value) {
      diffs.push(`${key}: ${JSON.stringify(value)}`)
    }
  }

  if (diffs.length === 0) return template.defaultSopText

  return `${template.defaultSopText}\n\n[Seller customisation: ${diffs.join(', ')}]`
}

/**
 * Expand a scenario into individual SOPs for each agent scope.
 *
 * Flow: template → merge overrides (locked_fields protected) → SOP Parser → ExpandedSop[]
 */
export async function expandScenario(
  options: ScenarioExpandOptions,
): Promise<ScenarioExpandResult> {
  const templates = getTemplatesForScenario(options.scenario)

  if (templates.length === 0) {
    return { scenario: options.scenario, expandedSops: [] }
  }

  const expandedSops: ExpandedSop[] = []

  for (const template of templates) {
    const scopeOverrides = options.tenantOverrides?.[template.scope]
    const mergedGoalContext = mergeGoalContext(template, scopeOverrides)
    const effectiveSopText = buildEffectiveSopText(template, mergedGoalContext)

    const parseResult = await parseSop({
      scope: template.scope,
      sopText: effectiveSopText,
      llmExtract: options.llmExtract,
    })

    const finalGoalContext = {
      ...parseResult.goalContext,
      ...mergedGoalContext,
    }

    expandedSops.push({
      scope: template.scope,
      scenario: options.scenario,
      sopText: effectiveSopText,
      goalContext: finalGoalContext,
      systemPrompt: parseResult.systemPrompt,
      governance: parseResult.governance,
      warnings: parseResult.warnings,
    })
  }

  return { scenario: options.scenario, expandedSops }
}

export { mergeGoalContext as _mergeGoalContext }
