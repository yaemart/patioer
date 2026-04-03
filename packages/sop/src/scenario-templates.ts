/**
 * 12 system-provided scenario templates: 4 scenarios × 3 agents.
 *
 * Each template is a pre-configured SOP blueprint that sellers can adopt
 * as-is or customise within the bounds of `editableFields` / `lockedFields`.
 */

export interface ScenarioTemplate {
  scenario: string
  scope: string
  platform: string | null
  defaultSopText: string
  defaultGoalContext: Record<string, unknown>
  editableFields: string[]
  lockedFields: string[]
}

// ---------------------------------------------------------------------------
// launch — 新品上架期
// ---------------------------------------------------------------------------

const LAUNCH_PRICE_SENTINEL: ScenarioTemplate = {
  scenario: 'launch',
  scope: 'price-sentinel',
  platform: null,
  defaultSopText:
    '新品上架期：激进跟价，允许低于竞品 5-10%，最低利润率 5%。' +
    '快速获取销量和评价排名，前 30 天以 GMV 增长为首要目标。',
  defaultGoalContext: {
    pricingStrategy: 'aggressive-match',
    minMarginPercent: 5,
    maxUndercutPercent: 10,
    approvalThresholdPercent: 20,
  },
  editableFields: ['minMarginPercent', 'maxUndercutPercent', 'approvalThresholdPercent'],
  lockedFields: ['pricingStrategy'],
}

const LAUNCH_ADS_OPTIMIZER: ScenarioTemplate = {
  scenario: 'launch',
  scope: 'ads-optimizer',
  platform: null,
  defaultSopText:
    '新品上架期：高预算宽匹配，目标 ROAS 2，快速获取流量曝光。' +
    '允许 ACoS 较高以换取市场份额。自动竞价不设上限但需审批。',
  defaultGoalContext: {
    targetRoas: 2,
    adsStrategy: 'aggressive-growth',
    pauseNonPerforming: false,
  },
  editableFields: ['targetRoas', 'maxDailyBudgetUsd'],
  lockedFields: ['adsStrategy'],
}

const LAUNCH_INVENTORY_GUARD: ScenarioTemplate = {
  scenario: 'launch',
  scope: 'inventory-guard',
  platform: null,
  defaultSopText:
    '新品上架期：小批量快补策略，安全库存 15 件，最小补货审批 20 件。' +
    '密切监控断货风险，宁可多补不可断货。',
  defaultGoalContext: {
    safetyThreshold: 15,
    replenishApprovalMinUnits: 20,
    inventoryStrategy: 'aggressive-restock',
    enforceDailyWindow: false,
  },
  editableFields: ['safetyThreshold', 'replenishApprovalMinUnits'],
  lockedFields: ['inventoryStrategy'],
}

// ---------------------------------------------------------------------------
// defend — 利润防守期
// ---------------------------------------------------------------------------

const DEFEND_PRICE_SENTINEL: ScenarioTemplate = {
  scenario: 'defend',
  scope: 'price-sentinel',
  platform: null,
  defaultSopText:
    '利润防守期：守利润底线，最低利润率 15%，调价幅度超过 10% 必须审批。' +
    '不主动降价跟竞品，除非竞品价格持续 7 天低于我方。',
  defaultGoalContext: {
    pricingStrategy: 'defensive',
    minMarginPercent: 15,
    approvalThresholdPercent: 10,
  },
  editableFields: ['minMarginPercent', 'approvalThresholdPercent'],
  lockedFields: ['pricingStrategy'],
}

const DEFEND_ADS_OPTIMIZER: ScenarioTemplate = {
  scenario: 'defend',
  scope: 'ads-optimizer',
  platform: null,
  defaultSopText:
    '利润防守期：精准投放控浪费，目标 ROAS 5，只投高转化关键词。' +
    '暂停 ACoS > 40% 的广告活动，聚焦长尾精准词。',
  defaultGoalContext: {
    targetRoas: 5,
    adsStrategy: 'precision-targeting',
    pauseNonPerforming: true,
  },
  editableFields: ['targetRoas', 'maxDailyBudgetUsd'],
  lockedFields: ['adsStrategy', 'pauseNonPerforming'],
}

const DEFEND_INVENTORY_GUARD: ScenarioTemplate = {
  scenario: 'defend',
  scope: 'inventory-guard',
  platform: null,
  defaultSopText:
    '利润防守期：正常补货节奏，安全库存 10 件，标准审批门槛 50 件。' +
    '按销售速度自动计算补货量，不做激进库存投资。',
  defaultGoalContext: {
    safetyThreshold: 10,
    replenishApprovalMinUnits: 50,
    inventoryStrategy: 'balanced',
    enforceDailyWindow: true,
  },
  editableFields: ['safetyThreshold', 'replenishApprovalMinUnits', 'timeZone'],
  lockedFields: ['inventoryStrategy'],
}

// ---------------------------------------------------------------------------
// clearance — 清仓期
// ---------------------------------------------------------------------------

