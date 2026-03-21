import { PaperclipBridgeError } from './paperclip-bridge.errors.js'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 200

export interface PaperclipBridgeOptions {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  maxRetries?: number
  retryBaseMs?: number
}

export interface EnsureCompanyInput {
  tenantId: string
  name: string
}

export interface EnsureProjectInput {
  companyId: string
  name: string
}

export interface EnsureAgentInput {
  companyId: string
  projectId: string
  name: string
  externalAgentId: string
}

export interface RegisterHeartbeatInput {
  companyId: string
  agentId: string
  cron: string
  callbackUrl: string
}

export interface BudgetStatus {
  limitUsd: number
  usedUsd: number
  remainingUsd: number
  exceeded: boolean
}

export class PaperclipBridge {
  constructor(private readonly options: PaperclipBridgeOptions) {}

  async ensureCompany(input: EnsureCompanyInput): Promise<{ id: string }> {
    const payload = await this.requestJson<unknown>('POST', '/api/companies/ensure', {
      tenant_id: input.tenantId,
      name: input.name,
    })
    return { id: this.normalizeId(payload, 'company') }
  }

  async ensureProject(input: EnsureProjectInput): Promise<{ id: string }> {
    const payload = await this.requestJson<unknown>('POST', '/api/projects/ensure', {
      company_id: input.companyId,
      name: input.name,
    })
    return { id: this.normalizeId(payload, 'project') }
  }

  async ensureAgent(input: EnsureAgentInput): Promise<{ id: string }> {
    const payload = await this.requestJson<unknown>('POST', '/api/agents/ensure', {
      company_id: input.companyId,
      project_id: input.projectId,
      name: input.name,
      external_agent_id: input.externalAgentId,
    })
    return { id: this.normalizeId(payload, 'agent') }
  }

  async registerHeartbeat(input: RegisterHeartbeatInput): Promise<{ id: string }> {
    const payload = await this.requestJson<unknown>('POST', '/api/heartbeats', {
      company_id: input.companyId,
      agent_id: input.agentId,
      cron: input.cron,
      callback_url: input.callbackUrl,
    })
    return { id: this.normalizeId(payload, 'heartbeat') }
  }

  async getBudgetStatus(companyId: string, agentId: string): Promise<BudgetStatus> {
    const payload = await this.requestJson<unknown>(
      'GET',
      `/api/companies/${companyId}/agents/${agentId}/budget`,
    )
    const data = this.asRecord(payload)
    const limitUsd = this.asNumber(data.limit_usd ?? data.limitUsd)
    const usedUsd = this.asNumber(data.used_usd ?? data.usedUsd)
    const remainingUsd = this.asNumber(
      data.remaining_usd ?? data.remainingUsd ?? Math.max(limitUsd - usedUsd, 0),
    )
    const exceeded = remainingUsd <= 0 || usedUsd >= limitUsd
    return { limitUsd, usedUsd, remainingUsd, exceeded }
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES
    const retryBaseMs = this.options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const init: RequestInit = {
          method,
          headers: this.buildHeaders(),
        }
        if (body !== undefined) {
          init.body = JSON.stringify(body)
        }
        const res = await this.withTimeout(
          fetch(`${this.options.baseUrl}${path}`, init),
          this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        )

        const responseBody = await this.parseResponseBody(res)
        if (!res.ok) {
          const error = this.mapHttpError(res.status, responseBody)
          if (this.shouldRetry(res.status) && attempt < maxRetries) {
            await this.sleep(retryBaseMs * 2 ** attempt)
            continue
          }
          throw error
        }

        return responseBody as T
      } catch (error) {
        const bridgeError =
          error instanceof PaperclipBridgeError
            ? error
            : new PaperclipBridgeError('Paperclip request failed', {
                code: 'network_error',
                details: error,
              })
        lastError = bridgeError
        if (bridgeError.code === 'network_error' && attempt < maxRetries) {
          await this.sleep(retryBaseMs * 2 ** attempt)
          continue
        }
        throw bridgeError
      }
    }

    throw (
      lastError ??
      new PaperclipBridgeError('Paperclip request failed', {
        code: 'unknown',
      })
    )
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new PaperclipBridgeError(`Paperclip request timed out after ${timeoutMs}ms`, {
            code: 'network_error',
          }),
        )
      }, timeoutMs)

      promise
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  private shouldRetry(status?: number): boolean {
    if (!status) return false
    return status === 429 || status >= 500
  }

  private mapHttpError(status: number, payload: unknown): PaperclipBridgeError {
    if (status === 401) {
      return new PaperclipBridgeError('Paperclip unauthorized', {
        code: 'unauthorized',
        status,
        details: payload,
      })
    }
    if (status === 403) {
      return new PaperclipBridgeError('Paperclip forbidden', {
        code: 'forbidden',
        status,
        details: payload,
      })
    }
    if (status === 404) {
      return new PaperclipBridgeError('Paperclip resource not found', {
        code: 'not_found',
        status,
        details: payload,
      })
    }
    if (status === 409) {
      return new PaperclipBridgeError('Paperclip conflict', {
        code: 'conflict',
        status,
        details: payload,
      })
    }
    if (status === 429) {
      return new PaperclipBridgeError('Paperclip rate limited', {
        code: 'rate_limited',
        status,
        details: payload,
      })
    }
    if (status >= 500) {
      return new PaperclipBridgeError('Paperclip server error', {
        code: 'server_error',
        status,
        details: payload,
      })
    }
    return new PaperclipBridgeError(`Paperclip request failed with status ${status}`, {
      code: 'unknown',
      status,
      details: payload,
    })
  }

  private normalizeId(payload: unknown, entity: string): string {
    const data = this.asRecord(payload)
    const maybeId = data.id
    if (typeof maybeId === 'string' && maybeId.length > 0) return maybeId
    throw new PaperclipBridgeError(`Paperclip ${entity} response missing id`, {
      code: 'invalid_response',
      details: payload,
    })
  }

  private async parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text) as unknown
    } catch {
      return { raw: text }
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
      throw new PaperclipBridgeError('Paperclip response is not an object', {
        code: 'invalid_response',
        details: value,
      })
    }
    return value as Record<string, unknown>
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    throw new PaperclipBridgeError('Paperclip budget response has invalid numeric fields', {
      code: 'invalid_response',
      details: value,
    })
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}
