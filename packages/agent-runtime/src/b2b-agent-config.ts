/**
 * B2B Agent Configuration Overrides (Phase 4 §S11 task 11.7)
 *
 * ADR-0004 D21: B2B tenants use the same agent infrastructure with config deltas.
 * Constitution §4.3: Price approval threshold → 5% for B2B (vs 15% B2C).
 */

import type { PriceSentinelRunInput, SupportRelayRunInput } from './types.js'

/**
 * B2B Price Sentinel uses a tighter 5% threshold.
 * B2B wholesale pricing is less volatile; even small changes significantly
 * affect contract-based relationships.
 */
export const B2B_PRICE_SENTINEL_THRESHOLD_PERCENT = 5

export function b2bPriceSentinelInput(proposals: PriceSentinelRunInput['proposals']): PriceSentinelRunInput {
  return {
    proposals,
    approvalThresholdPercent: B2B_PRICE_SENTINEL_THRESHOLD_PERCENT,
  }
}

/**
 * B2B Support Relay uses formal business tone.
 * Wholesale buyers expect professional, contract-aware communication.
 */
export const B2B_SUPPORT_TONE_SYSTEM_PROMPT =
  'You are a professional B2B wholesale account manager. Use formal business language. ' +
  'Reference order numbers and contract terms when applicable. ' +
  'Address the buyer by company name. Never use casual language or emojis. ' +
  'For pricing inquiries, direct them to their assigned account manager.'

export function b2bSupportRelayInput(overrides?: Partial<SupportRelayRunInput>): SupportRelayRunInput {
  return {
    autoReplyPolicy: 'auto_reply_non_refund',
    toneSystemPrompt: B2B_SUPPORT_TONE_SYSTEM_PROMPT,
    ...overrides,
  }
}
