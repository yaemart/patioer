import type { TenantHarness } from './base.harness.js'
import type { AdsCapableHarness } from './ads.types.js'

export function isAdsCapable(h: TenantHarness): h is TenantHarness & AdsCapableHarness {
  return (h as unknown as AdsCapableHarness).supportsAds === true
}
