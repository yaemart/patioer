/**
 * Input builder functions: translate per-agent `goalContext` JSON into typed run inputs.
 * Extracted from agents-execute.ts so the agent registry can import them without circular deps.
 */
import type { FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import type {
  AdsOptimizerRunInput,
  InventoryGuardRunInput,
  PriceSentinelRunInput,
  ProductScoutRunInput,
  SupportRelayRunInput,
} from '@patioer/agent-runtime'

function parseGoalContext(goalContext: string): Record<string, unknown> | null {
  if (!goalContext) return null
  try {
    return JSON.parse(goalContext) as Record<string, unknown>
  } catch {
    return null
  }
}

function getNum(obj: Record<string, unknown> | null, key: string): number | undefined {
  const v = obj?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function buildPriceSentinelInput(goalContext: string): PriceSentinelRunInput {
  const parsed = parseGoalContext(goalContext)
  if (parsed && Array.isArray(parsed.proposals)) {
    return parsed as unknown as PriceSentinelRunInput
  }
  return { proposals: [] }
}

export function buildProductScoutInput(goalContext: string): ProductScoutRunInput {
  const parsed = parseGoalContext(goalContext)
  if (!parsed) return {}
  return { maxProducts: getNum(parsed, 'maxProducts') }
}

export function buildSupportRelayInput(goalContext: string): SupportRelayRunInput {
  const parsed = parseGoalContext(goalContext)
  if (!parsed) return {}
  const policy = parsed.policy ?? parsed.autoReplyPolicy
  if (policy === 'auto_reply_non_refund' || policy === 'all_manual') {
    return { autoReplyPolicy: policy }
  }
  return {}
}

export function buildAdsOptimizerInput(
  request: FastifyRequest,
  tenantId: string,
  agentId: string,
  goalContext: string | null,
): AdsOptimizerRunInput {
  const parsed = parseGoalContext(goalContext ?? '')
  return {
    targetRoas: getNum(parsed, 'targetRoas'),
    hasPendingAdsBudgetApproval: async ({ platform, platformCampaignId, proposedDailyBudgetUsd }) => {
      if (!request.withDb) return false
      return request.withDb(async (db) => {
        const rows = await db
          .select()
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.tenantId, tenantId),
              eq(schema.approvals.agentId, agentId),
              eq(schema.approvals.action, 'ads.set_budget'),
              eq(schema.approvals.status, 'pending'),
            ),
          )
        return rows.some((r) => {
          const p = r.payload as Record<string, unknown> | null
          if (!p || typeof p !== 'object') return false
          return (
            String(p.platform) === platform &&
            String(p.platformCampaignId) === platformCampaignId &&
            Number(p.proposedDailyBudgetUsd) === proposedDailyBudgetUsd
          )
        })
      })
    },
    persistCampaigns: async ({ platform, campaigns }) => {
      if (!request.withDb) return
      const syncedAt = new Date()
      await request.withDb(async (db) => {
        for (const c of campaigns) {
          await db
            .insert(schema.adsCampaigns)
            .values({
              tenantId,
              platform,
              platformCampaignId: c.platformCampaignId,
              name: c.name,
              status: c.status,
              dailyBudget: c.dailyBudget != null ? String(c.dailyBudget) : null,
              totalSpend: c.totalSpend != null ? String(c.totalSpend) : null,
              roas: c.roas != null ? String(c.roas) : null,
              syncedAt,
            })
            .onConflictDoUpdate({
              target: [
                schema.adsCampaigns.tenantId,
                schema.adsCampaigns.platform,
                schema.adsCampaigns.platformCampaignId,
              ],
              set: {
                name: c.name,
                status: c.status,
                dailyBudget: c.dailyBudget != null ? String(c.dailyBudget) : null,
                totalSpend: c.totalSpend != null ? String(c.totalSpend) : null,
                roas: c.roas != null ? String(c.roas) : null,
                syncedAt,
              },
            })
        }
      })
    },
  }
}

export function buildInventoryGuardInput(
  request: FastifyRequest,
  tenantId: string,
  agentId: string,
  goalContext: string | null,
): InventoryGuardRunInput {
  const parsed = parseGoalContext(goalContext ?? '')
  const timeZone = parsed && typeof (parsed as { timeZone?: unknown }).timeZone === 'string'
    ? (parsed as { timeZone: string }).timeZone
    : undefined
  const enforceDailyWindow = Boolean(parsed && (parsed as { enforceDailyWindow?: unknown }).enforceDailyWindow === true)

  return {
    safetyThreshold: getNum(parsed, 'safetyThreshold'),
    replenishApprovalMinUnits: getNum(parsed, 'replenishApprovalMinUnits'),
    timeZone,
    ...(enforceDailyWindow ? { enforceDailyWindow: true } : {}),
    hasPendingInventoryAdjust: async ({ platform, platformProductId, targetQuantity }) => {
      if (!request.withDb) return false
      return request.withDb(async (db) => {
        const rows = await db
          .select()
          .from(schema.approvals)
          .where(
            and(
              eq(schema.approvals.tenantId, tenantId),
              eq(schema.approvals.agentId, agentId),
              eq(schema.approvals.action, 'inventory.adjust'),
              eq(schema.approvals.status, 'pending'),
            ),
          )
        return rows.some((r) => {
          const p = r.payload as Record<string, unknown> | null
          if (!p || typeof p !== 'object') return false
          return (
            String(p.platform) === platform &&
            String(p.platformProductId) === platformProductId &&
            Number(p.targetQuantity) === targetQuantity
          )
        })
      })
    },
    persistInventoryLevels: async ({ platform, levels }) => {
      if (!request.withDb) return 0
      const syncedAt = new Date()
      let n = 0
      await request.withDb(async (db) => {
        for (const row of levels) {
          const [product] = await db
            .select({ id: schema.products.id })
            .from(schema.products)
            .where(
              and(
                eq(schema.products.tenantId, tenantId),
                eq(schema.products.platform, platform),
                eq(schema.products.platformProductId, row.platformProductId),
              ),
            )
            .limit(1)
          if (!product) continue
          await db
            .insert(schema.inventoryLevels)
            .values({
              tenantId,
              productId: product.id,
              platform,
              quantity: row.quantity,
              safetyThreshold: row.safetyThreshold,
              status: row.status,
              syncedAt,
            })
            .onConflictDoUpdate({
              target: [
                schema.inventoryLevels.tenantId,
                schema.inventoryLevels.productId,
                schema.inventoryLevels.platform,
              ],
              set: {
                quantity: row.quantity,
                safetyThreshold: row.safetyThreshold,
                status: row.status,
                syncedAt,
              },
            })
          n += 1
        }
      })
      return n
    },
  }
}
