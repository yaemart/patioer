import { and, eq } from 'drizzle-orm'
import { db, schema, withTenantDb } from '@patioer/db'
import type { NpsResponse, ReferralCode, ReferralReward } from './growth.types.js'
import type { NpsStore } from './nps.service.js'
import type { ReferralStore, RewardStore } from './referral.service.js'

function toReferralCode(
  row: typeof schema.referralCodes.$inferSelect,
): ReferralCode {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    createdAt: row.createdAt ?? new Date(),
  }
}

function toReferralReward(
  row: typeof schema.referralRewards.$inferSelect,
): ReferralReward {
  return {
    id: row.id,
    referrerTenantId: row.referrerTenantId,
    newTenantId: row.newTenantId,
    rewardType: row.rewardType,
    status: row.status as ReferralReward['status'],
    createdAt: row.createdAt ?? new Date(),
  }
}

function toNpsResponse(
  row: typeof schema.npsResponses.$inferSelect,
): NpsResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    score: row.score,
    feedback: row.feedback ?? null,
    createdAt: row.createdAt ?? new Date(),
  }
}

async function listTenantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
  return rows.map((row) => row.id)
}

async function findReferralCodeAcrossTenants(code: string): Promise<ReferralCode | null> {
  const tenantIds = await listTenantIds()
  for (const tenantId of tenantIds) {
    const row = await withTenantDb(tenantId, async (tenantDb) => {
      const [match] = await tenantDb
        .select()
        .from(schema.referralCodes)
        .where(eq(schema.referralCodes.code, code))
        .limit(1)
      return match ?? null
    })
    if (row) return toReferralCode(row)
  }
  return null
}

async function findRewardAcrossTenants(
  whereFactory: (tenantId: string) => ReturnType<typeof and>,
): Promise<ReferralReward | null> {
  const tenantIds = await listTenantIds()
  for (const tenantId of tenantIds) {
    const row = await withTenantDb(tenantId, async (tenantDb) => {
      const [match] = await tenantDb
        .select()
        .from(schema.referralRewards)
        .where(whereFactory(tenantId))
        .limit(1)
      return match ?? null
    })
    if (row) return toReferralReward(row)
  }
  return null
}

export function createDbReferralStore(): ReferralStore {
  return {
    async findByCode(code) {
      return findReferralCodeAcrossTenants(code)
    },

    async findByTenantId(tenantId) {
      return withTenantDb(tenantId, async (tenantDb) => {
        const [row] = await tenantDb
          .select()
          .from(schema.referralCodes)
          .where(eq(schema.referralCodes.tenantId, tenantId))
          .limit(1)
        return row ? toReferralCode(row) : null
      })
    },

    async create(referral) {
      await withTenantDb(referral.tenantId, async (tenantDb) => {
        await tenantDb.insert(schema.referralCodes).values(referral)
      })
    },
  }
}

export function createDbRewardStore(): RewardStore {
  return {
    async create(reward) {
      await withTenantDb(reward.referrerTenantId, async (tenantDb) => {
        await tenantDb.insert(schema.referralRewards).values(reward)
      })
    },

    async findPendingForNewTenant(newTenantId) {
      return findRewardAcrossTenants((tenantId) =>
        and(
          eq(schema.referralRewards.referrerTenantId, tenantId),
          eq(schema.referralRewards.newTenantId, newTenantId),
          eq(schema.referralRewards.status, 'pending'),
        ),
      )
    },

    async updateStatus(rewardId, status) {
      const existing = await findRewardAcrossTenants((tenantId) =>
        and(
          eq(schema.referralRewards.referrerTenantId, tenantId),
          eq(schema.referralRewards.id, rewardId),
        ),
      )
      if (!existing) return

      await withTenantDb(existing.referrerTenantId, async (tenantDb) => {
        await tenantDb
          .update(schema.referralRewards)
          .set({ status })
          .where(eq(schema.referralRewards.id, rewardId))
      })
    },
  }
}

export function createDbNpsStore(): NpsStore {
  return {
    async hasReceivedNps(tenantId) {
      return withTenantDb(tenantId, async (tenantDb) => {
        const [row] = await tenantDb
          .select({ id: schema.npsResponses.id })
          .from(schema.npsResponses)
          .where(eq(schema.npsResponses.tenantId, tenantId))
          .limit(1)
        return Boolean(row)
      })
    },

    async recordResponse(response) {
      await withTenantDb(response.tenantId, async (tenantDb) => {
        await tenantDb.insert(schema.npsResponses).values(response)
      })
    },

    async getResponses(tenantId) {
      return withTenantDb(tenantId, async (tenantDb) => {
        const rows = await tenantDb
          .select()
          .from(schema.npsResponses)
          .where(eq(schema.npsResponses.tenantId, tenantId))
        return rows.map(toNpsResponse)
      })
    },
  }
}
