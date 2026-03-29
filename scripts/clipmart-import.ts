#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createImportService,
  createSingleTemplateStore,
} from '../packages/clipmart/src/index.js'
import type {
  AgentManager,
  ClipmartTemplate,
  EventRecorder,
} from '../packages/clipmart/src/index.js'
import {
  createDbClipmartAgentManager,
  createDbClipmartEventRecorder,
} from '../apps/api/src/lib/clipmart-runtime.js'

interface LegacyClipmartTemplateDocument {
  templateId: string
  version?: string
  name: string
  description?: string
  agents?: unknown[]
  governance?: Record<string, unknown>
  dataos?: Record<string, unknown>
  platforms?: {
    supported?: string[]
    defaultPlatform?: string
  }
  metadata?: {
    tags?: string[]
  }
}

interface ModernClipmartTemplateDocument {
  templateId?: string
  name: string
  description?: string
  category: string
  targetMarkets?: string[]
  targetCategories?: string[]
  platforms?: string[]
  isOfficial?: boolean
  config: Record<string, unknown>
}

export interface ClipmartImportRuntimeDeps {
  agentManager: AgentManager
  eventRecorder: EventRecorder
}

export interface ClipmartImportSummary {
  tenantId: string
  templateId: string
  templateName: string
  agentsImported: number
  governanceApplied: boolean
  downloads: number
  importedAt: string
  estimatedReadyMinutes: number
  platforms: string[]
  governance: Record<string, unknown> | null
  dataos: Record<string, unknown> | null
}

export function parseArgs(argv: string[]): { tenantId: string; templatePath: string } {
  let tenantId = ''
  let template = ''

  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) tenantId = arg.slice('--tenant='.length)
    else if (arg.startsWith('--template=')) template = arg.slice('--template='.length)
  }

  if (!tenantId) {
    console.error('ERROR: --tenant=<uuid> is required')
    process.exit(1)
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(tenantId)) {
    console.error(`ERROR: Invalid tenant UUID: ${tenantId}`)
    process.exit(1)
  }

  let templatePath: string
  if (!template || template === 'standard') {
    templatePath = resolve(import.meta.dirname ?? '.', '../harness-config/clipmart-template.json')
  } else {
    templatePath = resolve(template)
  }

  return { tenantId, templatePath }
}

function isModernTemplateDocument(
  value: Record<string, unknown>,
): value is ModernClipmartTemplateDocument {
  return typeof value.category === 'string' && typeof value.config === 'object' && value.config !== null
}

export function normalizeTemplateDocument(
  parsed: Record<string, unknown>,
  templatePath: string,
): ClipmartTemplate {
  if (isModernTemplateDocument(parsed)) {
    const templateId
      = typeof parsed.templateId === 'string' && parsed.templateId.length > 0
        ? parsed.templateId
        : templatePath.split('/').pop()?.replace(/\.json$/i, '') ?? 'clipmart-template'

    return {
      id: templateId,
      authorTenantId: null,
      name: parsed.name,
      description: parsed.description ?? null,
      category: parsed.category,
      targetMarkets: parsed.targetMarkets ?? [],
      targetCategories: parsed.targetCategories ?? [],
      platforms: parsed.platforms ?? [],
      config: parsed.config,
      performance: {},
      downloads: 0,
      rating: null,
      isOfficial: parsed.isOfficial ?? false,
      isPublic: true,
      createdAt: new Date(),
      deletedAt: null,
    }
  }

  const legacy = parsed as LegacyClipmartTemplateDocument
  const agents = Array.isArray(legacy.agents) ? legacy.agents : []
  if (!legacy.templateId || agents.length === 0) {
    throw new Error('Template missing required fields (templateId, agents)')
  }

  const supportedPlatforms = Array.isArray(legacy.platforms?.supported)
    ? legacy.platforms.supported
    : []
  const complianceMarkets = Array.isArray(legacy.governance?.complianceMarkets)
    ? (legacy.governance.complianceMarkets as string[])
    : []

  return {
    id: legacy.templateId,
    authorTenantId: null,
    name: legacy.name,
    description: legacy.description ?? null,
    category: 'full-stack',
    targetMarkets: complianceMarkets,
    targetCategories: [],
    platforms: supportedPlatforms,
    config: {
      agents,
      governance: legacy.governance ?? {},
      dataos: legacy.dataos ?? {},
      platforms: legacy.platforms ?? {},
    },
    performance: {},
    downloads: 0,
    rating: null,
    isOfficial: true,
    isPublic: true,
    createdAt: new Date(),
    deletedAt: null,
  }
}

export function loadTemplate(templatePath: string): ClipmartTemplate {
  let raw: string
  try {
    raw = readFileSync(templatePath, 'utf-8')
  } catch {
    throw new Error(`Cannot read template file: ${templatePath}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`Invalid JSON in template: ${templatePath}`)
  }

  return normalizeTemplateDocument(parsed, templatePath)
}

export function createDefaultRuntimeDeps(): ClipmartImportRuntimeDeps {
  return {
    agentManager: createDbClipmartAgentManager(),
    eventRecorder: createDbClipmartEventRecorder(),
  }
}

export async function executeImport(
  tenantId: string,
  template: ClipmartTemplate,
  deps: ClipmartImportRuntimeDeps = createDefaultRuntimeDeps(),
): Promise<ClipmartImportSummary> {
  const templateStore = createSingleTemplateStore(template)
  const importService = createImportService({
    templateStore,
    agentManager: deps.agentManager,
    eventRecorder: deps.eventRecorder,
  })
  const importedAt = new Date().toISOString()
  const result = await importService.importTemplate(tenantId, template.id)
  const importedTemplate = await templateStore.getById(template.id)
  const config = template.config
  const agents = Array.isArray(config.agents) ? config.agents : []

  return {
    tenantId,
    templateId: result.templateId,
    templateName: template.name,
    agentsImported: result.agentsImported,
    governanceApplied: result.governanceApplied,
    downloads: importedTemplate?.downloads ?? 0,
    importedAt,
    estimatedReadyMinutes: Math.ceil(agents.length * 2),
    platforms: template.platforms,
    governance:
      config.governance && typeof config.governance === 'object'
        ? (config.governance as Record<string, unknown>)
        : null,
    dataos:
      config.dataos && typeof config.dataos === 'object'
        ? (config.dataos as Record<string, unknown>)
        : null,
  }
}

async function main(): Promise<void> {
  console.log('ClipMart Template Import\n')

  const { tenantId, templatePath } = parseArgs(process.argv.slice(2))
  const template = loadTemplate(templatePath)
  const result = await executeImport(tenantId, template)

  console.log('\n' + '='.repeat(60))
  console.log('Import Summary')
  console.log('='.repeat(60))
  console.log(`  Template:       ${result.templateId} (${result.templateName})`)
  console.log(`  Tenant:         ${result.tenantId}`)
  console.log(`  Agents Imported:${result.agentsImported}`)
  console.log(`  Downloads:      ${result.downloads}`)
  console.log(`  Platforms:      ${result.platforms.join(', ') || 'n/a'}`)
  if (result.governance && typeof result.governance.monthlyBudgetUsd === 'number') {
    console.log(`  Budget:         $${result.governance.monthlyBudgetUsd}/mo`)
  }
  console.log(`  Est. Ready:     ~${result.estimatedReadyMinutes} minutes`)
  console.log(`  Imported At:    ${result.importedAt}`)
  console.log('='.repeat(60))
  console.log('\nImport complete.\n')
}

const isDirectExecution = process.argv[1] != null
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
