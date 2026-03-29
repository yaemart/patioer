import { describe, expect, it } from 'vitest'
import {
  createDeterministicHarnessAgent,
  MOCK_SHOPIFY_CHANGELOG,
  type ApiChangelog,
} from './harness-agent-port.js'

describe('AC-P4-06: Harness Agent — Shopify API 升级 → 48h PR', () => {
  it('detects Shopify API change and identifies breaking impact', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)

    expect(report.platform).toBe('shopify')
    expect(report.previousVersion).toBe('2024-10')
    expect(report.newVersion).toBe('2025-01')
    expect(report.impactLevel).toBe('breaking')
    expect(report.requiredChanges.length).toBeGreaterThan(0)
  })

  it('affected files include shopify.harness.ts', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)

    expect(report.affectedFiles.some((f) => f.includes('shopify.harness'))).toBe(true)
  })

  it('generates patch with version update diff', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)
    const patch = await agent.generatePatch(report)

    expect(patch.platform).toBe('shopify')
    expect(patch.apiVersion).toBe('2025-01')
    expect(patch.files.length).toBeGreaterThan(0)
    expect(patch.files.some((f) => f.path.includes('shopify.harness'))).toBe(true)

    const versionDiff = patch.files.find((f) => f.diff.includes('API_VERSION'))
    expect(versionDiff).toBeDefined()
    expect(versionDiff!.diff).toContain("'2025-01'")
  })

  it('generates patch with test updates', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)
    const patch = await agent.generatePatch(report)

    expect(patch.testUpdates.length).toBeGreaterThan(0)
    expect(patch.testUpdates.some((f) => f.includes('.test.'))).toBe(true)
  })

  it('commit message includes breaking change notice', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)
    const patch = await agent.generatePatch(report)

    expect(patch.commitMessage).toContain('BREAKING')
    expect(patch.commitMessage).toContain('shopify')
    expect(patch.commitMessage).toContain('2025-01')
  })

  it('submits PR within 48h SLA', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)
    const patch = await agent.generatePatch(report)
    const pr = await agent.submitPR(patch)

    expect(pr.prId).toBeTruthy()
    expect(pr.estimatedHours).toBeLessThanOrEqual(48)
  })
})

describe('Harness Agent — non-breaking change', () => {
  const NON_BREAKING: ApiChangelog = {
    platform: 'shopify',
    previousVersion: '2025-01',
    newVersion: '2025-04',
    breakingChanges: [],
    newFields: ['product.sustainability_rating'],
    deprecations: [],
    changeDate: '2025-04-01',
  }

  it('non-breaking change has lower impact level', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', NON_BREAKING)

    expect(report.impactLevel).toBe('non-breaking')
    expect(report.estimatedHours).toBeLessThan(10)
  })

  it('commit message does not include BREAKING for non-breaking', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', NON_BREAKING)
    const patch = await agent.generatePatch(report)

    expect(patch.commitMessage).not.toContain('BREAKING')
  })
})

describe('Harness Agent — exhaustive change type handling', () => {
  it('handles all 4 change types in a patch', async () => {
    const agent = createDeterministicHarnessAgent()
    const report = await agent.detectApiChange('shopify', MOCK_SHOPIFY_CHANGELOG)
    const patch = await agent.generatePatch(report)

    expect(patch.files.length).toBeGreaterThanOrEqual(4)
  })
})
