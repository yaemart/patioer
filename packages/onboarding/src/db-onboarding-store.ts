import { withTenantDb, schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import type { OnboardingState } from './onboarding.types.js'
import type { OnboardingStore } from './onboarding-machine.js'

function toOnboardingState(
  row: typeof schema.onboardingProgress.$inferSelect,
): OnboardingState {
  return {
    currentStep: row.currentStep as OnboardingState['currentStep'],
    stepData: (row.stepData ?? {}) as Record<number, unknown>,
    oauthStatus: (row.oauthStatus ?? {}) as Record<string, OnboardingState['oauthStatus'][string]>,
    healthCheckPassed: row.healthCheckPassed,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
  }
}

function toUpsertValues(
  tenantId: string,
  state: OnboardingState,
) {
  return {
    tenantId,
    currentStep: state.currentStep,
    stepData: state.stepData,
    oauthStatus: state.oauthStatus,
    healthCheckPassed: state.healthCheckPassed,
    startedAt: state.startedAt ?? new Date(),
    completedAt: state.completedAt,
  }
}

export function createDbOnboardingStore(): OnboardingStore {
  return {
    async getState(tenantId) {
      return withTenantDb(tenantId, async (db) => {
        const [row] = await db
          .select()
          .from(schema.onboardingProgress)
          .where(eq(schema.onboardingProgress.tenantId, tenantId))
          .limit(1)
        return row ? toOnboardingState(row) : null
      })
    },

    async saveState(tenantId, state) {
      await withTenantDb(tenantId, async (db) => {
        const [existing] = await db
          .select({ id: schema.onboardingProgress.id })
          .from(schema.onboardingProgress)
          .where(eq(schema.onboardingProgress.tenantId, tenantId))
          .limit(1)

        const values = toUpsertValues(tenantId, state)
        if (!existing) {
          await db.insert(schema.onboardingProgress).values(values)
          return
        }

        await db
          .update(schema.onboardingProgress)
          .set(values)
          .where(eq(schema.onboardingProgress.id, existing.id))
      })
    },
  }
}
