import { describe, it, expect } from 'vitest'
import {
  buildPromptStack,
  flattenPromptStack,
  SYSTEM_CONSTITUTION_PROMPT,
  getPlatformPolicyPrompt,
} from './prompt-stack.js'
import type { AgentContext } from './context.js'
import type { ExtractedSop } from './prompt-stack.js'

function makeMockCtx(platforms: string[] = []): AgentContext {
  return {
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    getEnabledPlatforms: () => platforms,
    getHarness: () => { throw new Error('not wired') },
    describeDataOsCapabilities: () => '',
    llm: async () => ({ text: '' }),
    budget: { isExceeded: async () => false },
    logAction: async () => {},
    requestApproval: async () => {},
    createTicket: async () => {},
    listPendingApprovals: async () => [],
    getRecentEvents: async () => [],
    getEventsForAgent: async () => [],
    getGovernanceSettings: async () => ({
      priceChangeThreshold: 15,
      adsBudgetApproval: 500,
      newListingApproval: true,
      humanInLoopAgents: [],
      approvalMode: 'approval_required' as const,
    }),
    getEffectiveGovernance: async () => ({
      priceChangeThreshold: 15,
      adsBudgetApproval: 500,
      newListingApproval: true,
      humanInLoopAgents: [],
      approvalMode: 'approval_required' as const,
    }),
    isHumanInLoop: async () => false,
    getActiveSop: async () => null,
  }
}

describe('buildPromptStack', () => {
  it('L0: constitution is always first in system message', () => {
    const messages = buildPromptStack(makeMockCtx(), null)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('ABSOLUTE CONSTRAINTS')
    expect(messages[0].content.indexOf('ABSOLUTE CONSTRAINTS')).toBeLessThan(100)
  })

  it('L0: constitution content matches exported constant', () => {
    const messages = buildPromptStack(makeMockCtx(), null)
    expect(messages[0].content).toContain(SYSTEM_CONSTITUTION_PROMPT)
  })

  it('L2: platform policy is included when platforms are enabled', () => {
    const messages = buildPromptStack(makeMockCtx(['amazon', 'shopify']), null)
    expect(messages[0].content).toContain('PLATFORM POLICIES')
    expect(messages[0].content).toContain('Amazon Seller Central')
    expect(messages[0].content).toContain('Shopify')
  })

  it('L2: no platform policy section when no platforms', () => {
    const messages = buildPromptStack(makeMockCtx([]), null)
    expect(messages[0].content).not.toContain('PLATFORM POLICIES')
  })

  it('L3: SOP is in user message, not system message', () => {
    const sop: ExtractedSop = {
      extractedSystemPrompt: 'Focus on high-margin products only.',
      extractedGoalContext: { minMarginPercent: 20 },
    }
    const messages = buildPromptStack(makeMockCtx(), sop)

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('SELLER OPERATING PROCEDURE')
    expect(messages[1].content).toContain('Focus on high-margin products only.')
    expect(messages[0].content).not.toContain('Focus on high-margin')
  })

  it('no user message when SOP is null', () => {
    const messages = buildPromptStack(makeMockCtx(), null)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('system')
  })

  it('no user message when SOP has empty systemPrompt', () => {
    const sop: ExtractedSop = {
      extractedSystemPrompt: '',
      extractedGoalContext: { minMarginPercent: 10 },
    }
    const messages = buildPromptStack(makeMockCtx(), sop)
    expect(messages).toHaveLength(1)
  })

  it('no user message when SOP systemPrompt is null', () => {
    const sop: ExtractedSop = {
      extractedSystemPrompt: null,
      extractedGoalContext: null,
    }
    const messages = buildPromptStack(makeMockCtx(), sop)
    expect(messages).toHaveLength(1)
  })

  it('includes DataOS capabilities when available', () => {
    const ctx = makeMockCtx()
    ctx.describeDataOsCapabilities = () => 'Real-time event lake with 30-day retention.'
    const messages = buildPromptStack(ctx, null)
    expect(messages[0].content).toContain('DATA CAPABILITIES')
    expect(messages[0].content).toContain('Real-time event lake')
  })
})

describe('getPlatformPolicyPrompt', () => {
  it('returns empty string for no platforms', () => {
    expect(getPlatformPolicyPrompt(makeMockCtx([]))).toBe('')
  })

  it('returns policy for single platform', () => {
    const result = getPlatformPolicyPrompt(makeMockCtx(['amazon']))
    expect(result).toContain('Amazon Seller Central')
  })

  it('returns combined policies for multiple platforms', () => {
    const result = getPlatformPolicyPrompt(makeMockCtx(['amazon', 'tiktok']))
    expect(result).toContain('Amazon Seller Central')
    expect(result).toContain('TikTok Shop')
  })

  it('gracefully handles unknown platform', () => {
    const result = getPlatformPolicyPrompt(makeMockCtx(['unknown-platform']))
    expect(result).toBe('')
  })
})

describe('flattenPromptStack', () => {
  it('combines system + SOP user + task into LlmParams shape', () => {
    const sop: ExtractedSop = {
      extractedSystemPrompt: 'Prioritise margin.',
      extractedGoalContext: null,
    }
    const stack = buildPromptStack(makeMockCtx(['amazon']), sop)
    const params = flattenPromptStack(stack, 'Evaluate these 5 price proposals.')

    expect(params.systemPrompt).toContain('ABSOLUTE CONSTRAINTS')
    expect(params.systemPrompt).toContain('Amazon Seller Central')
    expect(params.prompt).toContain('Prioritise margin.')
    expect(params.prompt).toContain('Evaluate these 5 price proposals.')
  })

  it('works without SOP', () => {
    const stack = buildPromptStack(makeMockCtx(), null)
    const params = flattenPromptStack(stack, 'Do the thing.')

    expect(params.systemPrompt).toContain('ABSOLUTE CONSTRAINTS')
    expect(params.prompt).toBe('Do the thing.')
  })
})
