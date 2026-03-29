/**
 * Seed script for 5 official ClipMart templates.
 * Usage: pnpm exec tsx scripts/seed-official-templates.ts
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db, pool, schema, withTenantDb } from '@patioer/db'
import { OFFICIAL_TEMPLATES } from '../packages/clipmart/src/official-templates.js'
import { validateTemplateConfig } from '../packages/clipmart/src/security-validator.js'

const OFFICIAL_TENANT = {
  name: 'Patioer Official',
  slug: 'patioer-official',
  plan: 'scale',
} as const

async function ensureOfficialTenant(): Promise<string> {
  await db
    .insert(schema.tenants)
    .values(OFFICIAL_TENANT)
    .onConflictDoNothing()

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, OFFICIAL_TENANT.slug))
    .limit(1)

  if (!tenant) {
    throw new Error('Failed to create or find official ClipMart tenant')
  }

  return tenant.id
}

async function main() {
  console.log('=== ClipMart Official Templates Seed ===\n')
  console.log(`Templates to seed: ${OFFICIAL_TEMPLATES.length}\n`)

  const officialTenantId = await ensureOfficialTenant()
  console.log(`Official tenant: ${officialTenantId}\n`)

  let passed = 0
  let failed = 0

  for (const template of OFFICIAL_TEMPLATES) {
    const validation = validateTemplateConfig(template.config)

    if (!validation.valid) {
      console.error(`FAIL: ${template.name}`)
      for (const err of validation.errors) {
        console.error(`  [${err.rule}] ${err.path}: ${err.message}`)
      }
      failed++
      continue
    }

    const agents = Array.isArray(template.config.agents)
      ? (template.config.agents as { type: string }[])
      : []

    const [existing] = await withTenantDb(officialTenantId, (tdb) =>
      tdb
        .select({ id: schema.clipmartTemplates.id })
        .from(schema.clipmartTemplates)
        .where(
          and(
            eq(schema.clipmartTemplates.authorTenantId, officialTenantId),
            eq(schema.clipmartTemplates.name, template.name),
            eq(schema.clipmartTemplates.isOfficial, true),
            isNull(schema.clipmartTemplates.deletedAt),
          ),
        )
        .limit(1),
    )

    if (existing) {
      await withTenantDb(officialTenantId, (tdb) =>
        tdb
          .update(schema.clipmartTemplates)
          .set({
            description: template.description ?? null,
            category: template.category,
            targetMarkets: template.targetMarkets ?? [],
            targetCategories: template.targetCategories ?? [],
            platforms: template.platforms ?? [],
            config: validation.sanitizedConfig!,
            isOfficial: true,
            isPublic: true,
          })
          .where(eq(schema.clipmartTemplates.id, existing.id)),
      )
      console.log(`UPDATED: ${template.name}`)
    } else {
      await withTenantDb(officialTenantId, (tdb) =>
        tdb.insert(schema.clipmartTemplates).values({
          authorTenantId: officialTenantId,
          name: template.name,
          description: template.description ?? null,
          category: template.category,
          targetMarkets: template.targetMarkets ?? [],
          targetCategories: template.targetCategories ?? [],
          platforms: template.platforms ?? [],
          config: validation.sanitizedConfig!,
          performance: {},
          isOfficial: true,
          isPublic: true,
        }),
      )
      console.log(`CREATED: ${template.name}`)
    }

    console.log(`   Category: ${template.category}`)
    console.log(`   Platforms: ${template.platforms?.join(', ') ?? 'none'}`)
    console.log(`   Markets: ${template.targetMarkets?.join(', ') ?? 'none'}`)
    console.log(`   Agents: ${agents.map((a) => a.type).join(', ')}`)
    console.log(`   Security: PASSED`)
    console.log()
    passed++
  }

  console.log('=== Summary ===')
  console.log(`Passed: ${passed}/${OFFICIAL_TEMPLATES.length}`)
  console.log(`Failed: ${failed}/${OFFICIAL_TEMPLATES.length}`)

  if (failed > 0) {
    await pool.end()
    process.exit(1)
  }

  console.log('\nAll official templates validated and written to database.')
  await pool.end()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
