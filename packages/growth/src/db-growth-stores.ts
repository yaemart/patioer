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

async function findReferralCodeByCode(code: string): Promise<ReferralCode | null> {
  const [row] = await db
    .select()
    .from(schema.referralCodes)
    .where(eq(schema.referralCodes.code, code))
    .limit(1)
  return row ? toReferralCode(row) : null
}

async function findReward(
  predicate: ReturnType<typeof and>,
): Promise<ReferralReward | null> {
  const [row] = await db
    .select()
    .from(schema.referralRewards)
    .where(predicate)
    .limit(1)
  return row ? toReferralReward(row) : null
}

export function createDbReferralStore(): ReferralStore {
  return {
    async findByCode(code) {
      return findReferralCodeByCode(code)
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
      await db.insert(schema.referralRewards).values(reward)
    },

    async findPendingForNewTenant(newTenantId) {
      return findReward(
        and(
          eq(schema.referralRewards.newTenantId, newTenantId),
          eq(schema.referralRewards.status, 'pending'),
        ),
      )
    },

    async updateStatus(rewardId, status) {
      const existing = await findReward(
        and(eq(schema.referralRewards.id, rewardId)),
      )
      if (!existing) return

      await db
        .update(schema.referralRewards)
        .set({ status })
        .where(eq(schema.referralRewards.id, rewardId))
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
