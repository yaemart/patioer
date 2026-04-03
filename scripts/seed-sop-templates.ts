/**
 * Seed script for SOP scenario templates.
 *
 * Usage: pnpm exec tsx scripts/seed-sop-templates.ts
 *
 * Writes the 12 system-provided scenario templates into
 * the `sop_scenario_templates` table (upsert on unique constraint).
 */

import { db, schema } from '@patioer/db'
import { ALL_SCENARIO_TEMPLATES } from '@patioer/sop'

async function main() {
  console.log(`Seeding ${ALL_SCENARIO_TEMPLATES.length} SOP scenario templates...`)

  for (const template of ALL_SCENARIO_TEMPLATES) {
    await db
      .insert(schema.sopScenarioTemplates)
      .values({
        scenario: template.scenario,
        scope: template.scope,
        platform: template.platform,
        defaultSopText: template.defaultSopText,
        defaultGoalContext: template.defaultGoalContext,
        editableFields: template.editableFields,
        lockedFields: template.lockedFields,
      })
      .onConflictDoUpdate({
        target: [
          schema.sopScenarioTemplates.scenario,
          schema.sopScenarioTemplates.scope,
          schema.sopScenarioTemplates.platform,
        ],
        set: {
          defaultSopText: template.defaultSopText,
          defaultGoalContext: template.defaultGoalContext,
          editableFields: template.editableFields,
          lockedFields: template.lockedFields,
        },
      })

    console.log(`  ✓ ${template.scenario} / ${template.scope}`)
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
