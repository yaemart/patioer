/** DevOS Ticket 协议类型（与 `packages/db` 中 `devos_tickets` 行语义对齐，供 5.3 HTTP 客户端使用）。 */

export type DevOsTicketType = 'bug' | 'feature' | 'harness_update' | 'performance' | 'coordination'

export type DevOsTicketPriority = 'P0' | 'P1' | 'P2'

export type DevOsSlaAcknowledge = '1h' | '4h' | '24h'

export type DevOsSlaResolve = '4h' | '24h' | '48h' | '72h'

export interface DevOsTicketContext {
  platform?: string
  agentId?: string
  errorLog?: string
  reproSteps?: string[]
  tenantId?: string
}

export interface DevOsTicket {
  type: DevOsTicketType
  priority: DevOsTicketPriority
  title: string
  description: string
  context: DevOsTicketContext
  sla: {
    acknowledge: DevOsSlaAcknowledge
    resolve: DevOsSlaResolve
  }
}

/** DevOS 实例返回的 Ticket 状态（HTTP 客户端 `getTicketStatus`）。 */
export type TicketStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed'

const TICKET_TYPES = new Set<DevOsTicketType>(['bug', 'feature', 'harness_update', 'performance', 'coordination'])
const PRIORITIES = new Set<DevOsTicketPriority>(['P0', 'P1', 'P2'])
const ACK = new Set<DevOsSlaAcknowledge>(['1h', '4h', '24h'])
const RES = new Set<DevOsSlaResolve>(['4h', '24h', '48h', '72h'])

/** 按优先级给出默认 SLA（告警升级规则可在 5.7 覆盖）。 */
export function defaultSlaForPriority(priority: DevOsTicketPriority): DevOsTicket['sla'] {
  switch (priority) {
    case 'P0':
      return { acknowledge: '1h', resolve: '4h' }
    case 'P1':
      return { acknowledge: '4h', resolve: '24h' }
    case 'P2':
      return { acknowledge: '24h', resolve: '72h' }
    default: {
      const _exhaustive: never = priority
      throw new Error(`Unknown priority: ${_exhaustive}`)
    }
  }
}

/** CEO Agent coordination ticket 等类型的默认优先级（ADR-0004 D20）。 */
export function defaultPriorityForType(type: DevOsTicketType): DevOsTicketPriority {
  switch (type) {
    case 'bug':
      return 'P1'
    case 'feature':
      return 'P2'
    case 'harness_update':
      return 'P1'
    case 'performance':
      return 'P2'
    case 'coordination':
      return 'P2'
    default: {
      const _exhaustive: never = type
      throw new Error(`Unknown ticket type: ${_exhaustive}`)
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isDevOsTicketContext(v: unknown): v is DevOsTicketContext {
  if (!isPlainObject(v)) return false
  if (v.platform !== undefined && typeof v.platform !== 'string') return false
  if (v.agentId !== undefined && typeof v.agentId !== 'string') return false
  if (v.errorLog !== undefined && typeof v.errorLog !== 'string') return false
  if (v.tenantId !== undefined && typeof v.tenantId !== 'string') return false
  if (v.reproSteps !== undefined) {
    if (!Array.isArray(v.reproSteps) || !v.reproSteps.every((x) => typeof x === 'string')) return false
  }
  return true
}

/** 浅层校验：用于边界入口（脚本、测试）；HTTP 客户端可对响应再做 Zod。 */
export function isDevOsTicket(value: unknown): value is DevOsTicket {
  if (!isPlainObject(value)) return false
  const t = value.type
  const p = value.priority
  const title = value.title
  const desc = value.description
  const ctx = value.context
  const sla = value.sla
  if (!TICKET_TYPES.has(t as DevOsTicketType)) return false
  if (!PRIORITIES.has(p as DevOsTicketPriority)) return false
  if (typeof title !== 'string' || title.length === 0) return false
  if (typeof desc !== 'string') return false
  if (!isDevOsTicketContext(ctx)) return false
  if (!isPlainObject(sla)) return false
  const ack = sla.acknowledge
  const res = sla.resolve
  if (!ACK.has(ack as DevOsSlaAcknowledge)) return false
  if (!RES.has(res as DevOsSlaResolve)) return false
  return true
}
