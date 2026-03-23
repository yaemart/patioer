import type { MarketContext } from '@patioer/market'
import { createMarketContext } from '@patioer/market'
import type { PaperclipBridge } from '@patioer/agent-runtime'
import { getRedisClient } from './redis.js'
import { createPaperclipBridgeFromEnv } from './paperclip-bridge.js'

export interface BudgetStatus {
  exceeded: boolean
  remaining: number
}

const BUDGET_CACHE_TTL_MS = 30_000

export interface ExecutionServices {
  getBridge(): PaperclipBridge | null
  getMarketContext(): MarketContext
  getBudgetStatus(tenantId: string, agentId: string): Promise<BudgetStatus>
}

export function createExecutionServices(): ExecutionServices {
  let marketContext: MarketContext | null = null
  let bridgeInstance: PaperclipBridge | null = null
  const companyIdCache = new Map<string, string>()
  const budgetCache = new Map<string, { status: BudgetStatus; expiresAt: number }>()

  function getBridge(): PaperclipBridge | null {
    if (!bridgeInstance) {
      bridgeInstance = createPaperclipBridgeFromEnv()
    }
    return bridgeInstance
  }

  function getMarketContext(): MarketContext {
    if (!marketContext) {
      marketContext = createMarketContext({ redis: getRedisClient() })
    }
    return marketContext
  }

  async function resolveCompanyId(bridge: PaperclipBridge, tenantId: string): Promise<string> {
    const cached = companyIdCache.get(tenantId)
    if (cached) return cached
    const company = await bridge.ensureCompany({ tenantId, name: `tenant-${tenantId}` })
    companyIdCache.set(tenantId, company.id)
    return company.id
  }

  async function getBudgetStatus(tenantId: string, agentId: string): Promise<BudgetStatus> {
    if (process.env.AGENT_BUDGET_FORCE_EXCEEDED === '1') {
      return { exceeded: true, remaining: 0 }
    }

    const bridge = getBridge()
    if (!bridge) {
      return { exceeded: false, remaining: Number.POSITIVE_INFINITY }
    }

    const cacheKey = `${tenantId}:${agentId}`
    const cached = budgetCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.status
    }

    try {
      const companyId = await resolveCompanyId(bridge, tenantId)
      const raw = await bridge.getBudgetStatus(companyId, agentId)
      const result: BudgetStatus = { exceeded: raw.exceeded, remaining: raw.remainingUsd }
      budgetCache.set(cacheKey, { status: result, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS })
      return result
    } catch {
      if (process.env.AGENT_BUDGET_FAIL_OPEN === '1') {
        return { exceeded: false, remaining: Number.POSITIVE_INFINITY }
      }
      return { exceeded: true, remaining: 0 }
    }
  }

  return { getBridge, getMarketContext, getBudgetStatus }
}

let _services: ExecutionServices | null = null

/** Returns the singleton ExecutionServices instance, creating one on first call. */
export function getExecutionServices(): ExecutionServices {
  if (!_services) {
    _services = createExecutionServices()
  }
  return _services
}
