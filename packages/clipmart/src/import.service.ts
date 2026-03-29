import { ClipmartError } from './clipmart.types.js'
import type { TemplateStore } from './template.service.js'
import { validateTemplateConfig } from './security-validator.js'

export interface AgentConfig {
  type: string
  name: string
  status: string
  goalContext?: Record<string, unknown>
  systemPrompt?: string
  [key: string]: unknown
}

export interface AgentManager {
  upsertAgent(tenantId: string, agent: AgentConfig): Promise<void>
}

export interface EventRecorder {
  record(event: {
    tenantId: string
    eventType: string
    payload: Record<string, unknown>
  }): Promise<void>
}

export interface ImportServiceDeps {
  templateStore: TemplateStore
  agentManager: AgentManager
  eventRecorder: EventRecorder
}

export interface ImportResult {
  templateId: string
  tenantId: string
  agentsImported: number
  governanceApplied: boolean
}

export function createImportService(deps: ImportServiceDeps) {
  const { templateStore, agentManager, eventRecorder } = deps

  async function importTemplate(
    tenantId: string,
    templateId: string,
    overrides?: Partial<Record<string, unknown>>,
  ): Promise<ImportResult> {
    const template = await templateStore.getById(templateId)
    if (!template) throw new ClipmartError(`Template not found: ${templateId}`, 'TEMPLATE_NOT_FOUND')

    const validation = validateTemplateConfig(template.config)
    if (!validation.valid) {
      const messages = validation.errors
        .filter((e) => e.rule !== 'sensitive_field')
        .map((e) => e.message)
      throw new ClipmartError(`Template security validation failed: ${messages.join('; ')}`, 'SECURITY_VIOLATION')
    }

    const safeConfig = validation.sanitizedConfig!
    const merged = overrides ? deepMerge(safeConfig, overrides) : safeConfig
    const mergedValidation = validateTemplateConfig(merged)
    if (!mergedValidation.valid) {
      const messages = mergedValidation.errors
        .filter((e) => e.rule !== 'sensitive_field')
        .map((e) => e.message)
      throw new ClipmartError(`Template security validation failed: ${messages.join('; ')}`, 'SECURITY_VIOLATION')
    }

    const finalConfig = mergedValidation.sanitizedConfig!
    const agents = extractAgents(finalConfig)
    for (const agent of agents) {
      const sanitized = { ...agent }
      delete (sanitized as Record<string, unknown>)['tenantId']
      delete (sanitized as Record<string, unknown>)['tenant_id']
      await agentManager.upsertAgent(tenantId, sanitized)
    }

    await templateStore.incrementDownloads(templateId)

    await eventRecorder.record({
      tenantId,
      eventType: 'template_imported',
      payload: {
        templateId,
        templateName: template.name,
        agentsImported: agents.length,
        isOfficial: template.isOfficial,
      },
    })

    return {
      templateId,
      tenantId,
      agentsImported: agents.length,
      governanceApplied: 'governance' in finalConfig,
    }
  }

  return { importTemplate }
}

export type ImportService = ReturnType<typeof createImportService>

function extractAgents(config: Record<string, unknown>): AgentConfig[] {
  const agents = config.agents
  if (!Array.isArray(agents)) return []
  return agents.filter(
    (a): a is AgentConfig => typeof a === 'object' && a !== null && 'type' in a,
  )
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const tVal = target[key]
    const sVal = source[key]
    if (isPlainObject(tVal) && isPlainObject(sVal)) {
      result[key] = deepMerge(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>,
      )
    } else {
      result[key] = sVal
    }
  }
  return result
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}
