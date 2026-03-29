import { describe, expect, it } from 'vitest'
import { DEVOS_AGENT_IDS } from './devos-org-chart.js'
import { AGENT_SYSTEM_PROMPTS, validateAgentPrompts } from './agent-prompts.js'

describe('agent-prompts — Gap-03 resolution', () => {
  it('every DevOS Agent ID has a corresponding system prompt', () => {
    const result = validateAgentPrompts(DEVOS_AGENT_IDS)
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('all 12 agents are defined', () => {
    expect(Object.keys(AGENT_SYSTEM_PROMPTS)).toHaveLength(12)
  })

  for (const id of DEVOS_AGENT_IDS) {
    it(`${id} has non-empty role, responsibilities, tools, criteria, and outputFormat`, () => {
      const prompt = AGENT_SYSTEM_PROMPTS[id]
      expect(prompt.agentId).toBe(id)
      expect(prompt.role.length).toBeGreaterThan(0)
      expect(prompt.responsibilities.length).toBeGreaterThan(0)
      expect(prompt.availableTools.length).toBeGreaterThan(0)
      expect(prompt.judgmentCriteria.length).toBeGreaterThan(0)
      expect(prompt.outputFormat.length).toBeGreaterThan(0)
    })
  }
})
