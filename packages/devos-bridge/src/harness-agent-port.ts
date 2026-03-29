/**
 * Harness Agent Port — 模拟平台 API 升级检测与补丁 PR 生成（Phase 4 §S9 任务 9.9）
 *
 * Constitution §7.3：平台 API 变更后 48h 内更新 Harness。
 * AC-P4-06：Harness Agent 检测 Shopify API 升级 → 48h 内提交 PR。
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiChangelog {
  platform: string
  previousVersion: string
  newVersion: string
  breakingChanges: BreakingChange[]
  newFields: string[]
  deprecations: string[]
  changeDate: string
}

export interface BreakingChange {
  endpoint: string
  description: string
  migration: string
}

export interface HarnessChangeReport {
  platform: string
  previousVersion: string
  newVersion: string
  impactLevel: 'breaking' | 'non-breaking'
  affectedFiles: string[]
  requiredChanges: RequiredChange[]
  estimatedHours: number
}

export interface RequiredChange {
  file: string
  description: string
  type: 'update_version' | 'update_endpoint' | 'add_field' | 'remove_deprecated'
}

export interface HarnessPatch {
  platform: string
  apiVersion: string
  files: PatchFile[]
  testUpdates: string[]
  commitMessage: string
}

export interface PatchFile {
  path: string
  diff: string
}

export interface HarnessAgentPort {
  detectApiChange(platform: string, changelog: ApiChangelog): Promise<HarnessChangeReport>
  generatePatch(report: HarnessChangeReport): Promise<HarnessPatch>
  submitPR(patch: HarnessPatch): Promise<{ prId: string; estimatedHours: number }>
}

// ─── Mock Shopify Changelog ───────────────────────────────────────────────────

export const MOCK_SHOPIFY_CHANGELOG: ApiChangelog = {
  platform: 'shopify',
  previousVersion: '2024-10',
  newVersion: '2025-01',
  breakingChanges: [
    {
      endpoint: 'GET /admin/api/{version}/products.json',
      description: 'variants field renamed to product_variants',
      migration: 'Update response parsing: .variants → .product_variants',
    },
  ],
  newFields: ['product.metafields_global', 'product.category_taxonomy_id'],
  deprecations: ['product.body_html (use product.description_html)'],
  changeDate: '2025-01-15',
}

// ─── Deterministic Implementation ─────────────────────────────────────────────

export function createDeterministicHarnessAgent(): HarnessAgentPort {
  return {
    async detectApiChange(platform, changelog) {
      const affectedFiles = resolveAffectedFiles(platform)
      const primaryFile = affectedFiles[0]
      const requiredChanges: RequiredChange[] = []

      requiredChanges.push({
        file: primaryFile,
        description: `Update API version from ${changelog.previousVersion} to ${changelog.newVersion}`,
        type: 'update_version',
      })

      for (const bc of changelog.breakingChanges) {
        requiredChanges.push({
          file: primaryFile,
          description: bc.migration,
          type: 'update_endpoint',
        })
      }

      for (const field of changelog.newFields) {
        requiredChanges.push({
          file: primaryFile,
          description: `Add support for new field: ${field}`,
          type: 'add_field',
        })
      }

      for (const dep of changelog.deprecations) {
        requiredChanges.push({
          file: primaryFile,
          description: `Remove deprecated usage: ${dep}`,
          type: 'remove_deprecated',
        })
      }

      const hasBreaking = changelog.breakingChanges.length > 0
      const baseHours = hasBreaking ? 8 : 2
      const perChange = requiredChanges.length * 1.5
      const estimatedHours = Math.min(baseHours + perChange, 40)

      return {
        platform,
        previousVersion: changelog.previousVersion,
        newVersion: changelog.newVersion,
        impactLevel: hasBreaking ? 'breaking' : 'non-breaking',
        affectedFiles,
        requiredChanges,
        estimatedHours,
      }
    },

    async generatePatch(report) {
      const files: PatchFile[] = []
      const testUpdates: string[] = []

      for (const change of report.requiredChanges) {
        switch (change.type) {
          case 'update_version': {
            files.push({
              path: change.file,
              diff: [
                `--- a/${change.file}`,
                `+++ b/${change.file}`,
                `@@ -1,5 +1,5 @@`,
                `-const API_VERSION = '${report.previousVersion}'`,
                `+const API_VERSION = '${report.newVersion}'`,
              ].join('\n'),
            })
            break
          }
          case 'update_endpoint': {
            files.push({
              path: change.file,
              diff: [
                `--- a/${change.file}`,
                `+++ b/${change.file}`,
                `// ${change.description}`,
              ].join('\n'),
            })
            break
          }
          case 'add_field': {
            files.push({
              path: change.file,
              diff: `// Add field: ${change.description}`,
            })
            break
          }
          case 'remove_deprecated': {
            files.push({
              path: change.file,
              diff: `// Remove deprecated: ${change.description}`,
            })
            break
          }
          default: {
            const _exhaustive: never = change.type
            throw new Error(`Unknown change type: ${String(_exhaustive)}`)
          }
        }
      }

      const testFile = report.affectedFiles[0]?.replace('.ts', '.test.ts')
        ?? `packages/harness/src/${report.platform}.harness.test.ts`
      testUpdates.push(testFile)

      return {
        platform: report.platform,
        apiVersion: report.newVersion,
        files,
        testUpdates,
        commitMessage: `fix(harness): update ${report.platform} harness to API ${report.newVersion}\n\n${report.impactLevel === 'breaking' ? 'BREAKING: ' : ''}${report.requiredChanges.map((c) => `- ${c.description}`).join('\n')}`,
      }
    },

    async submitPR(patch) {
      const prId = `PR-${Date.now()}`
      const estimatedHours = Math.min(patch.files.length * 4, 48)
      return { prId, estimatedHours }
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAffectedFiles(platform: string): [string, ...string[]] {
  return [
    `packages/harness/src/${platform}.harness.ts`,
    `packages/harness/src/${platform}.harness.test.ts`,
    `packages/harness/src/${platform}.types.ts`,
  ]
}
