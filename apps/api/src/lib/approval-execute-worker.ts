/**
 * Processes `approval.execute` jobs from the `webhook-processing` queue after a
 * human approves an agent-requested action (see `routes/approvals.ts`).
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Job } from 'bullmq'
import { HarnessError } from '@patioer/harness'
import { withTenantDb, schema, type AppDb } from '@patioer/db'
import { z } from 'zod'
import { registry } from './harness-registry.js'
import { createHarness } from './harness-factory.js'
import { optionalPlatformZod } from './platform-schema.js'
import { resolveFirstCredentialForTenant } from './resolve-credential.js'
import type { SupportedPlatform } from './harness-factory.js'

const approvalExecutePayloadSchema = z.object({
  tenantId: z.string().uuid(),
  agentId: z.string().uuid(),
  approvalId: z.string().uuid(),
  action: z.string().min(1),
  payload: z.unknown(),
  platform: optionalPlatformZod,
})

const priceUpdatePayloadSchema = z.object({
  productId: z.string().min(1),
  proposedPrice: z.number().finite().positive(),
})

export type ApprovalExecuteJobPayload = z.infer<typeof approvalExecutePayloadSchema>

async function alreadyExecuted(db: AppDb, tenantId: string, approvalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentEvents.id })
    .from(schema.agentEvents)
    .where(
      and(
        eq(schema.agentEvents.tenantId, tenantId),
        eq(schema.agentEvents.action, 'approval.executed'),
        sql`${schema.agentEvents.payload}->>'approvalId' = ${approvalId}`,
      ),
    )
    .limit(1)
  return Boolean(row)
}

async function runPriceUpdateApproved(
  tenantId: string,
  agentId: string,
  approvalId: string,
  rawPayload: unknown,
  preferredPlatform?: SupportedPlatform,
): Promise<void> {
  const parsed = priceUpdatePayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    throw new Error(`invalid price.update payload: ${parsed.error.message}`)
  }
  const { productId, proposedPrice } = parsed.data

  const resolved = await resolveFirstCredentialForTenant(tenantId, preferredPlatform ?? null)
  if (!resolved) {
    throw new Error('No platform credentials found for tenant')
  }

  const { cred, platform } = resolved
  const registryKey = `${tenantId}:${platform}`

  let harness: ReturnType<typeof createHarness>
  try {
    harness = registry.getOrCreate(registryKey, () =>
      createHarness(tenantId, platform, {
        accessToken: cred.accessToken,
        shopDomain: cred.shopDomain,
        region: cred.region,
        metadata: cred.metadata,
      }),
    )
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'harness initialization failed', { cause: err })
  }

  try {
    await harness.updatePrice(productId, proposedPrice)
  } catch (err) {
    if (err instanceof HarnessError && err.code === '401') {
      registry.invalidate(registryKey)
    }
    throw err
  }

  await withTenantDb(tenantId, async (db) => {
    await db.insert(schema.agentEvents).values({
      tenantId,
      agentId,
      action: 'approval.executed',
      payload: {
        approvalId,
        kind: 'price.update',
        productId,
        proposedPrice,
      } as Record<string, unknown>,
    })
  })
}

async function runSupportEscalateApproved(
  tenantId: string,
  agentId: string,
  approvalId: string,
  rawPayload: unknown,
): Promise<void> {
  await withTenantDb(tenantId, async (db) => {
    await db.insert(schema.agentEvents).values({
      tenantId,
      agentId,
      action: 'approval.executed',
      payload: {
        approvalId,
        kind: 'support.escalate',
        note: 'Human approved escalation — handle in Shopify Inbox / support tooling (no automated harness action).',
        originalPayload: rawPayload,
      } as Record<string, unknown>,
    })
  })
}

/**
 * Idempotent: if `approval.executed` already exists for this approvalId, no-op.
 */
export async function processApprovalExecuteJob(data: unknown): Promise<void> {
  const parsed = approvalExecutePayloadSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`invalid approval.execute payload: ${parsed.error.message}`)
  }
  const { tenantId, agentId, approvalId, action, payload, platform } = parsed.data

  const done = await withTenantDb(tenantId, async (db) => alreadyExecuted(db, tenantId, approvalId))
  if (done) {
    return
  }

  switch (action) {
    case 'price.update':
      await runPriceUpdateApproved(tenantId, agentId, approvalId, payload, platform)
      break
    case 'support.escalate':
      await runSupportEscalateApproved(tenantId, agentId, approvalId, payload)
      break
    default:
      await withTenantDb(tenantId, async (db) => {
        await db.insert(schema.agentEvents).values({
          tenantId,
          agentId,
          action: 'approval.executed',
          payload: {
            approvalId,
            kind: 'unknown',
            originalAction: action,
            note: 'No automated handler for this action type.',
          } as Record<string, unknown>,
        })
      })
  }
}

export async function processWebhookProcessingJob(job: Job): Promise<void> {
  if (job.name === 'approval.execute') {
    await processApprovalExecuteJob(job.data)
    return
  }
  // Other job names may be added later; do not fail the worker.
}
