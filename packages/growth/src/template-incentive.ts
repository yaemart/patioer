export interface TemplateDownloadInfo {
  templateId: string
  authorTenantId: string
  downloads: number
}

export interface IncentiveStore {
  hasReceivedIncentive(tenantId: string, templateId: string): Promise<boolean>
  recordIncentive(tenantId: string, templateId: string): Promise<void>
}

export interface IncentiveStripeCoupon {
  applyCoupon(customerId: string, couponId: string): Promise<void>
}

export interface IncentiveTenantLookup {
  getStripeCustomerId(tenantId: string): Promise<string | null>
}

export interface TemplateIncentiveDeps {
  store: IncentiveStore
  stripe: IncentiveStripeCoupon
  tenantLookup: IncentiveTenantLookup
}

const DOWNLOAD_THRESHOLD = 5
export const TEMPLATE_CONTRIBUTOR_COUPON_ID = 'template_contributor_100_pct_off_1_month'

export function createTemplateIncentiveService(deps: TemplateIncentiveDeps) {
  const { store, stripe, tenantLookup } = deps

  async function checkAndReward(info: TemplateDownloadInfo): Promise<{
    eligible: boolean
    rewarded: boolean
  }> {
    if (info.downloads < DOWNLOAD_THRESHOLD) {
      return { eligible: false, rewarded: false }
    }

    const alreadyRewarded = await store.hasReceivedIncentive(
      info.authorTenantId,
      info.templateId,
    )
    if (alreadyRewarded) {
      return { eligible: true, rewarded: false }
    }

    const customerId = await tenantLookup.getStripeCustomerId(info.authorTenantId)
    if (!customerId) {
      return { eligible: true, rewarded: false }
    }

    await stripe.applyCoupon(customerId, TEMPLATE_CONTRIBUTOR_COUPON_ID)
    await store.recordIncentive(info.authorTenantId, info.templateId)

    return { eligible: true, rewarded: true }
  }

  return { checkAndReward }
}

export type TemplateIncentiveService = ReturnType<typeof createTemplateIncentiveService>