const CLEARANCE_PRICE_SENTINEL: ScenarioTemplate = {
  scenario: 'clearance',
  scope: 'price-sentinel',
  platform: null,
  defaultSopText:
    '清仓期：低于成本也可出售，最低利润率 -20%（允许亏损清货）。' +
    '大幅降价自动执行，无需逐条审批，但单次降价超过 30% 仍需确认。',
  defaultGoalContext: {
    pricingStrategy: 'aggressive-match',
    minMarginPercent: -20,
    approvalThresholdPercent: 30,
    maxUndercutPercent: 30,
  },
  editableFields: ['minMarginPercent', 'approvalThresholdPercent', 'maxUndercutPercent'],
  lockedFields: ['pricingStrategy'],
}

const CLEARANCE_ADS_OPTIMIZER: ScenarioTemplate = {
  scenario: 'clearance',
  scope: 'ads-optimizer',
  platform: null,
  defaultSopText:
    '清仓期：停止自动广告，仅保留品牌词防御性投放。' +
    '日预算降至最低，不再追求 ROAS。',
  defaultGoalContext: {
    targetRoas: 1,
    adsStrategy: 'brand-only',
    pauseNonPerforming: true,
    maxDailyBudgetUsd: 10,
  },
  editableFields: ['maxDailyBudgetUsd'],
  lockedFields: ['adsStrategy', 'pauseNonPerforming'],
}

const CLEARANCE_INVENTORY_GUARD: ScenarioTemplate = {
  scenario: 'clearance',
  scope: 'inventory-guard',
  platform: null,
  defaultSopText:
    '清仓期：不补货，消化现有库存。安全库存设为 0，补货审批门槛设极高。' +
    '目标是尽快卖完所有库存。',
  defaultGoalContext: {
    safetyThreshold: 0,
    replenishApprovalMinUnits: 99999,
    inventoryStrategy: 'drain-only',
    enforceDailyWindow: false,
  },
  editableFields: [],
  lockedFields: ['inventoryStrategy', 'safetyThreshold', 'replenishApprovalMinUnits'],
}

// ---------------------------------------------------------------------------
// daily — 日常运营期
// ---------------------------------------------------------------------------

const DAILY_PRICE_SENTINEL: ScenarioTemplate = {
  scenario: 'daily',
  scope: 'price-sentinel',
  platform: null,
  defaultSopText:
    '日常运营：平衡增长与利润，最低利润率 12%，调价超过 15% 需审批。' +
    '根据竞争态势灵活调整，兼顾销量和利润。',
  defaultGoalContext: {
    pricingStrategy: 'balanced',
    minMarginPercent: 12,
    approvalThresholdPercent: 15,
  },
  editableFields: ['minMarginPercent', 'approvalThresholdPercent', 'maxUndercutPercent'],
  lockedFields: ['pricingStrategy'],
}

const DAILY_ADS_OPTIMIZER: ScenarioTemplate = {
  scenario: 'daily',
  scope: 'ads-optimizer',
  platform: null,
  defaultSopText:
    '日常运营：稳定 ROAS 目标 3，均衡投放策略。' +
    '自动暂停表现差的广告活动，持续优化关键词组合。',
  defaultGoalContext: {
    targetRoas: 3,
    adsStrategy: 'balanced',
    pauseNonPerforming: true,
  },
  editableFields: ['targetRoas', 'maxDailyBudgetUsd'],
  lockedFields: ['adsStrategy'],
}

const DAILY_INVENTORY_GUARD: ScenarioTemplate = {
  scenario: 'daily',
  scope: 'inventory-guard',
  platform: null,
  defaultSopText:
    '日常运营：常规安全库存 10 件，标准审批 50 件。' +
    '按历史销售速度计算补货量，每日窗口期执行巡检。',
  defaultGoalContext: {
    safetyThreshold: 10,
    replenishApprovalMinUnits: 50,
    inventoryStrategy: 'balanced',
    enforceDailyWindow: true,
  },
  editableFields: ['safetyThreshold', 'replenishApprovalMinUnits', 'timeZone'],
  lockedFields: ['inventoryStrategy'],
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ALL_SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  LAUNCH_PRICE_SENTINEL,
  LAUNCH_ADS_OPTIMIZER,
  LAUNCH_INVENTORY_GUARD,
  DEFEND_PRICE_SENTINEL,
  DEFEND_ADS_OPTIMIZER,
  DEFEND_INVENTORY_GUARD,
  CLEARANCE_PRICE_SENTINEL,
  CLEARANCE_ADS_OPTIMIZER,
  CLEARANCE_INVENTORY_GUARD,
  DAILY_PRICE_SENTINEL,
  DAILY_ADS_OPTIMIZER,
  DAILY_INVENTORY_GUARD,
]

export const SCENARIOS = ['launch', 'defend', 'clearance', 'daily'] as const
export type Scenario = (typeof SCENARIOS)[number]

export const TEMPLATE_SCOPES = ['price-sentinel', 'ads-optimizer', 'inventory-guard'] as const

export function getTemplate(scenario: string, scope: string): ScenarioTemplate | null {
  return ALL_SCENARIO_TEMPLATES.find(
    (t) => t.scenario === scenario && t.scope === scope,
  ) ?? null
}

export function getTemplatesForScenario(scenario: string): ScenarioTemplate[] {
  return ALL_SCENARIO_TEMPLATES.filter((t) => t.scenario === scenario)
}
