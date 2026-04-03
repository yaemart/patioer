import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { UUID_LOOSE_RE } from '@patioer/shared'
import {
  parseSop,
  expandScenario,
  ALL_SCENARIO_TEMPLATES,
  getTemplatesForScenario,
} from '@patioer/sop'

const zUuid = z.string().regex(UUID_LOOSE_RE).transform((v) => v.toLowerCase())
const paramsId = z.object({ id: zUuid })

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createScenarioBody = z.object({
  scenario: z.string().min(1).max(60),
  scenarioName: z.string().min(1).max(120).optional(),
  platform: z.string().max(30).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(120).optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})

const updateScenarioBody = z.object({
  scenarioName: z.string().min(1).max(120).optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
})

const parseBody = z.object({
  scope: z.string().min(1).max(60),
  sopText: z.string().min(1).max(10000),
})

const saveSopBody = z.object({
  sopText: z.string().min(1).max(10000),
  platform: z.string().max(30).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(120).optional(),
  scenario: z.string().max(60).optional(),
  scenarioId: zUuid.optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
})

const scopeParams = z.object({ scope: z.string().min(1).max(60) })

const listSopQuery = z.object({
  scope: z.string().optional(),
  status: z.enum(['active', 'archived', 'draft']).optional(),
})

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const sopRoute: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // Template API
  // =========================================================================

  app.get('/api/v1/sop/templates', {
    schema: { tags: ['SOP'], summary: 'List all scenario templates', security: [{ bearerAuth: [] }] },
  }, async (_request, reply) => {
    return reply.send({ templates: ALL_SCENARIO_TEMPLATES })
  })

  app.get('/api/v1/sop/templates/:scenario', {
    schema: { tags: ['SOP'], summary: 'Get templates for a scenario', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { scenario } = request.params as { scenario: string }
    const templates = getTemplatesForScenario(scenario)
    if (templates.length === 0) {
      return reply.code(404).send({ error: 'scenario not found' })
    }
    return reply.send({ templates })
  })

  // =========================================================================
  // Scenario preview (dry-run expand without persisting)
  // =========================================================================

  app.post('/api/v1/sop/scenarios/preview', {
    schema: { tags: ['SOP'], summary: 'Preview scenario expansion (no persist)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const parsed = createScenarioBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues })
    }

    const expanded = await expandScenario({
      scenario: parsed.data.scenario,
      tenantOverrides: parsed.data.overrides,
    })

    return reply.send({
      scenario: expanded.scenario,
      sops: expanded.expandedSops.map((s) => ({
        scope: s.scope,
        effectiveSopText: s.sopText,
        goalContext: s.goalContext,
        systemPrompt: s.systemPrompt,
        governance: s.governance,
        warnings: s.warnings,
      })),
    })
  })

  // =========================================================================
  // Scenario-level API
  // =========================================================================

  app.post('/api/v1/sop/scenarios', {
    schema: { tags: ['SOP'], summary: 'Create scenario (auto-expand into SOPs)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsed = createScenarioBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues })
    }

    const tenantId = request.tenantId
    const { scenario, scenarioName, platform, entityType, entityId, effectiveFrom, effectiveTo, overrides } = parsed.data

    const [created] = await request.withDb((db) =>
      db
        .insert(schema.tenantSopScenarios)
        .values({
          tenantId,
          scenario,
          scenarioName: scenarioName ?? null,
          platform: platform ?? null,
          entityType: entityType ?? null,
          entityId: entityId ?? null,
          effectiveFrom: effectiveFrom ?? null,
          effectiveTo: effectiveTo ?? null,
        })
        .returning(),
    )

    const expanded = await expandScenario({
      scenario,
      tenantOverrides: overrides,
    })

    const sopRows = []
    for (const sop of expanded.expandedSops) {
      const [row] = await request.withDb((db) =>
        db
          .insert(schema.tenantSops)
          .values({
            tenantId,
            scope: sop.scope,
            scenario: sop.scenario,
            scenarioId: created.id,
            platform: platform ?? null,
            entityType: entityType ?? null,
            entityId: entityId ?? null,
            sopText: sop.sopText,
            extractedGoalContext: sop.goalContext,
            extractedSystemPrompt: sop.systemPrompt || null,
            extractedGovernance: Object.keys(sop.governance).length > 0 ? sop.governance : null,
            extractionWarnings: sop.warnings.length > 0 ? sop.warnings : null,
            effectiveFrom: effectiveFrom ?? null,
            effectiveTo: effectiveTo ?? null,
          })
          .returning(),
      )
      sopRows.push(row)
    }

    return reply.code(201).send({ scenario: created, sops: sopRows })
  })

  app.get('/api/v1/sop/scenarios', {
    schema: { tags: ['SOP'], summary: 'List all scenarios for tenant', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const rows = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSopScenarios)
        .where(eq(schema.tenantSopScenarios.tenantId, request.tenantId!))
        .orderBy(desc(schema.tenantSopScenarios.createdAt)),
    )
    return reply.send({ scenarios: rows })
  })

  app.get('/api/v1/sop/scenarios/:id', {
    schema: { tags: ['SOP'], summary: 'Get scenario detail with expanded SOPs', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsId.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid scenario id' })
    }

    const [row] = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSopScenarios)
        .where(and(
          eq(schema.tenantSopScenarios.id, parsedParams.data.id),
          eq(schema.tenantSopScenarios.tenantId, request.tenantId!),
        ))
        .limit(1),
    )
    if (!row) {
      return reply.code(404).send({ error: 'scenario not found' })
    }

    const sops = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSops)
        .where(and(
          eq(schema.tenantSops.scenarioId, row.id),
          eq(schema.tenantSops.tenantId, request.tenantId!),
        )),
    )

    return reply.send({ scenario: row, sops })
  })

  app.put('/api/v1/sop/scenarios/:id', {
    schema: { tags: ['SOP'], summary: 'Update scenario metadata', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsId.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid scenario id' })
    }
    const parsedBody = updateScenarioBody.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsedBody.error.issues })
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (parsedBody.data.scenarioName !== undefined) patch.scenarioName = parsedBody.data.scenarioName
    if (parsedBody.data.effectiveFrom !== undefined) patch.effectiveFrom = parsedBody.data.effectiveFrom
    if (parsedBody.data.effectiveTo !== undefined) patch.effectiveTo = parsedBody.data.effectiveTo

    const [updated] = await request.withDb((db) =>
      db
        .update(schema.tenantSopScenarios)
        .set(patch)
        .where(and(
          eq(schema.tenantSopScenarios.id, parsedParams.data.id),
          eq(schema.tenantSopScenarios.tenantId, request.tenantId!),
        ))
        .returning(),
    )
    if (!updated) {
      return reply.code(404).send({ error: 'scenario not found' })
    }
    return reply.send({ scenario: updated })
  })

  app.post('/api/v1/sop/scenarios/:id/activate', {
    schema: { tags: ['SOP'], summary: 'Activate a scenario', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    return updateScenarioStatus(request, reply, 'active')
  })

  app.post('/api/v1/sop/scenarios/:id/archive', {
    schema: { tags: ['SOP'], summary: 'Archive a scenario', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    return updateScenarioStatus(request, reply, 'archived')
  })

  app.post('/api/v1/sop/scenarios/:id/duplicate', {
    schema: { tags: ['SOP'], summary: 'Duplicate a scenario as draft', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedParams = paramsId.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid scenario id' })
    }

    const [source] = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSopScenarios)
        .where(and(
          eq(schema.tenantSopScenarios.id, parsedParams.data.id),
          eq(schema.tenantSopScenarios.tenantId, request.tenantId!),
        ))
        .limit(1),
    )
    if (!source) {
      return reply.code(404).send({ error: 'scenario not found' })
    }

    const [duplicated] = await request.withDb((db) =>
      db
        .insert(schema.tenantSopScenarios)
        .values({
          tenantId: request.tenantId!,
          scenario: source.scenario,
          scenarioName: source.scenarioName ? `${source.scenarioName} (copy)` : null,
          platform: source.platform,
          entityType: source.entityType,
          entityId: source.entityId,
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          status: 'draft',
          previousVersionId: source.id,
        })
        .returning(),
    )

    const sourceSops = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSops)
        .where(and(
          eq(schema.tenantSops.scenarioId, source.id),
          eq(schema.tenantSops.tenantId, request.tenantId!),
        )),
    )

    const copiedSops = []
    for (const sop of sourceSops) {
      const [row] = await request.withDb((db) =>
        db
          .insert(schema.tenantSops)
          .values({
            tenantId: request.tenantId!,
            scope: sop.scope,
            scenario: sop.scenario,
            scenarioId: duplicated.id,
            platform: sop.platform,
            entityType: sop.entityType,
            entityId: sop.entityId,
            sopText: sop.sopText,
            extractedGoalContext: sop.extractedGoalContext,
            extractedSystemPrompt: sop.extractedSystemPrompt,
            extractedGovernance: sop.extractedGovernance,
            extractionWarnings: sop.extractionWarnings,
            effectiveFrom: sop.effectiveFrom,
            effectiveTo: sop.effectiveTo,
            status: 'draft',
            previousVersionId: sop.id,
          })
          .returning(),
      )
      copiedSops.push(row)
    }

    return reply.code(201).send({ scenario: duplicated, sops: copiedSops })
  })

  // =========================================================================
  // Atomic-level API
  // =========================================================================

  app.post('/api/v1/sop/parse', {
    schema: { tags: ['SOP'], summary: 'Parse SOP text into structured preview (no persist)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const parsed = parseBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsed.error.issues })
    }

    try {
      const result = await parseSop({
        scope: parsed.data.scope,
        sopText: parsed.data.sopText,
      })
      return reply.send(result)
    } catch (err) {
      if ((err as Error).name === 'SopSafetyError') {
        return reply.code(422).send({ error: 'SOP rejected by safety check', message: (err as Error).message })
      }
      throw err
    }
  })

  app.get('/api/v1/sop', {
    schema: { tags: ['SOP'], summary: 'List all SOPs for tenant', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const query = listSopQuery.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query' })
    }

    const conditions = [eq(schema.tenantSops.tenantId, request.tenantId!)]
    if (query.data.scope) conditions.push(eq(schema.tenantSops.scope, query.data.scope))
    if (query.data.status) conditions.push(eq(schema.tenantSops.status, query.data.status))

    const rows = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSops)
        .where(and(...conditions))
        .orderBy(desc(schema.tenantSops.updatedAt)),
    )
    return reply.send({ sops: rows })
  })

  app.put('/api/v1/sop/:scope', {
    schema: { tags: ['SOP'], summary: 'Save and apply an atomic SOP', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedScope = scopeParams.safeParse(request.params)
    if (!parsedScope.success) {
      return reply.code(400).send({ error: 'invalid scope' })
    }
    const parsedBody = saveSopBody.safeParse(request.body)
    if (!parsedBody.success) {
      return reply.code(400).send({ error: 'invalid body', details: parsedBody.error.issues })
    }

    const scope = parsedScope.data.scope
    const tenantId = request.tenantId

    let parseResult
    try {
      parseResult = await parseSop({ scope, sopText: parsedBody.data.sopText })
    } catch (err) {
      if ((err as Error).name === 'SopSafetyError') {
        return reply.code(422).send({ error: 'SOP rejected by safety check', message: (err as Error).message })
      }
      throw err
    }

    const existing = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSops)
        .where(and(
          eq(schema.tenantSops.tenantId, tenantId),
          eq(schema.tenantSops.scope, scope),
          eq(schema.tenantSops.status, 'active'),
        ))
        .orderBy(desc(schema.tenantSops.version))
        .limit(1),
    )

    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1
    const previousVersionId = existing.length > 0 ? existing[0].id : null

    if (existing.length > 0) {
      await request.withDb((db) =>
        db
          .update(schema.tenantSops)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(eq(schema.tenantSops.id, existing[0].id)),
      )
    }

    const [created] = await request.withDb((db) =>
      db
        .insert(schema.tenantSops)
        .values({
          tenantId,
          scope,
          platform: parsedBody.data.platform ?? null,
          entityType: parsedBody.data.entityType ?? null,
          entityId: parsedBody.data.entityId ?? null,
          scenario: parsedBody.data.scenario ?? null,
          scenarioId: parsedBody.data.scenarioId ?? null,
          sopText: parsedBody.data.sopText,
          extractedGoalContext: parseResult.goalContext,
          extractedSystemPrompt: parseResult.systemPrompt || null,
          extractedGovernance: Object.keys(parseResult.governance).length > 0 ? parseResult.governance : null,
          extractionWarnings: parseResult.warnings.length > 0 ? parseResult.warnings : null,
          effectiveFrom: parsedBody.data.effectiveFrom ?? null,
          effectiveTo: parsedBody.data.effectiveTo ?? null,
          version: nextVersion,
          previousVersionId,
          status: 'active',
        })
        .returning(),
    )

    return reply.code(201).send({ sop: created, parseResult })
  })

  app.post('/api/v1/sop/:scope/activate', {
    schema: { tags: ['SOP'], summary: 'Activate a specific SOP version', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedScope = scopeParams.safeParse(request.params)
    if (!parsedScope.success) {
      return reply.code(400).send({ error: 'invalid scope' })
    }
    const body = z.object({ version: z.coerce.number().int().positive() }).safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'version is required' })
    }

    const tenantId = request.tenantId
    const scope = parsedScope.data.scope

    await request.withDb((db) =>
      db
        .update(schema.tenantSops)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(
          eq(schema.tenantSops.tenantId, tenantId),
          eq(schema.tenantSops.scope, scope),
          eq(schema.tenantSops.status, 'active'),
        )),
    )

    const [activated] = await request.withDb((db) =>
      db
        .update(schema.tenantSops)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(
          eq(schema.tenantSops.tenantId, tenantId),
          eq(schema.tenantSops.scope, scope),
          eq(schema.tenantSops.version, body.data.version),
        ))
        .returning(),
    )

    if (!activated) {
      return reply.code(404).send({ error: 'SOP version not found' })
    }
    return reply.send({ sop: activated })
  })

  app.post('/api/v1/sop/:scope/rollback', {
    schema: { tags: ['SOP'], summary: 'Rollback to previous SOP version', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const parsedScope = scopeParams.safeParse(request.params)
    if (!parsedScope.success) {
      return reply.code(400).send({ error: 'invalid scope' })
    }

    const tenantId = request.tenantId
    const scope = parsedScope.data.scope

    const [current] = await request.withDb((db) =>
      db
        .select()
        .from(schema.tenantSops)
        .where(and(
          eq(schema.tenantSops.tenantId, tenantId),
          eq(schema.tenantSops.scope, scope),
          eq(schema.tenantSops.status, 'active'),
        ))
        .limit(1),
    )

    if (!current?.previousVersionId) {
      return reply.code(409).send({ error: 'no previous version to rollback to' })
    }

    await request.withDb((db) =>
      db
        .update(schema.tenantSops)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(schema.tenantSops.id, current.id)),
    )

    const [restored] = await request.withDb((db) =>
      db
        .update(schema.tenantSops)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(
          eq(schema.tenantSops.id, current.previousVersionId!),
          eq(schema.tenantSops.tenantId, tenantId),
        ))
        .returning(),
    )

    if (!restored) {
      return reply.code(404).send({ error: 'previous version not found' })
    }
    return reply.send({ sop: restored, rolledBackFrom: current.id })
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateScenarioStatus(
  request: FastifyRequest,
  reply: FastifyReply,
  status: 'active' | 'archived',
) {
  if (!request.withDb || !request.tenantId) {
    return reply.code(401).send({ error: 'x-tenant-id required' })
  }
  const parsedParams = paramsId.safeParse(request.params)
  if (!parsedParams.success) {
    return reply.code(400).send({ error: 'invalid scenario id' })
  }

  const tenantId = request.tenantId

  const [updated] = await request.withDb((db) =>
    db
      .update(schema.tenantSopScenarios)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(schema.tenantSopScenarios.id, parsedParams.data.id),
        eq(schema.tenantSopScenarios.tenantId, tenantId),
      ))
      .returning(),
  )

  if (!updated) {
    return reply.code(404).send({ error: 'scenario not found' })
  }

  await request.withDb((db) =>
    db
      .update(schema.tenantSops)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(schema.tenantSops.scenarioId, parsedParams.data.id),
        eq(schema.tenantSops.tenantId, tenantId),
      )),
  )

  return reply.code(200).send({ scenario: updated })
}

export default sopRoute
