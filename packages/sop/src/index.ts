export { resolveSop } from './sop-resolver.js'
export type { SopRecord, ResolvedSop, SopResolutionContext } from './types.js'

export { parseSop, checkSopSafety, SopSafetyError, buildExtractionPrompt } from './sop-parser.js'
export type { SopParseResult, SopParseOptions, LlmExtractFn } from './sop-parser.js'

export {
  getExtractionSchema,
  ALL_EXTRACTION_SCHEMAS,
  PRICE_SENTINEL_SCHEMA,
  ADS_OPTIMIZER_SCHEMA,
  INVENTORY_GUARD_SCHEMA,
  PRODUCT_SCOUT_SCHEMA,
} from './extraction-schemas.js'
export type { AgentExtractionSchema, ExtractionFieldDef } from './extraction-schemas.js'

export {
  ALL_SCENARIO_TEMPLATES,
  SCENARIOS,
  TEMPLATE_SCOPES,
  getTemplate,
  getTemplatesForScenario,
} from './scenario-templates.js'
export type { ScenarioTemplate, Scenario } from './scenario-templates.js'

export { expandScenario } from './scenario-expander.js'
export type { ExpandedSop, ScenarioExpandOptions, ScenarioExpandResult } from './scenario-expander.js'
