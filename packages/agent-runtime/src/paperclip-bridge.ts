import type { TicketParams } from './types.js'

interface CreateCompanyInput {
  name: string
}

interface CreateAgentInput {
  companyId: string
  name: string
}

interface PaperclipErrorBody {
  message?: string
  error?: string
}

export class PaperclipBridge {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async createCompany(input: CreateCompanyInput): Promise<{ id: string }> {
    const payload = await this.postJson(['/api/companies', '/companies'], input)
    return { id: this.extractEntityId(payload, 'company') }
  }

  async createAgent(input: CreateAgentInput): Promise<{ id: string }> {
    const payload = await this.postJson(['/api/agents', '/agents'], input)
    return { id: this.extractEntityId(payload, 'agent') }
  }

  async createIssue(params: TicketParams): Promise<{ id: string }> {
    const payload = await this.postJson(
      ['/api/issues', '/issues', '/api/tickets', '/tickets'],
      params,
    )
    return { id: this.extractEntityId(payload, 'issue') }
  }

  get config(): { baseUrl: string; apiKey?: string } {
    return { baseUrl: this.baseUrl, apiKey: this.apiKey }
  }

  private buildUrl(path: string): string {
    return new URL(path, this.baseUrl).toString()
  }

  private buildHeaders(): Record<string, string> {
    if (!this.apiKey) {
      return { 'content-type': 'application/json' }
    }
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'x-api-key': this.apiKey,
    }
  }

  /**
   * Tries each path in order.
   *
   * Fallback to the next path only for:
   *   - network-level errors (e.g. ECONNREFUSED)
   *   - 404 Not Found (endpoint does not exist on this Paperclip version)
   *
   * Any other HTTP error (401, 403, 409, 500 …) is thrown immediately
   * without attempting further endpoints, so callers receive a meaningful
   * error instead of silently masking it behind a "no valid endpoint" message.
   */
  private async postJson(paths: string[], body: unknown): Promise<unknown> {
    let lastNetworkError: Error | null = null

    for (const path of paths) {
      let response: Response

      try {
        response = await fetch(this.buildUrl(path), {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        })
      } catch (networkError) {
        // Transport-level failure — try the next candidate endpoint.
        lastNetworkError =
          networkError instanceof Error
            ? networkError
            : new Error(String(networkError))
        continue
      }

      // Endpoint not registered on this Paperclip deployment — try the next.
      if (response.status === 404) {
        continue
      }

      // Any other HTTP error (401, 500, …): fail immediately.
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Paperclip API error ${response.status}: ${this.parseErrorBody(errorText)}`,
        )
      }

      return await response.json()
    }

    if (lastNetworkError) {
      throw lastNetworkError
    }

    throw new Error('Paperclip API: no valid endpoint found among candidates')
  }

  private parseErrorBody(rawText: string): string {
    if (!rawText) return 'unknown error'
    try {
      const parsed = JSON.parse(rawText) as PaperclipErrorBody
      return parsed.message ?? parsed.error ?? rawText
    } catch {
      return rawText
    }
  }

  private extractEntityId(payload: unknown, entity: string): string {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Paperclip API returned invalid ${entity} response`)
    }
    const record = payload as Record<string, unknown>
    const id = record.id
    if (typeof id === 'string' && id.length > 0) return id
    const data = record.data
    if (data && typeof data === 'object') {
      const nestedId = (data as Record<string, unknown>).id
      if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId
    }
    throw new Error(`Paperclip API returned ${entity} without id`)
  }
}
