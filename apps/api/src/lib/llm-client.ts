import type { LlmPort, LlmParams, LlmResponse } from '@patioer/agent-runtime'

const MODEL = process.env.LLM_MODEL ?? 'gpt-4o-mini'
const MAX_TOKENS = 1024

let _openai: import('openai').default | null = null

async function getOpenAI(): Promise<import('openai').default | null> {
  if (!process.env.OPENAI_API_KEY) return null
  if (!_openai) {
    const { default: OpenAI } = await import('openai')
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

/**
 * Create a `LlmPort` implementation that calls OpenAI when `OPENAI_API_KEY` is set.
 * Falls back to a no-op stub so all agents work without credentials.
 *
 * @param agentSystemPrompt - Per-agent system prompt stored in `agents.system_prompt`.
 *   Applied as the OpenAI `system` message unless the caller overrides via `params.systemPrompt`.
 */
export function createLlmProvider(agentSystemPrompt?: string | null): LlmPort {
  return {
    async complete(params: LlmParams, _context): Promise<LlmResponse> {
      const client = await getOpenAI()
      if (!client) {
        const preview = params.prompt.slice(0, 80)
        return { text: `[LLM stub] OPENAI_API_KEY not set. Prompt: ${preview}` }
      }

      const systemContent = params.systemPrompt ?? agentSystemPrompt ?? null
      const messages: Array<{ role: 'system' | 'user'; content: string }> = []
      if (systemContent) messages.push({ role: 'system', content: systemContent })
      messages.push({ role: 'user', content: params.prompt })

      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        max_tokens: MAX_TOKENS,
      })

      return { text: completion.choices[0]?.message?.content ?? '' }
    },
  }
}

/** Reset singleton for testing. */
export function _resetLlmClientForTesting(): void {
  _openai = null
}
