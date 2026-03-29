import type { FastifyPluginAsync } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'

const governancePrefsSchema = z.object({
  priceChangeThreshold: z.number().int().min(5).max(30),
  adsBudgetApproval: z.number().int().min(100).max(2000),
  newListingApproval: z.boolean(),
  humanInLoopAgents: z.array(z.string()).default([]),
})

type GovernancePrefs = z.infer<typeof governancePrefsSchema>

const DEFAULT_GOVERNANCE_PREFS: GovernancePrefs = {
  priceChangeThreshold: 15,
  adsBudgetApproval: 500,
  newListingApproval: true,
  humanInLoopAgents: [],
}

function parseGoalContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }

  return {}
}

function serializeGoalContext(context: Record<string, unknown>): string {
  return JSON.stringify(context)
}

const settingsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/settings/governance', {
    schema: {
      tags: ['Settings'],
      summary: 'Get tenant governance settings',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }

    const [row] = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantGovernanceSettings)
        .where(eq(schema.tenantGovernanceSettings.tenantId, request.tenantId!))
        .limit(1),
    )

    if (!row) {
      return reply.send(DEFAULT_GOVERNANCE_PREFS)
    }

    return reply.send({
      priceChangeThreshold: row.priceChangeThreshold,
      adsBudgetApproval: row.adsBudgetApproval,
      newListingApproval: row.newListingApproval,
      humanInLoopAgents: Array.isArray(row.humanInLoopAgents)
        ? row.humanInLoopAgents.filter((value): value is string => typeof value === 'string')
        : [],
    })
  })

  app.put('/api/v1/settings/governance', {
    schema: {
      tags: ['Settings'],
      summary: 'Update tenant governance settings',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }

    const parsed = governancePrefsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid governance settings' })
    }

    const prefs = parsed.data
    const tenantId = request.tenantId

    await request.withDb(async (db) => {
      const [existing] = await db
        .select({ id: schema.tenantGovernanceSettings.id })
        .from(schema.tenantGovernanceSettings)
        .where(eq(schema.tenantGovernanceSettings.tenantId, tenantId))
        .limit(1)

      const values = {
        tenantId,
        priceChangeThreshold: prefs.priceChangeThreshold,
        adsBudgetApproval: prefs.adsBudgetApproval,
        newListingApproval: prefs.newListingApproval,
        humanInLoopAgents: prefs.humanInLoopAgents,
        updatedAt: new Date(),
      }

      if (!existing) {
        await db.insert(schema.tenantGovernanceSettings).values(values)
      } else {
        await db
          .update(schema.tenantGovernanceSettings)
          .set(values)
          .where(eq(schema.tenantGovernanceSettings.id, existing.id))
      }

      const agents = await db
        .select({ id: schema.agents.id, goalContext: schema.agents.goalContext })
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.tenantId, tenantId),
            eq(schema.agents.type, 'price-sentinel'),
          ),
        )

      for (const agent of agents) {
        const goalContext = parseGoalContext(agent.goalContext)
        await db
          .update(schema.agents)
          .set({
            goalContext: serializeGoalContext({
              ...goalContext,
              approvalThresholdPercent: prefs.priceChangeThreshold,
            }),
            updatedAt: new Date(),
          })
          .where(eq(schema.agents.id, agent.id))
      }
    })

    return reply.send(prefs)
  })
}

export default settingsRoute
