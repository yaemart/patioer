import type { FastifyRequest } from 'fastify'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { schema } from '@patioer/db'
import type {
  AccountHealthPort,
  AccountHealthSummary,
  CaseFilters,
  DailyOverview,
  DateRange,
  InventoryPlanningPort,
  ListingIssue,
  RefundSummary,
  ReplenishmentSuggestion,
  ServiceCase,
  ServiceOpsPort,
  SkuEconomics,
  UnitEconomicsPort,
} from '@patioer/harness'

type BusinessPortDeps = {
  unitEconomics: UnitEconomicsPort
  inventoryPlanning: InventoryPlanningPort
  accountHealth: AccountHealthPort
  serviceOps: ServiceOpsPort
}

function toDayString(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  return value.toISOString()
}

function toSeverity(value: string | null | undefined): ListingIssue['severity'] {
  switch (value) {
    case 'critical':
      return 'critical'
    case 'info':
      return 'info'
    case 'warning':
    default:
      return 'warning'
  }
}

function buildUnitEconomicsPort(request: FastifyRequest): UnitEconomicsPort {
  return {
    async getSkuEconomics(tenantId, platform, productId, range): Promise<SkuEconomics | null> {
      if (!request.withDb) return null

      const [row] = await request.withDb((db) =>
        db
          .select({
            grossRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.grossRevenue}), 0)`,
            netRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.netRevenue}), 0)`,
            cogs: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.cogs}), 0)`,
            platformFee: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.platformFee}), 0)`,
            adSpend: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.adSpend}), 0)`,
            contributionMargin: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.contributionMargin}), 0)`,
            unitsSold: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.unitsSold}), 0)`,
            avgAcos: sql<string>`coalesce(avg(${schema.unitEconomicsDaily.acos}), 0)`,
            avgTacos: sql<string>`coalesce(avg(${schema.unitEconomicsDaily.tacos}), 0)`,
            rowCount: sql<string>`count(*)`,
          })
          .from(schema.unitEconomicsDaily)
          .where(and(
            eq(schema.unitEconomicsDaily.tenantId, tenantId),
            eq(schema.unitEconomicsDaily.platform, platform),
            eq(schema.unitEconomicsDaily.productId, productId),
            gte(schema.unitEconomicsDaily.date, toDayString(range.from)),
            lte(schema.unitEconomicsDaily.date, toDayString(range.to)),
          )),
      )

      if (!row || toNumber(row.rowCount) === 0) return null

      return {
        productId,
        sku: productId,
        platform,
        grossRevenue: toNumber(row.grossRevenue),
        netRevenue: toNumber(row.netRevenue),
        cogs: toNumber(row.cogs),
        platformFee: toNumber(row.platformFee),
        adSpend: toNumber(row.adSpend),
        contributionMargin: toNumber(row.contributionMargin),
        acos: toNumber(row.avgAcos),
        tacos: toNumber(row.avgTacos),
        unitsSold: toNumber(row.unitsSold),
      }
    },

    async getDailyOverview(tenantId, range): Promise<DailyOverview[]> {
      if (!request.withDb) return []

      const rows = await request.withDb((db) =>
        db
          .select({
            date: schema.unitEconomicsDaily.date,
            totalRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.grossRevenue}), 0)`,
            totalCogs: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.cogs}), 0)`,
            totalAdSpend: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.adSpend}), 0)`,
            totalPlatformFee: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.platformFee}), 0)`,
            contributionMargin: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.contributionMargin}), 0)`,
            avgAcos: sql<string>`coalesce(avg(${schema.unitEconomicsDaily.acos}), 0)`,
            avgTacos: sql<string>`coalesce(avg(${schema.unitEconomicsDaily.tacos}), 0)`,
          })
          .from(schema.unitEconomicsDaily)
          .where(and(
            eq(schema.unitEconomicsDaily.tenantId, tenantId),
            gte(schema.unitEconomicsDaily.date, toDayString(range.from)),
            lte(schema.unitEconomicsDaily.date, toDayString(range.to)),
          ))
          .groupBy(schema.unitEconomicsDaily.date)
          .orderBy(asc(schema.unitEconomicsDaily.date)),
      )

      return rows.map((row) => {
        const totalRevenue = toNumber(row.totalRevenue)
        const contributionMargin = toNumber(row.contributionMargin)

        return {
          date: String(row.date),
          totalRevenue,
          totalCogs: toNumber(row.totalCogs),
          totalAdSpend: toNumber(row.totalAdSpend),
          totalPlatformFee: toNumber(row.totalPlatformFee),
          contributionMargin,
          marginPercent: totalRevenue > 0 ? contributionMargin / totalRevenue : 0,
          avgAcos: toNumber(row.avgAcos),
          avgTacos: toNumber(row.avgTacos),
        }
      })
    },
  }
}

