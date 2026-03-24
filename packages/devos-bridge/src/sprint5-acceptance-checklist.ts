import { readFileSync } from 'node:fs'
import { defaultSlaForPriority, isDevOsTicket } from './ticket-protocol.js'
import { buildHarnessUpdateTicket } from './harness-update-ticket.js'
import { SRE_PROMETHEUS_ALERT_NAMES, sreAlertDevOsPriority } from './sre-alert-catalog.js'
import { isSamePostgresDatabase } from './electroos-devos-db-isolation.js'

export interface AcceptanceCheck {
  id: string
  description: string
  passed: boolean
  detail?: string
}

export interface Sprint5AcceptanceResult {
  checks: AcceptanceCheck[]
  allPassed: boolean
}

function readAlertRulesYaml(): string {
  return readFileSync(new URL('../prometheus/electroos-alerts.yml', import.meta.url), 'utf8')
}

function extractYamlAlertPriorities(yamlContent: string): Map<string, string> {
  const priorities = new Map<string, string>()
  let currentAlert: string | null = null

  for (const line of yamlContent.split('\n')) {
    const trimmed = line.trim()
    const alertMatch = trimmed.match(/^-?\s*alert:\s*(\S+)$/)
    if (alertMatch) {
      currentAlert = alertMatch[1]
      continue
    }

    const priorityMatch = trimmed.match(/^devos_priority:\s*(\S+)$/)
    if (currentAlert && priorityMatch) {
      priorities.set(currentAlert, priorityMatch[1])
    }
  }

  return priorities
}

/** AC-1: DevOsTicket 协议完整可用（type / priority / SLA / isDevOsTicket）。 */
export function checkTicketProtocolIntegrity(): AcceptanceCheck {
  const id = 'AC-1'
  const description = 'DevOsTicket protocol integrity (types + SLA + validation)'
  try {
    const sla = defaultSlaForPriority('P0')
    const ticket = {
      type: 'bug' as const,
      priority: 'P0' as const,
      title: 'acceptance-check',
      description: 'synthetic',
      context: {},
      sla,
    }
    const valid = isDevOsTicket(ticket)
    const invalidReject = !isDevOsTicket({ type: 'bad' })
    if (!valid || !invalidReject) {
      return { id, description, passed: false, detail: `valid=${valid} invalidReject=${invalidReject}` }
    }
    return { id, description, passed: true }
  } catch (err) {
    return { id, description, passed: false, detail: String(err) }
  }
}

/** AC-2: Harness 报错可生成合法 DevOsTicket。 */
export function checkHarnessToDevOsFlow(): AcceptanceCheck {
  const id = 'AC-2'
  const description = 'Harness error → buildHarnessUpdateTicket → isDevOsTicket'
  try {
    const ticket = buildHarnessUpdateTicket({
      platform: 'shopify',
      code: 'rate_limit',
      message: 'Too many requests',
    })
    const valid = isDevOsTicket(ticket)
    if (!valid) {
      return { id, description, passed: false, detail: 'built ticket fails isDevOsTicket' }
    }
    if (ticket.type !== 'harness_update') {
      return { id, description, passed: false, detail: `expected type harness_update, got ${ticket.type}` }
    }
    return { id, description, passed: true }
  } catch (err) {
    return { id, description, passed: false, detail: String(err) }
  }
}

/** AC-3: SRE alert catalog 覆盖全部告警名，且优先级映射无漏。 */
export function checkAlertRulesCatalogComplete(): AcceptanceCheck {
  const id = 'AC-3'
  const description = 'SRE alert catalog covers all rules with priority mappings'
  try {
    const yamlContent = readAlertRulesYaml()
    const yamlAlerts = [...yamlContent.matchAll(/alert:\s*(\S+)/g)].map((m) => m[1])
    const yamlAlertSet = new Set(yamlAlerts)
    const catalogAlerts = [...SRE_PROMETHEUS_ALERT_NAMES]
    const catalogAlertSet = new Set<string>(catalogAlerts)

    const missingPriorityMappings = catalogAlerts.filter((name) => !sreAlertDevOsPriority(name))
    if (missingPriorityMappings.length > 0) {
      return {
        id,
        description,
        passed: false,
        detail: `missing priority for: ${missingPriorityMappings.join(', ')}`,
      }
    }

    const missingInCatalog = yamlAlerts.filter((name) => !catalogAlertSet.has(name))
    if (missingInCatalog.length > 0) {
      return {
        id,
        description,
        passed: false,
        detail: `alerts missing from catalog: ${missingInCatalog.join(', ')}`,
      }
    }

    const missingInYaml = catalogAlerts.filter((name) => !yamlAlertSet.has(name))
    if (missingInYaml.length > 0) {
      return {
        id,
        description,
        passed: false,
        detail: `catalog alerts missing from yaml: ${missingInYaml.join(', ')}`,
      }
    }

    const yamlPriorities = extractYamlAlertPriorities(yamlContent)
    const mismatchedPriorities = catalogAlerts.filter((name) => {
      const yamlPriority = yamlPriorities.get(name)
      return yamlPriority !== sreAlertDevOsPriority(name)
    })
    if (mismatchedPriorities.length > 0) {
      return {
        id,
        description,
        passed: false,
        detail: `priority mismatch for: ${mismatchedPriorities.join(', ')}`,
      }
    }

    return { id, description, passed: true }
  } catch (err) {
    return { id, description, passed: false, detail: String(err) }
  }
}

/** AC-4: DB 隔离逻辑正确拒绝同库、接受异库。 */
export function checkDbIsolationLogic(): AcceptanceCheck {
  const id = 'AC-4'
  const description = 'DB isolation logic rejects same DB, accepts distinct DBs'
  try {
    const same = isSamePostgresDatabase(
      'postgresql://u:p@localhost:5432/electroos',
      'postgresql://u:p@localhost:5432/electroos',
    )
    const different = isSamePostgresDatabase(
      'postgresql://u:p@localhost:5432/electroos',
      'postgresql://u:p@localhost:5433/devos',
    )
    if (!same) {
      return { id, description, passed: false, detail: 'same URLs not detected as same' }
    }
    if (different) {
      return { id, description, passed: false, detail: 'distinct URLs incorrectly detected as same' }
    }
    return { id, description, passed: true }
  } catch (err) {
    return { id, description, passed: false, detail: String(err) }
  }
}

/** 汇总运行全部 Sprint 5 验收项。 */
export function runSprint5AcceptanceChecklist(): Sprint5AcceptanceResult {
  const checks = [
    checkTicketProtocolIntegrity(),
    checkHarnessToDevOsFlow(),
    checkAlertRulesCatalogComplete(),
    checkDbIsolationLogic(),
  ]
  return {
    checks,
    allPassed: checks.every((c) => c.passed),
  }
}
