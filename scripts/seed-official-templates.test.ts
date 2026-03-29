import { describe, expect, it } from 'vitest'
import { OFFICIAL_TEMPLATES } from '../packages/clipmart/src/official-templates.js'
import { validateTemplateConfig } from '../packages/clipmart/src/security-validator.js'

describe('seed-official-templates', () => {
  it('all 5 official templates pass security validation', () => {
    expect(OFFICIAL_TEMPLATES).toHaveLength(5)
    for (const template of OFFICIAL_TEMPLATES) {
      const result = validateTemplateConfig(template.config)
      expect(result.valid, `Template "${template.name}" failed validation: ${result.errors.map((e) => e.message).join('; ')}`).toBe(true)
    }
  })

  it('no template contains tenantId in config', () => {
    for (const template of OFFICIAL_TEMPLATES) {
      const json = JSON.stringify(template.config)
      expect(json).not.toContain('"tenantId"')
      expect(json).not.toContain('"tenant_id"')
    }
  })

  it('seed data does not hardcode authorTenantId', () => {
    for (const template of OFFICIAL_TEMPLATES) {
      expect(template).not.toHaveProperty('authorTenantId')
    }
  })
})