function buildInventoryPlanningPort(request: FastifyRequest): InventoryPlanningPort {
  return {
    async getInboundShipments(tenantId) {
      if (!request.withDb) return []

      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.inventoryInboundShipments)
          .where(eq(schema.inventoryInboundShipments.tenantId, tenantId))
          .orderBy(asc(schema.inventoryInboundShipments.expectedArrival), desc(schema.inventoryInboundShipments.createdAt)),
      )

      return rows.map((row) => ({
        id: row.id,
        sku: row.productId,
        productId: row.productId,
        platform: row.platform,
        quantity: row.quantity,
        status: row.status,
        expectedArrival: row.expectedArrival ? String(row.expectedArrival) : null,
        supplier: row.supplier ?? null,
        leadTimeDays: row.leadTimeDays ?? null,
        landedCostPerUnit: row.landedCostPerUnit == null ? null : toNumber(row.landedCostPerUnit),
      }))
    },

    async getReplenishmentSuggestions(tenantId): Promise<ReplenishmentSuggestion[]> {
      if (!request.withDb) return []

      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)

      const [inventoryRows, velocityRows] = await Promise.all([
        request.withDb((db) =>
          db
            .select({
              platform: schema.inventoryLevels.platform,
              currentStock: schema.inventoryLevels.quantity,
              safetyThreshold: schema.inventoryLevels.safetyThreshold,
              platformProductId: schema.products.platformProductId,
            })
            .from(schema.inventoryLevels)
            .innerJoin(schema.products, and(
              eq(schema.products.id, schema.inventoryLevels.productId),
              eq(schema.products.tenantId, schema.inventoryLevels.tenantId),
            ))
            .where(eq(schema.inventoryLevels.tenantId, tenantId)),
        ),
        request.withDb((db) =>
          db
            .select({
              platform: schema.unitEconomicsDaily.platform,
              productId: schema.unitEconomicsDaily.productId,
              unitsSold: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.unitsSold}), 0)`,
            })
            .from(schema.unitEconomicsDaily)
            .where(and(
              eq(schema.unitEconomicsDaily.tenantId, tenantId),
              gte(schema.unitEconomicsDaily.date, toDayString(thirtyDaysAgo)),
            ))
            .groupBy(schema.unitEconomicsDaily.platform, schema.unitEconomicsDaily.productId),
        ),
      ])

      const velocityByKey = new Map<string, number>()
      for (const row of velocityRows) {
        velocityByKey.set(`${row.platform}:${row.productId}`, toNumber(row.unitsSold) / 30)
      }

      return inventoryRows.map((row) => {
        const sku = row.platformProductId
        const dailyVelocity = velocityByKey.get(`${row.platform}:${sku}`) ?? 0
        const currentStock = row.currentStock
        const safetyThreshold = row.safetyThreshold ?? 0
        const daysOfStock = dailyVelocity > 0 ? currentStock / dailyVelocity : Number.POSITIVE_INFINITY
        const targetStock = Math.max(safetyThreshold * 2, Math.ceil(dailyVelocity * 30))
        const suggestedQty = Math.max(Math.ceil(targetStock - currentStock), 0)

        return {
          productId: sku,
          sku,
          platform: row.platform,
          currentStock,
          dailyVelocity,
          daysOfStock: Number.isFinite(daysOfStock) ? Math.round(daysOfStock * 10) / 10 : 9999,
          suggestedQty,
          urgency:
            currentStock <= 0 ? 'critical' :
            currentStock <= safetyThreshold ? 'low' :
            'ok',
        }
      })
    },
  }
}

function buildAccountHealthPort(request: FastifyRequest): AccountHealthPort {
  return {
    async getHealthSummary(tenantId, platform): Promise<AccountHealthSummary> {
      if (!request.withDb) {
        return {
          platform,
          overallStatus: 'healthy',
          openIssues: 0,
          resolvedLast30d: 0,
          metrics: {},
        }
      }

      const resolvedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

      const [openRows, resolvedRows] = await Promise.all([
        request.withDb((db) =>
          db
            .select({
              severity: schema.accountHealthEvents.severity,
              eventType: schema.accountHealthEvents.eventType,
            })
            .from(schema.accountHealthEvents)
            .where(and(
              eq(schema.accountHealthEvents.tenantId, tenantId),
              eq(schema.accountHealthEvents.platform, platform),
              isNull(schema.accountHealthEvents.resolvedAt),
            )),
        ),
        request.withDb((db) =>
          db
            .select({ count: sql<string>`count(*)` })
            .from(schema.accountHealthEvents)
            .where(and(
              eq(schema.accountHealthEvents.tenantId, tenantId),
              eq(schema.accountHealthEvents.platform, platform),
              gte(schema.accountHealthEvents.resolvedAt, resolvedCutoff),
            )),
        ),
      ])

      const criticalOpen = openRows.filter((row) => row.severity === 'critical').length
      const warningOpen = openRows.filter((row) => row.severity === 'warning').length

      return {
        platform,
        overallStatus:
          criticalOpen > 0 ? 'critical' :
          openRows.length > 0 ? 'at_risk' :
          'healthy',
        openIssues: openRows.length,
        resolvedLast30d: toNumber(resolvedRows[0]?.count),
        metrics: {
          criticalOpen,
          warningOpen,
          infoOpen: openRows.filter((row) => row.severity === 'info').length,
        },
      }
    },

    async getListingIssues(tenantId): Promise<ListingIssue[]> {
      if (!request.withDb) return []

      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.accountHealthEvents)
          .where(eq(schema.accountHealthEvents.tenantId, tenantId))
          .orderBy(desc(schema.accountHealthEvents.createdAt))
          .limit(100),
      )

      return rows.map((row) => ({
        id: row.id,
        productId: row.affectedEntity ?? '',
        platform: row.platform,
        issueType: row.eventType,
        severity: toSeverity(row.severity),
        title: row.title,
        description: row.description ?? '',
        detectedAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
        resolvedAt: toIsoString(row.resolvedAt),
      }))
    },
  }
}

function buildServiceOpsPort(request: FastifyRequest): ServiceOpsPort {
  return {
    async getCases(tenantId, filters: CaseFilters = {}): Promise<ServiceCase[]> {
      if (!request.withDb) return []

      const conditions = [eq(schema.serviceCases.tenantId, tenantId)]
      if (filters.status) conditions.push(eq(schema.serviceCases.status, filters.status))
      if (filters.caseType) conditions.push(eq(schema.serviceCases.caseType, filters.caseType))
      if (filters.platform) conditions.push(eq(schema.serviceCases.platform, filters.platform))

      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.serviceCases)
          .where(and(...conditions))
          .orderBy(desc(schema.serviceCases.createdAt))
          .limit(filters.limit ?? 100)
          .offset(filters.offset ?? 0),
      )

      return rows.map((row) => ({
        id: row.id,
        caseType: row.caseType,
        orderId: row.orderId ?? null,
        productId: row.productId ?? null,
        platform: row.platform,
        status: row.status,
        amount: row.amount == null ? null : toNumber(row.amount),
        customerMessage: row.customerMessage ?? null,
        agentResponse: row.agentResponse ?? null,
        escalated: row.escalated ?? false,
        createdAt: toIsoString(row.createdAt) ?? new Date(0).toISOString(),
      }))
    },

    async getRefundSummary(tenantId, range: DateRange): Promise<RefundSummary> {
      if (!request.withDb) {
        return { totalRefunds: 0, totalAmount: 0, byReason: {} }
      }

      const rows = await request.withDb((db) =>
        db
          .select()
          .from(schema.serviceCases)
          .where(and(
            eq(schema.serviceCases.tenantId, tenantId),
            inArray(schema.serviceCases.caseType, ['refund', 'return']),
            gte(schema.serviceCases.createdAt, range.from),
            lte(schema.serviceCases.createdAt, range.to),
          )),
      )

      const byReason: RefundSummary['byReason'] = {}
      let totalAmount = 0

      for (const row of rows) {
        const key = row.caseType
        const amount = row.amount == null ? 0 : toNumber(row.amount)
        totalAmount += amount
        byReason[key] ??= { count: 0, amount: 0 }
        byReason[key].count += 1
        byReason[key].amount += amount
      }

      return {
        totalRefunds: rows.length,
        totalAmount,
        byReason,
      }
    },
  }
}

export function buildBusinessPortDeps(request: FastifyRequest): BusinessPortDeps {
  return {
    unitEconomics: buildUnitEconomicsPort(request),
    inventoryPlanning: buildInventoryPlanningPort(request),
    accountHealth: buildAccountHealthPort(request),
    serviceOps: buildServiceOpsPort(request),
  }
}

export function rangeFromPreset(preset: string): DateRange {
  const to = new Date()
  const from = new Date(to)

  switch (preset) {
    case '90d':
      from.setUTCDate(from.getUTCDate() - 90)
      break
    case '30d':
      from.setUTCDate(from.getUTCDate() - 30)
      break
    case '7d':
    default:
      from.setUTCDate(from.getUTCDate() - 7)
      break
  }

  return { from, to }
}
