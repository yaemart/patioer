/**
 * Normalized ad campaign row from a store advertising API (Phase 2).
 * Maps to `ads_campaigns` in ElectroOS; see `docs/plans/phase2-plan.md` §5.1.
 */
export interface HarnessAdsCampaign {
  platformCampaignId: string
  name: string
  status: 'active' | 'paused' | 'ended'
  dailyBudget?: number | null
  totalSpend?: number | null
  roas?: number | null
  /** ISO 4217 currency code for `dailyBudget` / `totalSpend`. When absent, callers assume USD. */
  currency?: string
}

/** Optional harness surface for platforms that expose advertising APIs. */
export interface AdsCapableHarness {
  readonly supportsAds: true
  getAdsCampaigns(): Promise<HarnessAdsCampaign[]>
  /**
   * Sets **daily** budget in USD (or tenant billing currency — callers should align with platform).
   * Phase 2 Day 5: real API wiring pending; {@link ShopifyHarness} ships a no-op until connected.
   */
  updateAdsBudget(campaignId: string, dailyBudgetUsd: number): Promise<void>
}
