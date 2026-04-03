/**
 * Per-agent extraction schemas define which structured parameters
 * the SOP Parser can extract from natural language seller instructions.
 *
 * Each field has: key, type, description (for the LLM), and optional
 * validation constraints. The parser uses these to build the extraction prompt
 * and validate the LLM response.
 */

export interface ExtractionFieldDef {
  key: string
  type: 'number' | 'string' | 'boolean' | 'string[]'
  description: string
  min?: number
  max?: number
  enum?: string[]
  default?: unknown
}

export interface AgentExtractionSchema {
  scope: string
  displayName: string
  fields: ExtractionFieldDef[]
}

export const PRICE_SENTINEL_SCHEMA: AgentExtractionSchema = {
  scope: 'price-sentinel',
  displayName: 'Price Sentinel',
  fields: [
    {
      key: 'approvalThresholdPercent',
      type: 'number',
      description: 'Price change percentage threshold above which human approval is required',
      min: 0,
      max: 100,
      default: 15,
    },
    {
      key: 'pricingStrategy',
      type: 'string',
      description: 'Overall pricing strategy: aggressive-match (undercut competitors), defensive (protect margin), balanced (grow + protect)',
      enum: ['aggressive-match', 'defensive', 'balanced'],
      default: 'balanced',
    },
    {
      key: 'minMarginPercent',
      type: 'number',
      description: 'Minimum acceptable contribution margin percentage. Agent will not price below this floor.',
      min: 0,
      max: 100,
      default: 15,
    },
    {
      key: 'maxUndercutPercent',
      type: 'number',
      description: 'Maximum percentage to undercut competitors by',
      min: 0,
      max: 50,
    },
  ],
}

export const ADS_OPTIMIZER_SCHEMA: AgentExtractionSchema = {
  scope: 'ads-optimizer',
  displayName: 'Ads Optimizer',
  fields: [
    {
      key: 'targetRoas',
      type: 'number',
      description: 'Target Return On Ad Spend. Higher = more conservative. Default 3x.',
      min: 0.5,
      max: 50,
      default: 3,
    },
    {
      key: 'adsStrategy',
      type: 'string',
      description: 'Overall advertising strategy',
      enum: ['aggressive-growth', 'precision-targeting', 'brand-only', 'balanced'],
      default: 'balanced',
    },
    {
      key: 'maxDailyBudgetUsd',
      type: 'number',
      description: 'Maximum daily ad spend in USD. Agent will not exceed this.',
      min: 0,
    },
    {
      key: 'pauseNonPerforming',
      type: 'boolean',
      description: 'Whether to automatically pause campaigns with ROAS below threshold',
      default: true,
    },
  ],
}

export const INVENTORY_GUARD_SCHEMA: AgentExtractionSchema = {
  scope: 'inventory-guard',
  displayName: 'Inventory Guard',
  fields: [
    {
      key: 'safetyThreshold',
      type: 'number',
      description: 'Safety stock threshold in units. Alert when stock falls below this.',
      min: 1,
      default: 10,
    },
    {
      key: 'replenishApprovalMinUnits',
      type: 'number',
      description: 'Minimum reorder quantity in units that triggers human approval',
      min: 1,
      default: 50,
    },
    {
      key: 'inventoryStrategy',
      type: 'string',
      description: 'Replenishment strategy',
      enum: ['aggressive-restock', 'conservative', 'drain-only', 'balanced'],
      default: 'balanced',
    },
    {
      key: 'timeZone',
      type: 'string',
      description: 'IANA timezone for scheduling inventory checks (e.g. America/Los_Angeles)',
      default: 'UTC',
    },
    {
      key: 'enforceDailyWindow',
      type: 'boolean',
      description: 'Only run inventory checks during a specific daily window',
      default: false,
    },
  ],
}

export const PRODUCT_SCOUT_SCHEMA: AgentExtractionSchema = {
  scope: 'product-scout',
  displayName: 'Product Scout',
  fields: [
    {
      key: 'maxProducts',
      type: 'number',
      description: 'Maximum number of products to scout per run',
      min: 1,
      max: 500,
      default: 50,
    },
    {
      key: 'complianceMarkets',
      type: 'string[]',
      description: 'Markets to check for compliance (e.g. ["US","EU","UK"])',
    },
  ],
}

export const ALL_EXTRACTION_SCHEMAS: AgentExtractionSchema[] = [
  PRICE_SENTINEL_SCHEMA,
  ADS_OPTIMIZER_SCHEMA,
  INVENTORY_GUARD_SCHEMA,
  PRODUCT_SCOUT_SCHEMA,
]

export function getExtractionSchema(scope: string): AgentExtractionSchema | null {
  return ALL_EXTRACTION_SCHEMAS.find((s) => s.scope === scope) ?? null
}
