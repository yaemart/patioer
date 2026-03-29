import { describe, it, expect } from 'vitest'
import {
  B2B_PRICE_SENTINEL_THRESHOLD_PERCENT,
  b2bPriceSentinelInput,
  B2B_SUPPORT_TONE_SYSTEM_PROMPT,
  b2bSupportRelayInput,
} from './b2b-agent-config.js'

describe('B2B Agent Config Overrides', () => {
  describe('Price Sentinel', () => {
    it('uses 5% threshold (vs 15% B2C default)', () => {
      expect(B2B_PRICE_SENTINEL_THRESHOLD_PERCENT).toBe(5)
    })

    it('b2bPriceSentinelInput injects 5% threshold', () => {
      const input = b2bPriceSentinelInput([
        { productId: 'p1', currentPrice: 100, proposedPrice: 104, reason: 'market' },
      ])
      expect(input.approvalThresholdPercent).toBe(5)
      expect(input.proposals).toHaveLength(1)
    })
  })

  describe('Support Relay', () => {
    it('uses formal B2B tone system prompt', () => {
      expect(B2B_SUPPORT_TONE_SYSTEM_PROMPT).toContain('formal business language')
      expect(B2B_SUPPORT_TONE_SYSTEM_PROMPT).toContain('company name')
    })

    it('b2bSupportRelayInput injects tone prompt', () => {
      const input = b2bSupportRelayInput()
      expect(input.toneSystemPrompt).toBe(B2B_SUPPORT_TONE_SYSTEM_PROMPT)
      expect(input.autoReplyPolicy).toBe('auto_reply_non_refund')
    })

    it('allows override of autoReplyPolicy', () => {
      const input = b2bSupportRelayInput({ autoReplyPolicy: 'all_manual' })
      expect(input.autoReplyPolicy).toBe('all_manual')
      expect(input.toneSystemPrompt).toBe(B2B_SUPPORT_TONE_SYSTEM_PROMPT)
    })
  })
})
